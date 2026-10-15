// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, Canvas } from '../src/ecs/component';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';
import { setEditorMode, setPlayMode } from '../src/ecs/env';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { setEditorMode(false); setPlayMode(false); for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

async function scene() {
    engine.setActiveContext(null);
    const app = App.new(); apps.push(app);
    app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    const move = vi.spyOn(module, '_physics_setBodyTransform');
    const plugin = new Physics2DPlugin('', { gravity: { x: 0, y: 0 }, fixedTimestep: 1 / 60 }, async () => module);
    app.addPlugin(plugin);
    await app.getResource(Physics2DRuntime).initPromise;
    const world = app.world, parent = world.spawn(), unrelated = world.spawn(), bodies: number[] = [];
    world.insert(parent, Transform); world.insert(unrelated, Transform);
    for (let i = 0; i < 256; i++) {
        const body = world.spawn(); bodies.push(body);
        world.insert(body, Transform, { position: { x: i * 40, y: 0, z: 0 } });
        world.insert(body, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(body, BoxCollider2D, { halfExtents: { x: .05, y: .05 }, radius: 0 });
        world.setParent(body, parent);
    }
    await app.stepFrames(3, 1 / 60); move.mockClear();
    const hit = (body = bodies[0], y = 0) => app.getResource(Physics2D).raycast({ x: -50, y }, { x: 1, y: 0 }, 300)
        .find(value => value.entity === body);
    return { app, world, module, move, plugin, parent, unrelated, bodies, hit };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('sparse static physics synchronization', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('ignores unrelated authored motion and reads only the edited static child', async () => {
        const { app, world, move, unrelated, bodies, hit } = await scene();
        const ids = new Set(bodies), get = vi.spyOn(world, 'get'), changed = vi.spyOn(world, 'isChangedSince');
        for (let i = 0; i < 20; i++) {
            world.update(unrelated, Transform, value => { value.position.x++; });
            await app.tick(1 / 60);
        }
        expect(get.mock.calls.filter(([id, c]) => c === Transform && ids.has(id))).toHaveLength(0);
        expect(changed.mock.calls.filter(([id, c]) => c === Transform && ids.has(id))).toHaveLength(0);
        expect(move).not.toHaveBeenCalled();
        world.update(bodies[0], Transform, value => { value.position.x += 7; }); get.mockClear();
        await app.stepFrames(2, 1 / 60);
        expect(get.mock.calls.filter(([id, c]) => c === Transform && ids.has(id)).map(([id]) => id)).toEqual([bodies[0]]);
        expect(move).toHaveBeenCalledOnce(); expect(hit()?.point.x).toBeCloseTo(2, 3);
    });

    it('observes a native-driven parent while unrelated static groups stay untouched', async () => {
        const { app, world, parent, bodies, move, hit } = await scene();
        const stableParent = world.spawn(), stableBody = world.spawn();
        world.insert(stableParent, Transform); world.insert(stableBody, Transform, { position: { x: 0, y: 500, z: 0 } });
        world.insert(stableBody, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(stableBody, BoxCollider2D); world.setParent(stableBody, stableParent);
        await app.stepFrames(2, 1 / 60); move.mockClear();
        const get = vi.spyOn(world, 'get');
        // Native/AOT producers invalidate composition without recording a JS write.
        const ptr = engine.getTransformPtr(world.getCppRegistry()!, parent) >> 2;
        engine.HEAPF32[ptr + 1] = 30; world.invalidateTransformComposition();
        await app.stepFrames(2, 1 / 60);
        expect(move).toHaveBeenCalledTimes(bodies.length);
        expect(hit(bodies[0], 30)?.point.x).toBeCloseTo(-5, 3);
        expect(get.mock.calls.filter(([id, c]) => id === stableBody && c === Transform)).toHaveLength(0);
    });

    it('refreshes reparented, re-enabled and rescaled bodies without recreating them', async () => {
        const { app, world, parent, bodies, hit, module } = await scene();
        const first = bodies[0], second = world.spawn(), canvas = world.spawn();
        world.insert(second, Transform, { position: { x: 50, y: 0, z: 0 } });
        world.insert(canvas, Canvas, { pixelsPerUnit: 100 });
        await app.tick(1 / 60); const count = module._physics_getBodyCount();
        world.setParent(first, second); await app.stepFrames(2, 1 / 60);
        expect(hit()?.point.x).toBeCloseTo(45, 3);
        world.update(first, RigidBody2D, value => { value.enabled = false; }); await app.tick(1 / 60);
        world.update(first, Transform, value => { value.position.x = 10; }); await app.tick(1 / 60);
        world.update(first, RigidBody2D, value => { value.enabled = true; }); await app.tick(1 / 60);
        expect(hit()?.point.x).toBeCloseTo(55, 3);
        world.update(canvas, Canvas, value => { value.pixelsPerUnit = 200; }); await app.tick(1 / 60);
        expect(hit()?.point.x).toBeCloseTo(50, 3);
        world.setParent(first, parent); await app.tick(1 / 60);
        expect(hit()?.point.x).toBeCloseTo(0, 3); expect(module._physics_getBodyCount()).toBe(count);
    });

    it.each(['host', 'editor'] as const)('releases write history during %s pause and refreshes on resume', async mode => {
        const { app, world, bodies, hit, plugin } = await scene();
        expect(world.writeReaderCount(Transform)).toBe(1);
        if (mode === 'host') app.setPaused(true); else { setEditorMode(true); setPlayMode(false); }
        await app.tick(1 / 60);
        expect(world.writeReaderCount(Transform)).toBe(0);
        for (let i = 0; i < 50; i++) { world.update(bodies[0], Transform, value => { value.position.x += 1; }); await app.tick(1 / 60); }
        expect(world.bufferedWriteRows(Transform)).toBe(0);
        if (mode === 'host') app.setPaused(false); else setPlayMode(true);
        await app.stepFrames(2, 1 / 60);
        expect(hit()?.point.x).toBeCloseTo(45, 3); expect(world.writeReaderCount(Transform)).toBe(1);
        plugin.cleanup(app);
        expect(world.writeReaderCount(Transform)).toBe(0); expect(world.bufferedWriteRows(Transform)).toBe(0);
    });
});
