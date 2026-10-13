// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { ContentCache } from '../../sdk/src/platform/contentCache';
import { cacheEntryName } from '../../sdk/src/platform/cacheEntryName';
import type { PlatformAdapter } from '../../sdk/src/platform/types';
export async function run() {
    const count = 1200, bytesPerEntry = 16 * 1024;
    const keys = Array.from({ length: count }, (_, i) => `https://cdn.example/game/assets/hash-${i}.png`);
    const entries = keys.map((key, i) => ({ name: cacheEntryName(key), key, size: bytesPerEntry, lastAccess: i }));
    const index = new TextEncoder().encode(JSON.stringify({ schema: 1, entries, owners: { game: [
        { revision: 'v1', reason: null, keys: keys.slice(0, 600) },
        { revision: 'v2', reason: 'rollback', keys: keys.slice(300, 900) },
        { revision: 'v3', reason: 'current', keys: keys.slice(600) },
    ] } }));
    const platform = { readCacheFile: async () => index.buffer, writeCacheFile: async () => {},
        listCacheFiles: async () => [...entries, { name: cacheEntryName('estella:content-cache:index:v1'), size: index.byteLength, lastAccess: 0 }],
        removeCacheFile: async () => {},
    } as unknown as PlatformAdapter;
    const times = [];
    let totals;
    for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const report = await new ContentCache(platform).report();
        times.push(performance.now() - start);
        if (report.usedBytes !== count * bytesPerEntry || report.protectedBytes !== 900 * bytesPerEntry
            || report.reclaimableBytes !== 300 * bytesPerEntry) throw Error('scale index accounting changed');
        totals = { usedBytes: report.usedBytes, protectedBytes: report.protectedBytes, reclaimableBytes: report.reclaimableBytes };
    }
    return { entries: count, versions: 3, totals, milliseconds: times, medianMs: [...times].sort((a, b) => a - b)[1] };
}
