// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { AssetScope, type AssetLease } from '../src/asset/AssetLease';
import { RegistryAssetSlots, type RegistryAssetKind } from '../src/asset/registryAssets';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { DependencyRecorder, PreparationFailure } from '../src/asset/dependencies';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn() }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const lease = (release: () => void): AssetLease => ({ key: 'probe', generation: 1, value: null, release, retain: () => null });

describe('asset teardown survives user cleanup failures', () => {
    it.each([new Error('unload failed'), undefined, 'primitive failure'])('a scope returns every receipt and preserves the first thrown reason: %s', error => {
        const scope = new AssetScope(), events: string[] = [];
        scope.add(lease(() => { events.push('first'); }));
        scope.add(lease(() => { events.push('second'); throw error; }));
        scope.add(lease(() => { events.push('last'); }));
        let thrown = false, reason: unknown;
        try { scope.releaseAll(); } catch (e) { thrown = true; reason = e; }
        expect(thrown).toBe(true); expect(reason).toBe(error);
        expect(events).toEqual(['last', 'second', 'first']); expect(scope.size).toBe(0);
        scope.releaseAll(); expect(events).toHaveLength(3);
    });

    it('a cleanup can reenter the same scope without releasing receipts twice', () => {
        const scope = new AssetScope(), events: string[] = []; let entered = false;
        scope.add(lease(() => { events.push('first'); }));
        scope.add(lease(() => { events.push('last'); if (!entered) { entered = true; scope.releaseAll(); } }));
        expect(() => scope.releaseAll()).not.toThrow(); expect(events).toEqual(['last', 'first']);
        expect(scope.size).toBe(0);
    });

    it('a new acquisition during cleanup is owned by the next scope batch', () => {
        const scope = new AssetScope(), next = vi.fn();
        scope.add(lease(() => scope.add(lease(next))));
        scope.releaseAll(); expect(scope.size).toBe(1); expect(next).not.toHaveBeenCalled();
        scope.releaseAll(); expect(next).toHaveBeenCalledTimes(1); expect(scope.size).toBe(0);
    });

    it('a preparation keeps the load failure and its source after rollback cleanup also fails', () => {
        const recorder = new DependencyRecorder(), error = new Error('source missing'), released = vi.fn();
        recorder.read('missing.source');
        recorder.own('good', lease(released));
        recorder.own('bad', lease(() => { throw new Error('rollback cleanup failed'); }));
        const failure = recorder.abort(error);
        expect(failure).toBeInstanceOf(PreparationFailure); expect(failure.reason).toBe(error);
        expect(failure.sources).toContain('missing.source'); expect(released).toHaveBeenCalledOnce();
    });

    it('a value unload failure remains the reported reason if its dependencies also fail', async () => {
        const first = new Error('value unload failed'), second = new Error('dependency unload failed');
        const assets = assetsFor(() => { throw first; });
        assets.register({ type: 'parent', extensions: ['.parent'],
            load: async (_path, ctx) => { await ctx.acquireAsset('probe', 'a.probe'); return {}; }, unload: () => { throw second; } });
        const owner = await assets.acquireTyped('parent', 'a.parent');
        expect(() => owner.release()).toThrow(second);
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
    });

    function kindFor(release: (path: string) => void): RegistryAssetKind<string> {
        return { prepare: async path => {
            const dependencies = new AssetScope(); dependencies.add(lease(() => release(path)));
            return { published: path, value: path, dependencies, edges: [] };
        } };
    }

    it('the last slot receipt unpublishes every alias even when a dependency unload throws', async () => {
        const slots = new RegistryAssetSlots(), error = new Error('bad dependency');
        const owner = await slots.acquire(kindFor(() => { throw error; }), 'probe', 'a', ['alias']);
        expect(() => owner.release()).toThrow(error);
        expect(slots.size).toBe(0); expect(slots.published('probe', 'alias')).toBeUndefined();
        expect(owner.retain()).toBeNull(); expect(() => owner.release()).not.toThrow();
    });

    it('a retiring slot cannot be retained from its own dependency cleanup', async () => {
        const slots = new RegistryAssetSlots(); let retained: AssetLease | null | undefined;
        const owner = await slots.acquire(kindFor(() => { retained = owner.retain(); }), 'probe', 'a', []);
        owner.release(); expect(retained).toBeNull(); expect(slots.size).toBe(0);
    });

    it('wholesale slot cleanup retires all names before callbacks and attempts all dependencies', async () => {
        const slots = new RegistryAssetSlots(), calls: string[] = [], error = new Error('bad first slot');
        const kind = kindFor(path => { calls.push(path); expect(slots.size).toBe(0); if (path === 'a') throw error; });
        const a = await slots.acquire(kind, 'probe', 'a', ['alias-a']);
        const b = await slots.acquire(kind, 'probe', 'b', ['alias-b']);
        expect(() => slots.releaseAll()).toThrow(error); expect(calls).toEqual(['a', 'b']);
        expect(slots.size).toBe(0); expect(a.retain()).toBeNull(); expect(b.retain()).toBeNull();
        expect(() => { a.release(); b.release(); slots.releaseAll(); }).not.toThrow();
        expect(calls).toHaveLength(2);
    });

    function assetsFor(unload: (value: { path: string }) => void) {
        const assets = Assets.create({ module: null, backend: { fetchBinary: async () => new ArrayBuffer(0), fetchText: async () => '{}', resolveUrl: p => p } as Backend });
        assets.register({ type: 'probe', extensions: ['.probe'], load: async path => ({ path }), unload });
        return assets;
    }

    it('a failed generic unload evicts the retired cache entry before a later acquisition', async () => {
        const error = new Error('bad unload'), unloaded: object[] = [];
        const assets = assetsFor(value => { unloaded.push(value); if (unloaded.length === 1) throw error; });
        const first = await assets.acquireTyped('probe', 'a.probe');
        expect(() => first.release()).toThrow(error);
        const second = await assets.acquireTyped('probe', 'a.probe');
        expect(second.value).not.toBe(first.value); second.release(); expect(unloaded).toHaveLength(2);
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
    });

    it('wholesale Assets cleanup attempts all owned values despite the first unload failure', async () => {
        const calls: string[] = [], error = new Error('bad unload');
        const assets = assetsFor(value => { calls.push(value.path); if (value.path === 'a.probe') throw error; });
        const a = await assets.acquireTyped('probe', 'a.probe'), b = await assets.acquireTyped('probe', 'b.probe');
        expect(() => assets.releaseAll()).toThrow(error); expect(calls).toEqual(['a.probe', 'b.probe']);
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0, registrySlots: 0 });
        expect(() => { a.release(); b.release(); assets.releaseAll(); }).not.toThrow(); expect(calls).toHaveLength(2);
    });
});
