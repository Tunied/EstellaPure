// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameFileSystemManager, MiniGameGlobal } from '../src/platform/minigame/api';
import { ContentCache } from '../src/platform/contentCache';
import { cacheEntryName } from '../src/platform/cacheEntryName';

function host() {
    const files = new Map<string, ArrayBuffer>();
    const dir = 'wxfile://usr';
    let failRename = false;
    let full = false;
    const fs: MiniGameFileSystemManager = {
        readFileSync: path => { const b = files.get(path); if (!b) throw Error('missing'); return b; },
        readFile: o => { const b = files.get(o.filePath); if (b) o.success?.({ data: b }); else o.fail?.({ errMsg: 'missing' }); },
        access: o => { if (files.has(o.path)) o.success?.(); else o.fail?.({ errMsg: 'missing' }); },
        accessSync: path => { if (!files.has(path)) throw Error('missing'); },
        writeFile: o => { if (full) o.fail?.({ errMsg: 'quota exceeded' }); else { files.set(o.filePath, o.data as ArrayBuffer); o.success?.(); } },
        readdir: o => o.success?.({ files: [...files.keys()].map(p => p.slice(dir.length + 1)) }),
        stat: o => { const b = files.get(o.path); if (b) o.success?.({ stats: { size: b.byteLength, lastAccessedTime: 1, isFile: () => true } }); else o.fail?.({ errMsg: 'missing' }); },
        unlink: o => { files.delete(o.filePath); o.success?.(); },
        rename: o => {
            if (failRename) { o.fail?.({ errMsg: 'interrupted' }); return; }
            files.set(o.newPath, files.get(o.oldPath)!); files.delete(o.oldPath); o.success?.();
        },
    };
    const make = () => new MiniGamePlatformAdapter({ id: 'wechat', hostLabel: 'Test',
        global: { env: { USER_DATA_PATH: dir }, getFileSystemManager: () => fs } as unknown as MiniGameGlobal });
    return { files, dir, make, renameFails: () => { failRename = true; }, fill: () => { full = true; } };
}

it('cleans only old resource bytes on the mini-game fs and retains a developer-selected version across restart', async () => {
    const h = host();
    const cache = new ContentCache(h.make());
    const urls = [1, 2, 3].map(i => `https://cdn.test/${i}.bin`);
    for (let i = 0; i < urls.length; i++) {
        await cache.protect('game', [{ revision: String(i + 1), reason: 'current', keys: [urls[i]] },
            ...(i ? [{ revision: String(i), reason: 'rollback' as const, keys: [urls[i - 1]] }] : [])]);
        await cache.write(urls[i], new ArrayBuffer(8));
    }
    h.files.set(`${h.dir}/player-save.json`, new ArrayBuffer(99));
    await cache.retainVersion('game', '1');
    const restarted = new ContentCache(h.make());
    expect((await restarted.cleanup(0, true)).removed).toEqual([]);
    await restarted.retainVersion('game', '1', false);
    expect((await restarted.cleanup(16, true)).releaseBytes).toBe(8);
    expect(h.files.has(`${h.dir}/${cacheEntryName(urls[0])}`)).toBe(false);
    expect(h.files.has(`${h.dir}/player-save.json`)).toBe(true);
    expect(await restarted.read(urls[2])).toEqual(new ArrayBuffer(8));
});

it('does not replace committed bytes when rename is interrupted, and rejects a full-cache write', async () => {
    const h = host();
    const adapter = h.make();
    const original = new Uint8Array([1, 2]).buffer;
    await adapter.writeCacheFile('key', original);
    h.renameFails();
    await expect(adapter.writeCacheFile('key', new ArrayBuffer(3))).rejects.toThrow('interrupted');
    expect(await adapter.readCacheFile('key')).toEqual(original);
    expect([...h.files.keys()].some(n => n.endsWith('.tmp'))).toBe(false);
    h.fill();
    await expect(new ContentCache(adapter).write('other', new ArrayBuffer(2))).rejects.toThrow('quota');
    expect(await adapter.readCacheFile('other')).toBeNull();
});

it('counts interrupted temporary writes conservatively without treating them as loadable assets', async () => {
    const h = host();
    h.files.set(`${h.dir}/0123456789abcdef.7.tmp`, new ArrayBuffer(4));
    const cache = new ContentCache(h.make());
    const report = await cache.report(true);
    expect(report.usedBytes).toBe(4);
    expect(report.protectedBytes).toBe(4);
    expect((await cache.cleanup(0, true)).removed).toEqual([]);
});
