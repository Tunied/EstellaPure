// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { World } from '../src/ecs/world';
import { spawnPrepared } from '../src/prefab/preparedPrefab';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule } from '../src/wasm';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: () => false }),
    getResourceManager: () => null, evictTextureDimensions: vi.fn(),
}));

describe.skipIf(!HAS_WASM)('prepared parent rejection releases real asset leases', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    it('preserves preparation ownership while releasing every failed spawned copy', async () => {
        const registry = new engine.Registry(), world = new World(); world.connectCpp(registry, engine);
        const unloaded = vi.fn();
        const prefab = { version: '2', name: 'owned', rootEntityId: 'root', entities: [
            { prefabEntityId: 'root', name: 'root', parent: null, children: [], visible: true,
                components: [{ type: 'MeshRenderer', data: { mesh: 'mesh.esmesh' } }] },
        ] };
        const assets = Assets.create({ module: engine, backend: {
            fetchBinary: async () => new ArrayBuffer(8), fetchText: async () => JSON.stringify(prefab),
            resolveUrl: (path: string) => `http://test/${path}`,
        } as Backend });
        assets.register<{ handle: number }>({ type: 'mesh', load: async () => ({ handle: 1 }), unload: unloaded } as never);
        try {
            const prepared = await assets.preparePrefab('root.esprefab');
            const before = assets.sizes().refRows;
            for (let i = 0; i < 20; i++) {
                const parent = world.spawn(); world.despawn(parent);
                expect(() => spawnPrepared(world, prepared, { parent })).toThrow(/parent/);
                expect(world.getAllEntities()).toHaveLength(0);
                expect(assets.sizes().refRows).toBe(before);
            }
            expect(unloaded).not.toHaveBeenCalled();
            const live = spawnPrepared(world, prepared);
            expect(assets.sizes().refRows).toBeGreaterThan(before);
            world.despawn(live.root);
            expect(assets.sizes().refRows).toBe(before);
            prepared.release();
            expect(assets.sizes()).toMatchObject({ refRows: 0, registrySlots: 0, trackedRefRows: 0 });
            expect(unloaded).toHaveBeenCalledOnce();
        } finally { assets.releaseAll(); for (const entity of world.getAllEntities()) world.despawn(entity); registry.delete(); }
    });
});
