// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Parent } from '../src/ecs/component';
import { instantiatePrefab, type PrefabData } from '../src/prefab';
import type { ESEngineModule } from '../src/wasm';
import { INVALID_ENTITY } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const prefab: PrefabData = { version: '2', name: 'parented', rootEntityId: 'root', entities: [
    { prefabEntityId: 'root', name: 'root', parent: null, children: ['child'], visible: true, components: [] },
    { prefabEntityId: 'child', name: 'child', parent: 'root', children: [], visible: true, components: [] },
] };

describe.skipIf(!HAS_WASM)('async prefab parenting on real WASM', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    it('rolls back the spawned hierarchy when its requested parent disappears', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const parent = app.world.spawn();
            const pending = instantiatePrefab(app.world, prefab, { parent });
            app.world.despawn(parent);
            await expect(pending).rejects.toThrow(/parent/);
            expect(app.world.getAllEntities()).toHaveLength(0);
        } finally { app.quit(); }
    });
    it('attaches the hierarchy to a live parent and releases it with that parent', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const parent = app.world.spawn();
            const result = await instantiatePrefab(app.world, prefab, { parent });
            expect(app.world.get(result.root, Parent).entity).toBe(parent);
            expect(app.world.getAllEntities()).toHaveLength(3);
            app.world.despawn(parent);
            expect(app.world.getAllEntities()).toHaveLength(0);
        } finally { app.quit(); }
    });
    it('accepts the explicit no-parent sentinel', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const result = await instantiatePrefab(app.world, prefab, { parent: INVALID_ENTITY });
            expect(app.world.valid(result.root)).toBe(true);
            expect(app.world.has(result.root, Parent)).toBe(false);
            expect(app.world.getAllEntities()).toHaveLength(2);
        } finally { app.quit(); }
    });
});
