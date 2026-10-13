// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentCache } from '../src/platform/contentCache';
import { nodeAdapter } from '../src/platform/node';
import { cacheEntryName } from '../src/platform/cacheEntryName';
import type { PlatformAdapter } from '../src/platform/types';

const urls = ['v1', 'v2', 'v3', 'v4'].map(v => `https://cdn.test/${v}/a.bin`);
const bytes = (n = 8) => new Uint8Array(n).fill(42).buffer;
let dir: string | null = null;
const oldDir = process.env.ESENGINE_CACHE_DIR;
afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
    if (oldDir === undefined) delete process.env.ESENGINE_CACHE_DIR;
    else process.env.ESENGINE_CACHE_DIR = oldDir;
    vi.restoreAllMocks();
});
async function cache() {
    dir = await mkdtemp(join(tmpdir(), 'estella-cache-budget-'));
    process.env.ESENGINE_CACHE_DIR = dir;
    return new ContentCache(nodeAdapter);
}

describe('disk cache budget and offline versions', () => {
    it('two updates release only v1; v3 and the v2 rollback survive an offline restart', async () => {
        const c = await cache();
        for (let i = 0; i < 3; i++) {
            await c.protect('game', [{ revision: `v${i + 1}`, reason: 'current', keys: [urls[i]] },
                ...(i ? [{ revision: `v${i}`, reason: 'rollback' as const, keys: [urls[i - 1]] }] : [])]);
            await c.write(urls[i], bytes());
        }
        const preview = await c.cleanup(16);
        expect(preview.candidates).toEqual([cacheEntryName(urls[0])]);
        expect(await nodeAdapter.readCacheFile(urls[0])).not.toBeNull();
        const done = await c.cleanup(16, true);
        expect(done.releaseBytes).toBe(8);
        expect(done.budgetMet).toBe(true);
        const restarted = new ContentCache(nodeAdapter);
        expect(await restarted.read(urls[0])).toBeNull();
        expect(await restarted.read(urls[1])).toEqual(bytes());
        expect(await restarted.read(urls[2])).toEqual(bytes());
        const impossible = await restarted.cleanup(0, true);
        expect(impossible.removed).toEqual([]);
        expect(impossible.budgetMet).toBe(false);
        expect(impossible.report.protectedBytes).toBe(16);
    });

    it('recomputes a preview after a version becomes pending and preserves saves and unknown files', async () => {
        const c = await cache();
        await c.write(urls[0], bytes());
        expect((await c.cleanup(0)).candidates).toHaveLength(1);
        await c.protect('game', [{ revision: 'v1', reason: 'pending', keys: [urls[0]] }]);
        await writeFile(join(dir!, 'player-save.json'), '{"level":8}');
        await writeFile(join(dir!, '0123456789abcdef'), new Uint8Array(3));
        const result = await c.cleanup(0, true);
        expect(result.removed).toEqual([]);
        expect(result.report.entries.find(e => e.name === '0123456789abcdef')?.protection).toEqual(['unindexed']);
        expect(await readFile(join(dir!, 'player-save.json'), 'utf8')).toBe('{"level":8}');
    });

    it('serializes a delayed download with cleanup so its staged version remains readable', async () => {
        const c = await cache();
        await c.protect('game', [{ revision: 'v1', reason: 'pending', keys: [urls[0]] }]);
        const original = nodeAdapter.writeCacheFile.bind(nodeAdapter);
        let release!: () => void;
        let started!: () => void;
        const waiting = new Promise<void>(r => { started = r; });
        vi.spyOn(nodeAdapter, 'writeCacheFile').mockImplementation(async (key, data) => {
            if (key === urls[0]) { started(); await new Promise<void>(r => { release = r; }); }
            await original(key, data);
        });
        const write = c.write(urls[0], bytes());
        await waiting;
        const clean = c.cleanup(0, true);
        release();
        await write;
        expect((await clean).removed).toEqual([]);
        expect(await c.read(urls[0])).toEqual(bytes());
    });

    it('repairs corrupt indexes conservatively and reports missing protected files', async () => {
        const c = await cache();
        await c.write(urls[0], bytes());
        const indexed = (await nodeAdapter.listCacheFiles()).find(f => f.name !== cacheEntryName(urls[0]))!;
        await writeFile(join(dir!, indexed.name), '{truncated');
        const restarted = new ContentCache(nodeAdapter);
        await restarted.protect('game', [{ revision: 'v2', reason: 'current', keys: [urls[1]] }]);
        const repaired = await restarted.report(true);
        expect(repaired.versions[0].missing).toBe(1);
        expect(repaired.entries[0].protection).toContain('unindexed');
        expect((await restarted.cleanup(0, true)).removed).toEqual([]);
    });

    it('reports real released bytes when a deletion fails and refuses invalid budgets', async () => {
        const c = await cache();
        await c.write(urls[0], bytes());
        await c.write(urls[1], bytes());
        const unlink = nodeAdapter.removeCacheFile.bind(nodeAdapter);
        vi.spyOn(nodeAdapter, 'removeCacheFile').mockImplementation(async n => {
            if (n === cacheEntryName(urls[0])) throw Error('busy');
            await unlink(n);
        });
        const result = await c.cleanup(0, true);
        expect(result.failed).toEqual([cacheEntryName(urls[0])]);
        expect(result.releaseBytes).toBe(8);
        expect(result.remainingBytes).toBe(8);
        await expect(c.cleanup(-1, true)).rejects.toThrow('budget');
        await expect(nodeAdapter.removeCacheFile('../save')).rejects.toThrow('invalid');
    });

    it('uses last access rather than file discovery order for LRU', async () => {
        const c = await cache();
        let tick = 1_900_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => tick++);
        await c.write(urls[0], bytes());
        await c.write(urls[1], bytes());
        await c.read(urls[0]);
        expect((await c.cleanup(8)).candidates).toEqual([cacheEntryName(urls[1])]);
    });

    it('reports deletion results at quota even if the index cannot be stored', async () => {
        const c = await cache();
        await c.write(urls[0], bytes());
        vi.spyOn(nodeAdapter, 'writeCacheFile').mockRejectedValue(Error('disk full'));
        const result = await c.cleanup(0, true);
        expect(result.releaseBytes).toBe(8);
        expect(result.indexPersisted).toBe(false);
        expect((await new ContentCache(nodeAdapter).report()).usedBytes).toBe(0);
    });

    it('keeps a file shared with another application after its first owner retires the version', async () => {
        const c = await cache();
        for (const url of urls) await c.write(url, bytes());
        await c.protect('game-a', [{ revision: 'a1', reason: 'current', keys: [urls[0], urls[1]] }]);
        await c.protect('game-b', [{ revision: 'b1', reason: 'current', keys: [urls[0], urls[2]] }]);
        await c.protect('game-a', [{ revision: 'a2', reason: 'current', keys: [urls[3]] }]);
        const report = await c.report();
        expect(report.entries.find(e => e.key === urls[0])).toMatchObject({
            versions: ['a1', 'b1'], protection: ['game-b:current'],
        });
        const cleaned = await c.cleanup(24, true);
        expect(cleaned.removed).toEqual([cacheEntryName(urls[1])]);
        expect(await c.read(urls[0])).toEqual(bytes());
    });

    it('distinguishes unsupported management from an empty cache', async () => {
        const noStorage = new ContentCache({} as PlatformAdapter);
        expect(await noStorage.report()).toMatchObject({ capability: 'unavailable', usedBytes: null });
        const storageOnly = new ContentCache({ readCacheFile: async () => null, writeCacheFile: async () => {} } as unknown as PlatformAdapter);
        expect(await storageOnly.report()).toMatchObject({ capability: 'storage-only', reclaimableBytes: null });
        expect((await storageOnly.cleanup(0, true)).budgetMet).toBeNull();
    });
});
