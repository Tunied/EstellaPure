# v0.78.0 card review and cache-budget verification — 2026-10-13

The verified branch is based on engine `4e32ff5cc4ab06b33267a2333293ed69b19c83bc`
and editor `ba95cde5127b5a6c8c24f2860f365397b20a0071`. Draft reviews are
[engine #95](https://github.com/esengine/estella/pull/95) and
[editor #20](https://github.com/esengine/estella-editor/pull/20).
The initial review used engine `acdc5ded8cc939d81cbb2128d12e93609c0b3da1`
and editor `53e998badfa4dfce0d377c0c29b6107502bb893d`, before the rebase below.
[v0.78.0](https://github.com/esengine/estella/releases/tag/v0.78.0) was published
on 2026-10-12. Existing uncommitted changes in `D:/estella` and its editor were
preserved. Work is on `codex/cache-version-budget` in a separate checkout.

The live GitHub Project #8 was fetched with pagination: 137 cards. The current
candidate version contains two unfinished cards:

| Card | Board status | Decision |
|---|---|---|
| RM-025 — disk cache budget / offline versions | Todo, P0 | Implement the shared runtime and editor workflow; this benefits 2D Web/mini-game delivery. |
| RM-136 — GPU baking / adaptive sampling | Todo, P2 | Defer specialized 3D work according to the repository's 2D production priority. |

RM-025's earlier static description is outdated: mini-game byte caches and native
URL-to-safe-name mapping already exist. Cache names use XXH64, not SHA256. The
actual missing work was management, version protection and author-facing controls.
Earlier pending device cards (including RM-033 and RM-054) still require their
specified physical-device evidence; their status was not inferred from releases.

The changes are pushed for draft review and unmerged. The initial review found
no matching cache-budget PR; the two drafts above were subsequently created.
No board completion or device acceptance is claimed and no remote card was changed.

## Implemented

- Capability distinctions, actual resource/index usage, ownership/hash/access
  index, protected/missing-resource diagnostics and conservative scan repair.
- LRU preview and bounded batches of deletion coordinated with byte IO. Current,
  pending, rollback, next-launch and explicitly retained versions stay protected.
- Failed manifest persistence preserves the version a restart will actually use.
  Full-disk cleanup reports successful deletions even if the index write fails.
- Atomic mini-game writes when rename is supported; hosts without management
  remain usable for byte caching and accurately report their capability.
- Connected-device Profiler controls, localized English/Chinese labels, preview
  invalidation on edits/errors, stale-device-response rejection and retention.
- SDK API snapshots, published API inventory, changelog and runnable demonstration.

## Evidence

SDK targeted regression: **14 files, 164 tests passed, zero skipped**. The run
explicitly used `SDK_TEST_MODE=no-wasm` and `ESTELLA_NO_EMCC=1`; it did not build or
exercise the C++/WASM boundary. Cases included three resource versions, protected
budgets, old saves, retained versions, stale previews, concurrent writes, corrupt
indexes, quota failures, interrupted rename, failed deletions, offline reads,
consecutive manifest-store failures and debug-channel routing.

Editor interaction regression: **3 tests passed**. SDK declaration checks and
SDK build passed; the editor's typecheck and production build passed. API surface,
API declarations/inventory, chunk manifest, import maps, mini-game host/profile
installation, theme and CSS-variable checks passed.

`node tools/cache-budget-demo.mjs` produced:

| Stage | Result |
|---|---|
| Two updates | Each verified/applied/persisted/cached = true |
| Before cleanup | 24 bytes used; 16 protected; 8 reclaimable |
| Preview | One resource; eight bytes releasable |
| Execution | Eight bytes released; sixteen remain; budget met |
| Fresh process, server stopped, network rejected | v3 current and v2 rollback each read eight correct bytes |

The example deliberately supplies durable manifest storage because Node's default
key/value store is session-local. It uses real filesystem caching and a real HTTP
server, then launches a separate offline process. This is functional evidence,
not a performance benchmark.

The actual editor component was rendered in a hidden Electron fixture with the
production stylesheet and inspected at 440- and 760-pixel content widths. Chinese
labels, visible numeric values, version rows, preview and wrapping controls were
checked; no horizontal overflow was found. Screenshots are in local
`output/cache-budget/panel-narrow.png` and `panel-wide.png`. Fixture data does not
represent a physical device. Reproduce after the editor build with:

```text
pnpm exec electron desktop/scripts/cache-panel-preview.mjs
```

## Remaining acceptance

RM-025 remains unfinished as a board/release card: no new code has been merged or
published, and physical WeChat quota/offline-start acceptance is still pending.
Native cache enumeration/removal is not provided by the current host bridge and
therefore reports `storage-only`; Web reports `unavailable`. Interrupted temporary
files and unknown legacy files remain conservatively protected. Resource budgets
exclude saves and do not measure the platform's complete storage quota.

## Continuation: compiled runtimes, real exports and scale measurement

The current source was compiled into both Web and WeChat release WASM with the
existing Emscripten 5.0.0 / Binaryen 125 toolchain. The first parallel Binaryen
optimization failed its `call target must exist` validator. Setting
`BINARYEN_CORES=1` succeeded with unchanged source and release flags; this is the
build environment used for this evidence, not a proven permanent toolchain fix.
Web compiled in 91.23 s and WeChat in 69.76 s. Optional side modules were not built.

The existing `hotupdate-verify-fixture` exported the committed Web sample and a
changed-art update. Its real rendered verifier passed: green `[40,200,90]` became
red `[220,40,40]`; tampered and missing-resource updates were refused; relaunch
restored the red revision. Web accurately returned `cached: null`.

`pnpm verify:cache-budget` now exports four WeChat packages from the same authored
2D hot-update project, with `.wasm.br` and engine subpackages. The driver varies
the CDN art and supplies a test hook; the authored scene/gameplay remain intact.
The mini-game contract host supplies real files and a real authenticated socket
through the editor's shared debug-channel server. This is still a host simulation,
not physical WeChat, and the sample's existing optional-update-channel export
warnings are preserved in `output/cache-budget/render/exports.json`.

| Check | Evidence |
|---|---|
| Three updates | Green `[40,190,50]`, red `[210,40,40]`, blue `[40,70,220]`; each verified/applied/persisted/cached = true |
| Explicit retention | Keeping the oldest version made a zero-byte cleanup refuse all protected resource deletion |
| Full-store cleanup | 627 B before, 418 B protected and remaining, 209 B released; index write failure accurately returned `indexPersisted: false` |
| Pixels | Before/after cleanup RGBA buffers were identical |
| Renderer restart with CDN unavailable | Blue current revision restored; zero attempted CDN downloads; current/rollback missing counts both zero |

Results and images are local under `output/cache-budget/render/verification.json`,
`v1.png`, `v2.png`, `v3.png`, `before-cleanup.png`, `after-cleanup.png` and
`offline-restart.png`. The separate Node example above covers a literal new
process; this rendered run covers a new game window/renderer on the same host.

A synthetic metadata benchmark uses the same 1200-file, three-version index on
the same machine, with three runs on each implementation. Before: 3073.46,
2975.66, 2974.37 ms (median 2975.66). After: 12.14, 10.34, 11.01 ms (median 11.01).
Both report exactly 19,660,800 B used, 14,745,600 B protected and 4,915,200 B
reclaimable. Reverse indexing removes the repeated file × version-reference
search. This measures index CPU work, not device IO or gameplay frame rate.
Reproduce with `node tools/cache-budget-scale.mjs`; before/after JSON is in local
`output/cache-budget/scale-before.json` and `scale-after.json`.

A new regression verifies shared resources remain protected by another owner
after one owner retires its version. Packaged remote-group files with no CDN root
are excluded from cache-missing diagnostics, since those bytes ship in the
package. The compiled-runtime targeted run passed 72 tests before the additional
shared-owner case; the final rerun is recorded with the PR validation.

`adb devices -l` returned no attached devices. Physical-device acceptance remains
an explicit gap; neither rendered simulation nor an eventual merged PR closes it.

## Final branch validation and draft review

The work was rebased onto engine `19f7ec25279717b874afcae87d2c5e047b458f7b`
and editor `ba95cde5127b5a6c8c24f2860f365397b20a0071` after fetching another
12 engine commits and one editor commit. Editor draft review is
[#20](https://github.com/esengine/estella-editor/pull/20); it is not merged.

Both current runtime targets were rebuilt with Emscripten 5.0.7, unchanged release
optimization flags, `BINARYEN_CORES=1`, `EMCC_DEBUG=1` (intermediate-file diagnostics)
and independent `EMCC_TEMP_DIR` directories. Earlier normal-link optimization
assertions also occurred on 5.0.7; upgrading alone is not claimed to fix them.
Standalone replay with the same optimizer flags succeeded. The final post-link
optimization is now mandatory, uses a separate temporary output, validates it and
commits it atomically instead of warning and copying an unoptimized/partial file.
Build fingerprints include this transaction and the optimization level.

The transactional optimizer has three passing regression cases: a crash after
writing output preserves the original, successful-but-invalid output is rejected,
and valid output commits without using the input file as the output destination.
Final Web and WeChat build logs are local in `output/cache-budget/build-web-latest.log`
and `build-wechat-latest.log`, with no skipped post-link optimization.

The final targeted SDK run passed **168 tests across 14 files**. Editor interaction
tests passed **3/3**, and optimizer tests passed **3/3**. The Web export/renderer
verification passed again against the rebased current runtime. Optional side
modules remain outside this targeted run; no full-engine suite pass is claimed.

Rescan now recovers a referenced legacy resource's URL/hash from its manifest
identity while retaining saves, orphan files and interrupted temporaries. A
regression proves that a repaired legacy version can later be reclaimed. Cache
writes also return unsupported when a host has adapter methods but no usable
cache storage, preventing a false stored/cached result.

The rendered verifier owns an isolated Electron user-data directory and exports
packages in an asynchronous child, keeping Electron's service startup responsive.
Profile isolation alone still failed with `ERR_FAILED (-2)`; the following run
with asynchronous export passed. The synchronous export was a possible source of
startup starvation, not a proven Electron root cause. Failed runs remain in
`minigame-final.log` and `minigame-recheck.log`; the successful current run is in
`minigame-async.log` and `output/cache-budget/render/verification.json`.
It rendered green/red/blue, released 209 B while preserving 418 B of current and
rollback resources, kept pixels identical, and restarted offline without a CDN
request. This is contract-host evidence, not physical-device acceptance.

The verifier is now a named release criterion and runs in the third golden CI
shard, which retains its JSON and screenshots. Engine Build was dispatched on
the implementation branch; the first editor CI ran before its companion engine
branch existed and failed to resolve the new SDK types. It was rerun after that
branch was pushed. The editor rerun passed in 4m18s. Engine results remain pending,
not inferred from local passes. A final fetch brought in two mainline commits for
golden output paths and authored audio playback; the branch rebased cleanly onto
`4e32ff5cc`. Those commits change example/test/changelog files, with no C++ or SDK
runtime change. The existing compiled runtime artifacts still match their source.
