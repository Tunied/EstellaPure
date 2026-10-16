// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, Canvas } from '../src/ecs/component';
import { Time } from '../src/ecs/resource';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import {
    RigidBody2D, BoxCollider2D, BodyType, DistanceJoint2D,
    HingeJoint2D, SliderJoint2D, FixedJoint2D, WheelJoint2D, MotorJoint2D,
} from '../src/physics/PhysicsComponents';
import type { ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

async function scene(legacy = false) {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app);
    const registry = new core.Registry(); app.connectCpp(registry, core, { ownedRegistry: true });
    if (legacy) registry.componentTypeId = undefined;
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    const create = vi.spyOn(module, '_physics_createDistanceJoint');
    const destroy = vi.spyOn(module, '_physics_destroyJoint');
    const otherCreates = [
        vi.spyOn(module, '_physics_createRevoluteJoint'), vi.spyOn(module, '_physics_createPrismaticJoint'),
        vi.spyOn(module, '_physics_createWeldJoint'), vi.spyOn(module, '_physics_createWheelJoint'),
        vi.spyOn(module, '_physics_createMotorJoint'),
    ];
    app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 }, fixedTimestep: 1 / 60 }, async () => module));
    await app.getResource(Physics2DRuntime).initPromise;
    const world = app.world, anchor = world.spawn(), owner = world.spawn(), other = world.spawn();
    for (const entity of [anchor, owner, other]) {
        world.insert(entity, Transform, { position: { x: entity === owner ? 40 : 0, y: 0, z: 0 } });
        world.insert(entity, RigidBody2D, { bodyType: entity === owner ? BodyType.Dynamic : BodyType.Static });
        world.insert(entity, BoxCollider2D, { halfExtents: { x: .01, y: .01 }, radius: 0 });
    }
    world.insert(owner, DistanceJoint2D, { connectedEntity: anchor, length: 40 });
    await app.stepFrames(3, 1 / 60);
    expect(module._physics_getJointCount()).toBe(1);
    create.mockClear(); destroy.mockClear();
    return { app, world, registry, module, anchor, owner, other, create, destroy, otherCreates };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('joint projection reconciliation', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    it('retains the live joint when a different collider is edited while paused', async () => {
        const { app, world, module, owner, other, create, destroy } = await scene();
        module._physics_setDistanceJointLength(owner, .75);
        app.getResource(Time).scale = 0; await app.tick(1 / 60);
        world.update(other, BoxCollider2D, value => { value.halfExtents.x = .02; });
        app.getResource(Time).scale = 1; await app.tick(1 / 60);
        expect(destroy).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.75);
        expect(module._physics_getJointCount()).toBe(1);
    });

    it('retains a native joint when the authored definition is replaced identically', async () => {
        const { app, world, module, owner, create, destroy } = await scene();
        module._physics_setDistanceJointLength(owner, .75);
        world.insert(owner, DistanceJoint2D, world.get(owner, DistanceJoint2D));
        await app.tick(1 / 60);
        expect(destroy).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.75);
    });

    it('applies a joint definition change once', async () => {
        const { app, world, module, owner, create, destroy } = await scene();
        world.update(owner, DistanceJoint2D, joint => { joint.length = 60; }); await app.tick(1 / 60);
        expect(destroy).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.6);
        await app.tick(1 / 60); expect(create).toHaveBeenCalledOnce();
    });

    it('recovers a solver joint lost before an unrelated authoring edit', async () => {
        const { app, world, module, owner, other, create } = await scene();
        module._physics_destroyJoint(owner);
        expect(module._physics_hasJoint(owner)).toBe(0);
        world.update(other, BoxCollider2D, value => { value.halfExtents.x = .02; });
        await app.tick(1 / 60);
        expect(create).toHaveBeenCalledOnce(); expect(module._physics_hasJoint(owner)).toBe(1);
        expect(module._physics_getJointCount()).toBe(1);
    });

    it('rescales joint lengths when only the live Canvas scale changes', async () => {
        const { app, world, module, owner, create, destroy } = await scene();
        const canvas = world.spawn(); world.insert(canvas, Canvas, { pixelsPerUnit: 200 });
        await app.tick(1 / 60);
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.2);
        expect(destroy).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
        world.update(canvas, Canvas, value => { value.pixelsPerUnit = 400; });
        await app.tick(1 / 60);
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.1);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it.each([HingeJoint2D, DistanceJoint2D, SliderJoint2D, FixedJoint2D, WheelJoint2D, MotorJoint2D])(
        'retains $name through a paused full refresh and respects enabled edits', async component => {
            const { app, world, module, owner, anchor, other, create, destroy, otherCreates } = await scene();
            world.remove(owner, DistanceJoint2D);
            world.insert(owner, component, { connectedEntity: anchor });
            await app.tick(1 / 60); expect(module._physics_getJointCount()).toBe(1);
            for (const spy of [create, destroy, ...otherCreates]) spy.mockClear();
            app.getResource(Time).scale = 0; await app.tick(1 / 60);
            world.update(other, BoxCollider2D, value => { value.halfExtents.x = .03; });
            app.getResource(Time).scale = 1; await app.tick(1 / 60);
            for (const spy of [create, destroy, ...otherCreates]) expect(spy).not.toHaveBeenCalled();
            world.update(owner, component, value => { value.enabled = false; }); await app.tick(1 / 60);
            expect(module._physics_getJointCount()).toBe(0);
            world.update(owner, component, value => { value.enabled = true; }); await app.tick(1 / 60);
            expect(module._physics_getJointCount()).toBe(1);
        },
    );

    it('recreates a joint after its partner body disappears and returns', async () => {
        const { app, world, module, anchor, owner, create } = await scene();
        const body = { ...world.get(anchor, RigidBody2D) };
        world.remove(anchor, RigidBody2D); await app.tick(1 / 60);
        expect(module._physics_getJointCount()).toBe(0);
        world.insert(anchor, RigidBody2D, body); await app.tick(1 / 60);
        expect(module._physics_hasJoint(owner)).toBe(1); expect(create).toHaveBeenCalledOnce();
    });

    it('keeps identical authored writes stable with an older core', async () => {
        const { app, world, module, owner, create, destroy } = await scene(true);
        module._physics_setDistanceJointLength(owner, .8);
        world.insert(owner, DistanceJoint2D, world.get(owner, DistanceJoint2D));
        await app.tick(1 / 60);
        expect(destroy).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.8);
        world.update(owner, DistanceJoint2D, value => { value.length = 90; }); await app.tick(1 / 60);
        expect(module._physics_getDistanceJointLength(owner)).toBeCloseTo(.9);
    });

    it('retains a dense constraint set when one unrelated collider changes during pause', async () => {
        const { app, world, module, anchor, other, create, destroy } = await scene();
        for (let i = 0; i < 128; ++i) {
            const entity = world.spawn();
            world.insert(entity, Transform, { position: { x: 100, y: 0, z: 0 } });
            world.insert(entity, RigidBody2D, { bodyType: BodyType.Dynamic });
            world.insert(entity, DistanceJoint2D, { connectedEntity: anchor, length: 100 });
        }
        await app.tick(1 / 60); expect(module._physics_getJointCount()).toBe(129);
        create.mockClear(); destroy.mockClear();
        app.getResource(Time).scale = 0; await app.tick(1 / 60);
        world.update(other, BoxCollider2D, value => { value.halfExtents.x = .04; });
        app.getResource(Time).scale = 1; await app.tick(1 / 60);
        expect(create).not.toHaveBeenCalled(); expect(destroy).not.toHaveBeenCalled();
        expect(module._physics_getJointCount()).toBe(129);
    });
});
