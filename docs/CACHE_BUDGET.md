# Disk cache budgets and offline version protection

The disk cache stores verified hot-update resource bytes. Its resource budget is
separate from the in-memory texture/audio residency budgets and from application
saves. A budget is an explicit cleanup target, not a promise that protected
versions can fit inside that target.

```ts
import { Assets } from 'esengine';

const assets = app.getResource(Assets);
const report = await assets.diskCacheReport();
if (report.capability === 'managed') {
    const budget = 128 * 1024 * 1024;
    const preview = await assets.cleanDiskCache(budget);
    // Show preview.releaseBytes, candidates and budgetMet before execution.
    const result = await assets.cleanDiskCache(budget, true);
    // result.releaseBytes counts successful deletions only.
}

// A version in the reported history can be kept independently of rollback.
await assets.retainDiskCacheVersion('content-revision');
await assets.retainDiskCacheVersion('content-revision', false);
await assets.diskCacheReport(true); // Reconcile and persist a directory rescan.
```

| Capability | Meaning |
|---|---|
| `managed` | Resource files can be enumerated, measured and safely removed. Node and mini-game hosts with the required filesystem APIs support this. |
| `storage-only` | Bytes can be cached, but usage and cleanup are unavailable. The current native bridge has this capability. |
| `unavailable` | No usable engine disk-cache store. Web is in this category; the browser HTTP cache is outside this API. |

Unavailable sizes are `null`, never a misleading zero. `usedBytes` measures
resource files, including interrupted temporary writes, while `indexBytes`
measures the index separately. Neither value measures all application saves or
the platform's entire storage quota. Leave room for those when selecting a budget.

The index records cache key, byte hash, actual size, last access, version ownership
and protection reasons. Update checks pin pending resources before download;
commits pin the active version and its previous version for rollback. If storing
the active manifest fails, the actual next-launch version and its rollback remain
pinned through later updates. Explicit retention survives movement of that pair.
Files shared between versions are protected whenever any owner still needs them.

Cleanup recomputes its candidates when executed, so changing versions after a
preview cannot make the preview authorize deletion of current resources. IO and
cleanup share a coordinator per adapter; deletion yields every sixteen files.
Protected files can keep usage above budget, which `budgetMet: false` reports.
Deletion failures and actual freed bytes are returned. If a full disk refuses the
final index write, `indexPersisted: false` reports that successful deletions will
be reconciled on the next scan.

Application save names are excluded from enumeration. Legacy files without an
index identity, corrupt-index survivors and interrupted temporary files remain
protected instead of guessing their ownership. A rescan reconciles sizes and
missing files; it does not prove a version can boot. The version's `missing`
count exposes incomplete offline resources. This coordinator assumes one runtime
owns the cache directory; it does not provide an interprocess filesystem lock.

In the editor, select a connected development device in **Profiler**. The disk
cache section provides rescan, resource budget, cleanup preview, execution and
explicit version retention. Unsupported or older device builds report capability
limitations or their query error. This is an authenticated development channel;
these controls are not shipped as a game UI.

Run the self-contained demonstration after installing workspace dependencies:

```text
node tools/cache-budget-demo.mjs
```

It serves three eight-byte resource versions over a local HTTP server, applies
two updates, removes the oldest version, closes the server and starts a new
process with network access rejected. The new process must read both current and
rollback bytes. Node's default key/value storage is session-local, so the fixture
explicitly supplies a durable host store for the active manifest. Mini-game and
native hosts already supply their own persistent key/value storage.

This example is a storage/update verification, not a rendered game or physical
mini-game device acceptance. See [the dated verification record](CACHE_BUDGET_REVIEW_2026-10-13.md).

After compiling the current Web and WeChat runtime targets, use
`pnpm verify:cache-budget` for exported mini-game rendering, three updates,
editor-channel controls, quota cleanup and an offline renderer restart. This
contract-host verification writes images and JSON under `output/cache-budget/render/`;
physical WeChat acceptance remains separate. `node tools/cache-budget-scale.mjs`
measures metadata report CPU time on a fixed 1200-file/three-version dataset.
