// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { ComponentMutationReader } from '../src/ecs/ComponentMutationReader';
import { Transform, Disabled } from '../src/ecs/component';
import { Time } from '../src/ecs/resource';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';
import { ENTITY_CHANGE_CAPACITY } from '../src/wasm/constants.generated';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

async function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app);
    const registry = new core.Registry(); app.connectCpp(registry, core, { ownedRegistry: true });
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    const clear = vi.spyOn(module, "_physics_clearShapes");
    const properties = vi.spyOn(module, "_physics_updateBodyProperties");
    vi.spyOn(module, "_physics_setBodyTransforms"); const poses = vi.mocked(module._physics_setBodyTransforms!);
    const plugin = new Physics2DPlugin('', { gravity: { x: 0, y: 0 }, fixedTimestep: 1 / 60 }, async () => module);
    app.addPlugin(plugin); await app.getResource(Physics2DRuntime).initPromise;
    const world = app.world, root = world.spawn(), unrelated = world.spawn(), bodies: Entity[] = [];
    world.insert(root, Transform); world.insert(unrelated, Transform); world.insert(unrelated, Disabled);
    for (let i = 0; i < 256; ++i) {
        const entity = world.spawn(); bodies.push(entity);
        world.insert(entity, Transform, { position: { x: i * 40, y: 0, z: 0 } });
        world.insert(entity, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(entity, BoxCollider2D, { halfExtents: { x: .05, y: .05 }, radius: 0 });
        world.setParent(entity, root);
    }
    await app.stepFrames(3, 1 / 60);
    clear.mockClear(); properties.mockClear(); poses.mockClear();
    const get = vi.spyOn(world, 'get');
    const bodyReads = () => get.mock.calls.filter(([, component]) => component === RigidBody2D).map(([entity]) => entity);
    const hit = (entity = bodies[0]) => app.getResource(Physics2D).raycast({ x: -50, y: 0 }, { x: 1, y: 0 }, 300)
        .find(value => value.entity === entity)?.point.x;
    return { app, world, registry, module, plugin, root, unrelated, bodies, get, clear, properties, poses, bodyReads, hit };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('component-driven physical body reconciliation', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    it('reconciles one collider edit without reading or resubmitting the other bodies', async () => {
        const { app, world, bodies, bodyReads, clear, poses, hit } = await scene();
        world.update(bodies[0], BoxCollider2D, value => { value.halfExtents.x = .1; });
        await app.tick(1 / 60);
        expect(bodyReads()).toEqual([bodies[0]]);
        expect(clear).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(bodies[0]);
        expect(poses).not.toHaveBeenCalled();
        expect(hit()).toBeCloseTo(-10, 3);
    });

    it('ignores unrelated structural changes even when the world has inactive UI', async () => {
        const { app, world, bodies, root, bodyReads, clear } = await scene();
        const entity = world.spawn(); world.insert(entity, Transform); world.setParent(entity, root);
        await app.tick(1 / 60); world.despawn(entity); await app.tick(1 / 60);
        expect(bodyReads()).toEqual([]); expect(clear).not.toHaveBeenCalled();
        const parent = world.spawn(); world.insert(parent, Transform, { position: { x: 25, y: 0, z: 0 } });
        world.setParent(bodies[0], parent); await app.tick(1 / 60);
        expect(bodyReads()).toEqual([bodies[0]]);
    });

    it('observes native collider and body replacements without SDK write notifications', async () => {
        const { app, registry, bodies, bodyReads, clear, properties, hit } = await scene();
        const collider = registry.getBoxCollider2D(bodies[0]); collider.halfExtents.x = .2;
        registry.addBoxCollider2D(bodies[0], collider);
        const body = registry.getRigidBody2D(bodies[0]); body.linearDamping = .7;
        registry.addRigidBody2D(bodies[0], body);
        await app.tick(1 / 60);
        expect(bodyReads()).toEqual([bodies[0]]); expect(clear).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(bodies[0]);
        expect(properties).toHaveBeenCalledOnce(); expect(hit()).toBeCloseTo(-20, 3);
    });

    it('refreshes native body membership and recreates the missing solver body', async () => {
        const { app, world, registry, module, bodies } = await scene();
        const entity = bodies[0], body = registry.getRigidBody2D(entity);
        registry.removeRigidBody2D(entity); await app.tick(1 / 60);
        expect(module._physics_getBodyCount()).toBe(255);
        expect(world.has(entity, RigidBody2D)).toBe(false);
        registry.addRigidBody2D(entity, body); await app.tick(1 / 60);
        expect(module._physics_getBodyCount()).toBe(256);
        expect(world.getEntitiesWithComponents([RigidBody2D, Transform])).toContain(entity);
    });

    it('refreshes an edited hidden collider when its native ancestor is re-enabled', async () => {
        const { app, world, registry, module, root, bodies, hit, clear } = await scene();
        registry.setEntityEnabled!(root, false); await app.tick(1 / 60);
        world.update(bodies[0], BoxCollider2D, value => { value.halfExtents.x = .15; });
        await app.tick(1 / 60); expect(hit()).toBeUndefined();
        registry.setEntityEnabled!(root, true); await app.tick(1 / 60);
        expect(module._physics_getBodyCount()).toBe(256);
        expect(clear).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(bodies[0]);
        expect(hit()).toBeCloseTo(-15, 3);
    });

    it('releases stopped readers and compares collider snapshots on resume', async () => {
        const { app, world, registry, bodies, clear, hit } = await scene();
        app.getResource(Time).scale = 0; await app.tick(1 / 60);
        expect(world.writeReaderCount(RigidBody2D)).toBe(0);
        expect(world.topologyReaderCount(RigidBody2D)).toBe(0);
        expect(world.writeReaderCount(Transform)).toBe(0);
        const collider = registry.getBoxCollider2D(bodies[0]); collider.halfExtents.x = .12;
        registry.addBoxCollider2D(bodies[0], collider);
        app.getResource(Time).scale = 1; await app.tick(1 / 60);
        expect(clear).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(bodies[0]);
        expect(hit()).toBeCloseTo(-12, 3);
    });

    it('applies two collider edits in two fixed steps of the same world tick', async () => {
        const { app, world, bodies, clear, hit } = await scene();
        let edits = 0; const hits: number[] = [];
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem([], () => {
            world.update(bodies[0], BoxCollider2D, value => { value.halfExtents.x = ++edits === 1 ? .1 : .15; });
        }, { name: 'EditColliderEachFixedStep' }));
        app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem([], () => { hits.push(hit()!); }, { name: 'ReadEditedShape' }));
        vi.spyOn(performance, 'now').mockReturnValue(0);
        await app.tick(2 / 60);
        expect(edits).toBe(2); expect(clear).toHaveBeenCalledTimes(2);
        expect(hits[0]).toBeCloseTo(-10, 3); expect(hits[1]).toBeCloseTo(-15, 3);
    });

    it('observes native Transform replacement without reconciling body definitions', async () => {
        const { app, registry, bodies, bodyReads, poses, hit } = await scene();
        const transform = registry.getTransform(bodies[0]); transform.position.x = 20;
        registry.addTransform(bodies[0], transform); await app.tick(1 / 60);
        expect(bodyReads()).toEqual([]); expect(poses).toHaveBeenCalledOnce();
        expect(poses.mock.calls[0][1]).toBe(1); expect(hit()).toBeCloseTo(15, 3);
    });

    it('refreshes after native history overflow while preserving solver velocity and unchanged shapes', async () => {
        const { app, world, registry, module, unrelated, bodies, clear } = await scene();
        const entity = bodies[0];
        world.update(entity, RigidBody2D, value => { value.bodyType = BodyType.Dynamic; });
        await app.tick(1 / 60); module._physics_setLinearVelocity(entity, 1, 0);
        for (let i = 0; i <= ENTITY_CHANGE_CAPACITY; ++i) {
            registry.addVelocity(unrelated, { linear: { x: i, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
        }
        const collider = registry.getBoxCollider2D(entity); collider.halfExtents.x = .08;
        registry.addBoxCollider2D(entity, collider); await app.tick(1 / 60);
        expect(module._physics_getBodyCount()).toBe(256);
        expect(clear).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(entity);
        expect(module.HEAPF32[module._physics_getLinearVelocity(entity) >>> 2]).toBeCloseTo(1, 5);
    });

    it('releases its native lease before disconnect and removes the lifecycle observer on cleanup', async () => {
        const { app, world, registry, plugin } = await scene();
        const unwatch = vi.spyOn(core, 'registry_unwatchEntityChanges');
        expect(world.getStorageSizes().coreDisconnectCallbacks).toBe(1);
        world.disconnectCpp();
        expect(unwatch).toHaveBeenCalledOnce();
        expect(world.writeReaderCount(RigidBody2D)).toBe(0);
        expect(core.registry_readEntityChanges!(registry, 0, 0, 0)).toBe(-1);
        plugin.cleanup(app);
        expect(world.getStorageSizes().coreDisconnectCallbacks).toBe(0);
        expect(world.writeReaderCount(Transform)).toBe(0);
        expect(unwatch).toHaveBeenCalledOnce();
    });

    it('invalidates projections after a core switch and cannot reopen a disposed reader', () => {
        const world = new World(), first = new core.Registry(), second = new core.Registry();
        world.connectCpp(first, core);
        const entity = world.spawn(); world.insert(entity, Transform);
        expect(second.create()).toBe(entity);
        second.addTransform(entity, first.getTransform(entity));
        const reader = new ComponentMutationReader(world, [Transform], [], []);
        try {
            reader.commit(reader.read()!);
            world.connectCpp(second, core);
            expect(core.registry_readEntityChanges!(first, 0, 0, 0)).toBe(-1);
            const current = reader.read()!;
            expect(current.full).toBe(true); expect(current.reset).toBe(true);
            reader.commit(current); reader.dispose();
            expect(reader.read()).toBeNull();
            expect(world.writeReaderCount(Transform)).toBe(0);
            expect(core.registry_readEntityChanges!(second, 0, 0, 0)).toBe(-1);
        } finally {
            reader.dispose(); world.disconnectCpp(); first.delete(); second.delete();
        }
    });
});
