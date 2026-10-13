// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: () => false }),
    getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));

const scene: SceneData = { version: 4, name: 'publication', entities: [{ id: 1, name: 'new', parent: null,
    children: [], components: [{ type: 'MeshRenderer', data: { mesh: 'mesh.esmesh' } }],
}] };

describe('scene publication failures', () => {
    it('rolls back only this load when its final spawn-phase observer throws', async () => {
        const world = new World(), existing = world.spawn(), error = new Error('observer failed');
        await expect(loadSceneWithAssets(world, scene, { onPhase: phase => {
            if (phase === 'spawn') throw error;
        } })).rejects.toBe(error);
        expect(world.getAllEntities()).toEqual([existing]);
    });
    it('rolls back entities and their asset receipts when reference tracking throws', async () => {
        const world = new World(), existing = world.spawn(), error = new Error('tracking failed');
        const unloaded = vi.fn();
        const assets = Assets.create({ backend: {
            fetchBinary: async () => new ArrayBuffer(8), fetchText: async () => '{}', resolveUrl: (path: string) => path,
        } as Backend, module: { _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(16) } as never });
        assets.register<{ handle: number }>({ type: 'mesh', load: async () => ({ handle: 1 }), unload: unloaded } as never);
        const tracker = vi.spyOn(assets, 'trackSceneAssetReferences').mockImplementation(() => { throw error; });
        try {
            await expect(loadSceneWithAssets(world, scene, { assets })).rejects.toBe(error);
            expect(world.getAllEntities()).toEqual([existing]);
            expect(assets.sizes()).toMatchObject({ refRows: 0, trackedRefRows: 0, genericCached: 0 });
            expect(unloaded).toHaveBeenCalledOnce();
            tracker.mockRestore();
            const retry = await loadSceneWithAssets(world, scene, { assets });
            expect(retry.size).toBe(1);
            for (const entity of retry.values()) world.despawn(entity);
            expect(assets.sizes().refRows).toBe(0);
        } finally { tracker.mockRestore(); assets.releaseAll(); for (const entity of world.getAllEntities()) world.despawn(entity); }
    });
});
