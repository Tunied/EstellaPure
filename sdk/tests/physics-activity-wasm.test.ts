// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Transform, Disabled } from '../src/ecs/component';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { RigidBody2D, BoxCollider2D } from '../src/physics/PhysicsComponents';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('real Box2D hierarchy activity', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('applies collider and body edits made while an ancestor is inactive', async () => {
        setDefaultContext(new AppContext());
        const registry = new engine.Registry() as unknown as CppRegistry;
        const app = App.new(); app.connectCpp(registry, engine);
        const physics = await loadSideModule<PhysicsWasmModule>('physics');
        const plugin = new Physics2DPlugin('', { gravity: { x: 0, y: -10 } }, async () => physics);
        plugin.build(app);
        try {
            await app.getResource(Physics2DRuntime).initPromise;
            const world = app.world, parent = world.spawn(), child = world.spawn();
            world.insert(parent, Transform);
            world.insert(child, Transform, { position: { x: 0, y: 100, z: 0 } });
            world.insert(child, RigidBody2D, { bodyType: 2, gravityScale: 0 });
            world.insert(child, BoxCollider2D); world.setParent(child, parent);
            await app.stepFrames(1, 1 / 30);
            expect(physics._physics_getShapeCount()).toBe(1);
            world.insert(parent, Disabled);
            await app.stepFrames(1, 1 / 30);
            world.update(child, BoxCollider2D, value => { value.enabled = false; });
            world.update(child, RigidBody2D, value => { value.gravityScale = 1; });
            await app.stepFrames(5, 1 / 30);
            const before = world.get(child, Transform).position.y;
            world.remove(parent, Disabled);
            await app.stepFrames(5, 1 / 30);
            expect(physics._physics_getShapeCount()).toBe(0);
            expect(world.get(child, Transform).position.y).toBeLessThan(before);
            expect(physics._physics_hasBody(child)).toBe(1);
            world.update(child, BoxCollider2D, value => { value.enabled = true; });
            await app.stepFrames(1, 1 / 30);
            expect(physics._physics_getShapeCount()).toBe(1);
        } finally { plugin.cleanup(); app.world.disconnectCpp(); registry.delete(); }
    });

    it.each(['authored', 'native', 'body'] as const)('freezes and resumes a child without losing velocity (%s)', async (path) => {
        setDefaultContext(new AppContext());
        const registry = new engine.Registry() as unknown as CppRegistry;
        const app = App.new(); app.connectCpp(registry, engine);
        const physics = await loadSideModule<PhysicsWasmModule>('physics');
        const plugin = new Physics2DPlugin('', { gravity: { x: 0, y: 0 } }, async () => physics);
        plugin.build(app);
        try {
            await app.getResource(Physics2DRuntime).initPromise;
            const world = app.world;
            const parent = world.spawn('parent');
            world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
            const child = world.spawn('body');
            world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
            world.insert(child, RigidBody2D, { bodyType: 2 });
            world.insert(child, BoxCollider2D, {});
            world.setParent(child, parent);
            await app.stepFrames(1, 1 / 30);
            expect(physics._physics_hasBody(child)).toBe(1);
            physics._physics_setLinearVelocity(child, 2, 0);
            physics._physics_setAngularVelocity(child, 0.5);
            await app.stepFrames(3, 1 / 30);
            const position = () => world.get(child, Transform).position.x;
            const before = position();
            const enable = (active: boolean) => {
                if (path === 'body') world.update(child, RigidBody2D, rb => { rb.enabled = active; });
                else if (path === 'native') registry.setEntityEnabled!(parent, active);
                else if (active) world.remove(parent, Disabled);
                else world.insert(parent, Disabled, {});
            };
            enable(false);
            await app.stepFrames(3, 1 / 30);
            expect(position()).toBeCloseTo(before, 4);
            expect(physics._physics_hasBody(child), 'inactive bodies keep their simulation state').toBe(1);
            expect(physics._physics_getInterpolatedCount()).toBe(0);
            const pausedVelocity = physics._physics_getLinearVelocity(child);
            expect(physics.HEAPF32[pausedVelocity >> 2]).toBeCloseTo(2);
            expect(physics._physics_getAngularVelocity(child)).toBeCloseTo(0.5);
            // Edits while paused become the resumed state, including after a
            // repeated disable (which must not overwrite the stored velocity).
            physics._physics_setLinearVelocity(child, 3, 0);
            physics._physics_setAngularVelocity(child, 0.75);
            physics._physics_setBodyEnabled(child, 0);
            enable(true);
            await app.stepFrames(3, 1 / 30);
            expect(position()).toBeGreaterThan(before + 1);
            const ptr = physics._physics_getLinearVelocity(child);
            expect(physics.HEAPF32[ptr >> 2]).toBeCloseTo(3);
            expect(physics._physics_getAngularVelocity(child)).toBeCloseTo(0.75);
            enable(false);
            await app.stepFrames(1, 1 / 30);
            world.remove(child, RigidBody2D);
            await app.stepFrames(1, 1 / 30);
            expect(physics._physics_hasBody(child)).toBe(0);
        } finally {
            plugin.cleanup(); app.world.disconnectCpp(); (registry as any).delete();
        }
    });
});
