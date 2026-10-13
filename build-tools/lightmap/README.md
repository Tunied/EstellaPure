# Lightmap bake kernel

`lightmap-kernel.{mjs,wasm}` — the ray casting a lightmap bake spends its time
in, as an emscripten build of `tools/lightmap-wasm/kernel.cpp` with threads.
Committed so baking needs **no emsdk**, the same pattern as `build-tools/ufbx/`.

`kernel.mjs` is what callers use (`pipeline/src/assets/lightmapKernel.ts` wraps
it as a `BakeExecutor`): it takes a scene's triangles and lumels once, then runs
the direct and gather passes over every lumel on every core. It also decodes
the PNGs a bounce's albedo is averaged from, side by side (stb_image, from
`third_party/stb`).

The rules are `sdk/src/lightmap/solve.ts`'s, term for term, and
`pipeline/tests/lightmap-kernel.test.ts` holds the two to the same atlas bytes.
A change to the solve is a change to both.

Gather visibility is cached independently of the light field: each reference
stores an atlas texel and surface, or the sky/unlit outcome. Later bounces and
unchanged geometry submitted to the same kernel reuse those exact references;
light colours, intensities and the sky still produce fresh radiance. The sample
order and arithmetic remain unchanged. Byte comparisons against the uploaded
geometry snapshot invalidate reuse even if a caller mutates its input arrays.

The default visibility budget is 384 MiB. `setCacheBudget(bytes)` changes it;
zero disables caching. A gather exceeding the budget follows the original trace
path. `cacheStats()` reports retained reference bytes and the cumulative number
of gather rays resolved, so a cached pass can be distinguished from a trace.
These bytes exclude the scene/BVH and output arrays. Release frees the cache.

The pipeline regression compares cached and uncached output byte for byte across
relighting, changed geometry/sample counts, cutouts, back faces and SH/flat skies.
Large-scene timings and reuse across separate editor bake requests remain to be
verified; no GPU acceleration or Bistro speedup is claimed by these tests.

## Rebuild

```
node tools/lightmap-wasm/build.mjs
```
