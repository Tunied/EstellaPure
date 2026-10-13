// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });
describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('static Box2D transform projection', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });
    it.each([false, true])('moves a static body in place without repeated writes (parented=%s)', async parented => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<PhysicsWasmModule>('physics');
        app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 } }, async () => module));
        await app.getResource(Physics2DRuntime).initPromise;
        const world = app.world, body = world.spawn();
        world.insert(body, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.insert(body, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(body, BoxCollider2D, { halfExtents: { x: .1, y: .1 } });
        const driver = parented ? world.spawn() : body;
        if (parented) { world.insert(driver, Transform, {}); world.setParent(body, driver); }
        const move = vi.spyOn(module, '_physics_setBodyTransform');
        const create = vi.spyOn(module, '_physics_createBody');
        await app.stepFrames(2, 1 / 30);
        const api = app.getResource(Physics2D);
        const hit = () => api.raycast({ x: -50, y: 0 }, { x: 1, y: 0 }, 200).find(value => value.entity === body)!;
        const before = hit().point.x;
        world.update(driver, Transform, value => { value.position.x += 30; });
        await app.stepFrames(2, 1 / 30);
        expect(hit().point.x).toBeCloseTo(before + 30, 3);
        expect(create).toHaveBeenCalledTimes(1);
        expect(move.mock.calls).toHaveLength(1);
        move.mockClear();
        await app.stepFrames(20, 1 / 30);
        expect(move).not.toHaveBeenCalled();
        expect(module._physics_hasBody(body)).toBe(1);
        world.update(body, Transform, value => { value.position.x += 20; });
        await app.stepFrames(2, 1 / 30);
        expect(hit().point.x).toBeCloseTo(before + 50, 3);
        expect(move.mock.calls).toHaveLength(1);
    });
    it('keeps batched dynamic writeback when static bodies have parents', async () => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<PhysicsWasmModule>('physics');
        app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 } }, async () => module));
        await app.getResource(Physics2DRuntime).initPromise;
        const parent = app.world.spawn(); app.world.insert(parent, Transform);
        const platform = app.world.spawn(); app.world.insert(platform, Transform);
        app.world.insert(platform, RigidBody2D, { bodyType: BodyType.Static });
        app.world.insert(platform, BoxCollider2D, {}); app.world.setParent(platform, parent);
        const dynamic = app.world.spawn();
        app.world.insert(dynamic, Transform, { position: { x: 100, y: 100, z: 0 } });
        app.world.insert(dynamic, RigidBody2D, { bodyType: BodyType.Dynamic });
        app.world.insert(dynamic, BoxCollider2D, {});
        const batch = vi.spyOn(engine, 'registry_batchSyncPhysicsTransforms');
        await app.stepFrames(2, 1 / 30);
        expect(batch).toHaveBeenCalled();
    });
    it('skips unchanged child pose reads while a dynamic body keeps composition active', async () => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<PhysicsWasmModule>('physics');
        app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 } }, async () => module));
        await app.getResource(Physics2DRuntime).initPromise;
        const world = app.world, parent = world.spawn(), bodies = new Set<number>();
        world.insert(parent, Transform);
        for (let i = 0; i < 10; i++) {
            const body = world.spawn(); bodies.add(body);
            world.insert(body, Transform, { position: { x: i * 30, y: 0, z: 0 } });
            world.insert(body, RigidBody2D, { bodyType: BodyType.Static });
            world.insert(body, BoxCollider2D, {}); world.setParent(body, parent);
        }
        const dynamic = world.spawn();
        world.insert(dynamic, Transform, { position: { x: 1000, y: 1000, z: 0 } });
        world.insert(dynamic, RigidBody2D, { bodyType: BodyType.Dynamic });
        world.insert(dynamic, BoxCollider2D, {});
        await app.stepFrames(3, 1 / 30);
        module._physics_setLinearVelocity(dynamic, 1, 0);
        const get = vi.spyOn(world, 'get');
        await app.stepFrames(20, 1 / 30);
        expect(get.mock.calls.filter(([entity, component]) => component === Transform && bodies.has(entity)))
            .toHaveLength(0);
    });
    it('keeps moving static children when their grouping parent has no Transform', async () => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<PhysicsWasmModule>('physics');
        app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 } }, async () => module));
        await app.getResource(Physics2DRuntime).initPromise;
        const parent = app.world.spawn(), body = app.world.spawn();
        app.world.insert(body, Transform, { position: { x: 5, y: 0, z: 0 } });
        app.world.insert(body, RigidBody2D, { bodyType: BodyType.Static });
        app.world.insert(body, BoxCollider2D, { halfExtents: { x: .1, y: .1 } });
        app.world.setParent(body, parent);
        await app.stepFrames(3, 1 / 30);
        app.world.update(body, Transform, value => { value.position.x += 30; });
        await app.stepFrames(2, 1 / 30);
        const hit = app.getResource(Physics2D).raycast({ x: -50, y: 0 }, { x: 1, y: 0 }, 200)
            .find(value => value.entity === body);
        expect(hit?.point.x).toBeCloseTo(25, 3);
    });
});
