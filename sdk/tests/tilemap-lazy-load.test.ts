// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyTilesetLoads } from '../src/tilemap/lazyTilesetLoads';
import type { AssetsData } from '../src/asset/AssetPlugin';
import type { AssetLease } from '../src/asset/AssetLease';
import { RuntimeConfig } from '../src/defaults';

function lease(): AssetLease {
    return { key: 'tileset:atlas', generation: 1, value: {}, release: vi.fn(), retain: () => null };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('lazy tileset slot ownership', () => {
    it('deduplicates a pending request and holds one receipt until the last layer leaves', async () => {
        let resolve!: (value: AssetLease) => void;
        const held = lease(), acquireTyped = vi.fn(() => new Promise<AssetLease>(r => { resolve = r; }));
        const assets = { acquireTyped } as unknown as AssetsData;
        const loads = new LazyTilesetLoads();
        loads.request(assets, 'atlas', 'key'); loads.request(assets, 'alias', 'key');
        expect(acquireTyped).toHaveBeenCalledOnce();
        expect(acquireTyped).toHaveBeenCalledWith('tileset', 'atlas');
        resolve(held); await settle();
        loads.prune(new Set(['key']));
        expect(held.release).not.toHaveBeenCalled();
        loads.prune(new Set()); loads.reset();
        expect(held.release).toHaveBeenCalledOnce();
        expect(loads.size).toBe(0);
    });

    it.each(['prune', 'reset'])('releases a late completion after %s', async mode => {
        let resolve!: (value: AssetLease) => void;
        const held = lease(), acquireTyped = vi.fn(() => new Promise<AssetLease>(r => { resolve = r; }));
        const loads = new LazyTilesetLoads();
        loads.request({ acquireTyped } as unknown as AssetsData, 'atlas', 'key');
        if (mode === 'prune') loads.prune(new Set()); else loads.reset();
        resolve(held); await settle();
        expect(held.release).toHaveBeenCalledOnce();
        expect(loads.size).toBe(0);
    });

    it('retries a failure after cooldown without issuing one request per frame', async () => {
        vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
        const held = lease(), acquireTyped = vi.fn().mockRejectedValueOnce(Error('missing')).mockResolvedValue(held);
        const assets = { acquireTyped } as unknown as AssetsData, loads = new LazyTilesetLoads();
        loads.request(assets, 'atlas', 'key'); await settle();
        for (let i = 0; i < 100; i++) loads.request(assets, 'atlas', 'key');
        expect(acquireTyped).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(Math.max(1000, RuntimeConfig.assetFailureCooldown));
        loads.request(assets, 'atlas', 'key'); await settle();
        expect(acquireTyped).toHaveBeenCalledTimes(2);
        loads.reset(); expect(held.release).toHaveBeenCalledOnce();
    });

    it('does not attach an old completion to a replacement request for the same key', async () => {
        const resolves: Array<(value: AssetLease) => void> = [];
        const acquireTyped = vi.fn(() => new Promise<AssetLease>(resolve => { resolves.push(resolve); }));
        const assets = { acquireTyped } as unknown as AssetsData, loads = new LazyTilesetLoads();
        const old = lease(), current = lease();
        loads.request(assets, 'atlas', 'key'); loads.reset(); loads.request(assets, 'atlas', 'key');
        resolves[0](old); resolves[1](current); await settle();
        expect(old.release).toHaveBeenCalledOnce(); expect(current.release).not.toHaveBeenCalled();
        loads.reset(); expect(current.release).toHaveBeenCalledOnce();
    });
});
