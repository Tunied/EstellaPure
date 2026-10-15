// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Removed } from '../src/ecs/query';
import { defineSystem, Schedule } from '../src/ecs/system';
import { UINode } from '../src/ui/core/ui-node';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('builtin removal delivery on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    let batches: Entity[][];
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry();
        app = App.new();
        app.connectCpp(registry, engine);
        batches = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([Removed(UINode)], rows => {
            batches.push(rows.toArray());
        }));
        flushPendingRegistrations(app);
    });
    afterEach(() => {
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp();
        registry.delete();
    });
    it.each(['remove', 'despawn'] as const)('delivers %s between frames exactly once', async operation => {
        const entity = app.world.spawn();
        app.world.insert(entity, UINode);
        await app.tick(1 / 60);
        if (operation === 'remove') app.world.remove(entity, UINode);
        else app.world.despawn(entity);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(batches).toEqual([[], [entity], []]);
        expect(app.world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('delivers a PostUpdate removal on the next frame', async () => {
        const entity = app.world.spawn();
        app.world.insert(entity, UINode);
        let remove = false;
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
            if (remove) {
                app.world.remove(entity, UINode);
                remove = false;
            }
        }));
        await app.tick(1 / 60);
        remove = true;
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(batches).toEqual([[], [], [entity], []]);
        expect(app.world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('delivers repeated builtin replacements without retaining completed batches', async () => {
        const entity = app.world.spawn();
        app.world.insert(entity, UINode);
        await app.tick(1 / 60);
        for (let frame = 0; frame < 20; frame++) {
            for (let i = 0; i < 100; i++) {
                app.world.remove(entity, UINode);
                app.world.insert(entity, UINode);
            }
            await app.tick(1 / 60);
            expect(batches.at(-1)).toEqual(Array(100).fill(entity));
            expect(app.world.getStorageSizes().changes.removedRows).toBe(0);
        }
    });
});
