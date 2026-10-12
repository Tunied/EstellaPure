// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';

const {releaseTexture} = vi.hoisted(() => ({ releaseTexture: vi.fn() }));
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture }),
    getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};
const make = (fetchText: Backend['fetchText'] = async () => '{}') => Assets.create({
    module: null, backend: { fetchText, fetchBinary: async () => new ArrayBuffer(0), resolveUrl: p => p } as Backend,
});

describe('loading across wholesale asset teardown', () => {
    it('immediately returns a composed texture held by a stalled preparation', async () => {
        const pending = deferred<string>(), entered = deferred<void>();
        const assets = make(async () => { entered.resolve(); return pending.promise; });
        releaseTexture.mockClear();
        vi.spyOn(assets.getTextureLoader(), 'loadFromPixels').mockResolvedValue({ handle: 42, width: 2, height: 2 });
        assets.register({ type: 'probe', extensions: [], load: async (_, ctx) => {
            await ctx.createOwnedTexture!(2, 2, new Uint8Array(16), false);
            await ctx.loadText('stalled'); return {};
        }, unload: vi.fn() });
        const request = assets.acquireTyped('probe', 'probe').then(() => null, e => e);
        await entered.promise; assets.releaseAll();
        expect(releaseTexture).toHaveBeenCalledTimes(1); expect(releaseTexture).toHaveBeenCalledWith(42);
        pending.resolve('{}'); expect(await request).toBeInstanceOf(Error);
        expect(releaseTexture).toHaveBeenCalledTimes(1);
    });
    it('rejects a new acquisition started by an unload before executing its loader', async () => {
        const assets = make(), nested = vi.fn(async () => ({ handle: 99 }));
        let request: Promise<unknown> | undefined;
        assets.register({ type: 'child', extensions: [], load: nested, unload: vi.fn() });
        assets.register({ type: 'parent', extensions: [], load: async () => ({}), unload: () => {
            assets.releaseAll(); // A nested release must not reopen the loading door.
            request = assets.acquireTyped('child', 'child').then(() => 'unexpected success', e => e);
        } });
        await assets.acquireTyped('parent', 'parent');
        assets.releaseAll();
        expect(await request).toBeInstanceOf(Error); expect(nested).not.toHaveBeenCalled();
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
        const next = await assets.acquireTyped('child', 'child');
        next.release(); expect(nested).toHaveBeenCalledTimes(1);
    });

    it('does not start a fallback typed loader if releaseAll occurs during slot lookup', async () => {
        const assets = make(), load = vi.fn(async () => ({}));
        assets.register({ type: 'probe', extensions: [], load, unload: vi.fn() });
        const request = assets.acquireTyped('probe', 'probe').then(() => null, e => e);
        assets.releaseAll(); expect(await request).toBeInstanceOf(Error);
        expect(load).not.toHaveBeenCalled(); expect(assets.sizes().refRows).toBe(0);
    });

    it('stops a stale source read before the loader can create a resource', async () => {
        const pending = deferred<string>(), entered = deferred<void>();
        const assets = make(async () => { entered.resolve(); return pending.promise; }), create = vi.fn();
        assets.register({ type: 'probe', extensions: [], load: async (_, ctx) => {
            await ctx.loadText('source'); create(); return {};
        }, unload: vi.fn() });
        const request = assets.acquireTyped('probe', 'probe').then(() => null, e => e);
        await entered.promise; assets.releaseAll(); pending.resolve('{}');
        expect(await request).toBeInstanceOf(Error); expect(create).not.toHaveBeenCalled();
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
    });

    it('an old loader resuming after teardown cannot acquire dependencies in the new epoch', async () => {
        const pending = deferred<void>(), entered = deferred<void>(), child = vi.fn(async () => ({}));
        const assets = make(); assets.register({ type: 'child', extensions: [], load: child, unload: vi.fn() });
        assets.register({ type: 'parent', extensions: [], load: async (_, ctx) => {
            entered.resolve(); await pending.promise; await ctx.acquireAsset('child', 'child'); return {};
        }, unload: vi.fn() });
        const request = assets.acquireTyped('parent', 'parent').then(() => null, e => e);
        await entered.promise; assets.releaseAll(); pending.resolve();
        expect(await request).toBeInstanceOf(Error); expect(child).not.toHaveBeenCalled();
        expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
    });

    it('rejects a stale binary before resource creation and allows a fresh request immediately', async () => {
        const pending = deferred<ArrayBuffer>(), entered = deferred<void>(), create = vi.fn();
        const assets = make(); let first = true;
        assets.backend.fetchBinary = async () => {
            if (first) { first = false; entered.resolve(); return pending.promise; }
            return new ArrayBuffer(2);
        };
        assets.register({ type: 'probe', extensions: [], load: async (_, ctx) => {
            await ctx.loadBinary('source'); create(); return {};
        }, unload: vi.fn() });
        const old = assets.acquireTyped('probe', 'probe').then(() => null, e => e);
        await entered.promise; assets.releaseAll();
        const next = await assets.acquireTyped('probe', 'probe');
        pending.resolve(new ArrayBuffer(1)); expect(await old).toBeInstanceOf(Error);
        expect(create).toHaveBeenCalledTimes(1); expect(assets.sizes().refRows).toBe(1);
        next.release(); expect(assets.sizes()).toMatchObject({ refRows: 0, genericCached: 0 });
    });
});
