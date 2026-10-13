# RM-136: exact visibility reuse for lightmap iteration

After the 2D cache workflow was implemented, the next v0.78.0 card was reviewed.
RM-136 allows GPU tracing, adaptive sampling, or incremental relighting. This
change takes the incremental route: cache geometry visibility independently of
radiance, retaining the original sample set, order and arithmetic. No GPU or
adaptive estimator is introduced.

Each cached gather reference holds an atlas texel and surface, or a sky/unlit
outcome. Subsequent passes sample the new atlas and sky. The default reference
budget is 384 MiB; larger passes or a refused allocation use the original trace
path. Exact byte comparisons against uploaded scene arrays invalidate reuse,
including caller mutation, geometry, material, lumel and sample changes. Changing
light colour, intensity or the sky recomputes lighting without repeating gathers.

The editor serializes requests on one worker, rejects outstanding work on worker
failure, can start a replacement, and retires an idle worker after two minutes.
Only one scene is retained. Scene/BVH and output memory are additional to the
visibility budget. Idle retirement is not an on-disk or cross-process cache.

## Same-machine Bistro measurement

The source is [Amazon Lumberyard Bistro, ORCA](https://developer.nvidia.com/orca/amazon-lumberyard-bistro),
licensed CC-BY 4.0. The downloaded FBX SHA256 and raw timing records are in
[the measurement JSON](bench/lightmap-bistro-2026-10-13.json). Assets remain in
the local `.cache` and are not committed. Production FBX import, UV generation,
DDS base-colour/alpha conversion and lightmap baking prepared the same input for
both kernels. Five existing UV-overlap warnings were identical in both runs.

Intel Core i5-14600K, Windows, 20 solve threads; 2,832,120 triangles, 1,591
surfaces and 1,251,223 lumels. Both used a 4096 atlas, density 3, two bounces,
32 rays per lumel, one directional light and flat ambient [0.1, 0.1, 0.1]. This
is a fresh A/B measurement, not a comparison with the card's historical 44 s.

| Request | Original kernel | Visibility cache | PNG bytes |
|---|---:|---:|---|
| First bake, intensity 2 | 28.535 s | 18.743 s | identical |
| Relight, intensity 0.8 | 28.316 s | 5.242 s | identical |
| Restore intensity 2 | 29.418 s | 5.246 s | identical |

One cold bake and two consecutive relights were measured per kernel, sequentially
on the same machine. These are individual measurements, not medians of repeated
cold runs. All three pairs were compared with `Buffer.equals`, as well as SHA256.
The cache retained 320,313,088 B and resolved 40,039,136 gather rays in total;
neither relight increased that counter. Rays that miss still evaluate the new
sky, and hit references still read the new radiance and albedo.

```text
node tools/lightmap-bistro.mjs prepare <BistroExterior.fbx> .cache/bistro/prepared
node tools/lightmap-bistro.mjs measure .cache/bistro/prepared/input.json output/bistro-after
node tools/lightmap-bistro.mjs measure .cache/bistro/prepared/input.json output/bistro-before <original-kernel.mjs>
```

The first preparation attempt used density 12 in a 2048 atlas and was refused;
layout inspection selected the fixed 4096/density-3 input before either timed
run. No measured bake silently lowers density. The original kernel is the
committed mainline implementation, not a deliberately slower approximation.

## Correctness and authoring acceptance

Pipeline regression covers cached/uncached byte equality, relighting, changed
geometry and samples, budget fallback, cutouts, back faces, SH/flat skies and
thread determinism. Real worker tests cover sequential relights, queued replies,
refused-bake recovery, idle retirement and an unexpected clean exit. The built
editor's `lighting.bake` command changes the atlas when a lamp changes, restores
the same bytes when it returns, and agrees with CLI fingerprints.

The authoring fixture initially enclosed its lamp inside a stock 100-unit cube,
so its atlas could not certify relighting. It now scales the cube into its room
and uses a meaningful indirect field. Decimal scale 0.02 exposed a separate
CLI/world mismatch: the CLI composed double-precision document transforms while
the editor composed float32 runtime fields. CLI transform reads now use that
runtime precision; material fields and bake options keep their existing rules.

The physics-3d corpus was rebaked for those corrected poses. The scene changed
only its fingerprint; reflection data was unchanged. Out of 1,048,576 atlas
pixels, 271 decoded irradiance values changed, RMS 0.0001196, maximum absolute
0.09067 (relative maximum 0.48455 near small values). Maximum probe coefficient
change was 0.0055936. Visibility at grazing boundaries is discontinuous; these
are changed inputs, not a cached/uncached solver error. Both kernels still
produce identical Bistro bytes for identical inputs. The fresh corpus passes
`bake-scene ... --check` with 252,299 lumels, ten objects, one probe grid and two
reflection columns. Older bakes of decimal transforms may correctly become stale
and need rebaking; existing asset identities and references are preserved.

The editor verifier used the Web/side-module artifact from CI run 38385844932;
its engine C++ source was verified unchanged from this branch before staging it.
The lightmap tool kernel was rebuilt locally with Emscripten 5.0.7. Targeted
tests and authoring checks pass locally; draft PR CI and merged/released status
are separate. RM-136 is not marked Done by this record.
