// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, Disabled } from '../src/ecs/component';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import { batchStaticPoses2D } from '../src/physics/batchStaticPoses2D';
import { ENTITY_POSE_2D_WORDS } from '../src/wasm/constants.generated';
import type { ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

async function scene(batch: boolean) {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app);
    app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    if (!batch) module._physics_setBodyTransforms = undefined;
    const scalar = vi.spyOn(module, '_physics_setBodyTransform');
    if (batch) vi.spyOn(module, '_physics_setBodyTransforms');
    const bulk = batch ? vi.mocked(module._physics_setBodyTransforms!) : null;
    app.addPlugin(new Physics2DPlugin('', { gravity: { x: 0, y: 0 }, fixedTimestep: 1 / 60 }, async () => module));
    await app.getResource(Physics2DRuntime).initPromise;
    const world = app.world, parent = world.spawn(), bodies: number[] = [];
    world.insert(parent, Transform);
    for (let i = 0; i < 32; i++) {
        const body = world.spawn(); bodies.push(body);
        world.insert(body, Transform, { position: { x: i * 40, y: 0, z: 0 } });
        world.insert(body, RigidBody2D, { bodyType: BodyType.Static });
        world.insert(body, BoxCollider2D, { halfExtents: { x: .05, y: .05 }, radius: 0 });
        world.setParent(body, parent);
    }
    await app.stepFrames(2, 1 / 60); scalar.mockClear(); bulk?.mockClear();
    return { app, world, module, scalar, bulk, parent, bodies };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('batched composed physics poses', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    it.each([false, true])('moves collision through a rotated parent without recreation (batch=%s)', async batch => {
        const { app, world, module, scalar, bulk, parent, bodies } = await scene(batch);
        const before = module._physics_getBodyCount(), angle = .37;
        world.update(parent, Transform, tf => {
            tf.position = { x: 17, y: 33, z: 5 };
            tf.rotation = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
        });
        await app.stepFrames(2, 1 / 60);
        const direction = { x: -Math.sin(angle), y: Math.cos(angle) };
        const hit = app.getResource(Physics2D).raycast({ x: 17 + direction.x * 20, y: 33 + direction.y * 20 },
            { x: -direction.x, y: -direction.y }, 40).find(hit => hit.entity === bodies[0]);
        expect(hit).toBeDefined();
        expect(hit!.point.x).toBeCloseTo(17 + direction.x * 5, 3);
        expect(hit!.point.y).toBeCloseTo(33 + direction.y * 5, 3);
        expect(module._physics_getBodyCount()).toBe(before);
        if (batch) {
            expect(scalar).not.toHaveBeenCalled(); expect(bulk).toHaveBeenCalledOnce();
            expect(bulk!.mock.results[0].value).toBe(bodies.length);
        } else expect(scalar).toHaveBeenCalledTimes(bodies.length);
    });

    it('exports lazy composed fields and filters inactive, stale and transformless ids', async () => {
        const { world, parent, bodies } = await scene(true), invalid = world.spawn(), bare = world.spawn();
        world.despawn(invalid); world.insert(bodies[1], Disabled);
        world.update(parent, Transform, tf => { tf.position.x = 123; }); world.ensureTransformsComposed();
        const ids = [bodies[0], bodies[1], invalid, bare], input = core._malloc(ids.length * 4), output = core._malloc(ids.length * ENTITY_POSE_2D_WORDS * 4);
        try {
            core.HEAPU32.set(ids, input >>> 2);
            expect(core.registry_readWorldPoses2D!(world.getCppRegistry()!, input, ids.length, output)).toBe(1);
            expect(core.HEAPU32[output >>> 2]).toBe(bodies[0]);
            expect(core.HEAPF32[(output >>> 2) + 1]).toBeCloseTo(123, 4);
            expect(core.registry_readWorldPoses2D!(world.getCppRegistry()!, input, -1, output)).toBe(0);
            expect(core.registry_readWorldPoses2D!(world.getCppRegistry()!, input, ids.length, core.HEAPU8.byteLength - 4)).toBe(0);
        } finally { core._free(input); core._free(output); }
    });

    it('refreshes the legacy cache if batching becomes unavailable after a parent move', async () => {
        const { app, world, module, parent, bodies, scalar } = await scene(true);
        world.update(parent, Transform, tf => { tf.position.x = 30; }); await app.stepFrames(2, 1 / 60);
        module._physics_setBodyTransforms = undefined;
        world.update(bodies[0], Transform, tf => { tf.position.x = -30; }); await app.stepFrames(2, 1 / 60);
        expect(scalar).toHaveBeenCalledOnce();
        const hit = app.getResource(Physics2D).raycast({ x: -20, y: 0 }, { x: 1, y: 0 }, 40)
            .find(hit => hit.entity === bodies[0]);
        expect(hit?.point.x).toBeCloseTo(-5, 3);
    });

    it('skips unchanged solver poses and frees temporary buffers after a batch failure', async () => {
        const { world, module, bodies } = await scene(true);
        world.update(bodies[0], Transform, tf => { tf.position.x = 10; }); world.ensureTransformsComposed();
        const allocations = vi.spyOn(core, '_malloc'), frees = vi.spyOn(core, '_free');
        const physicsAlloc = vi.spyOn(module, '_malloc'), physicsFree = vi.spyOn(module, '_free');
        expect(batchStaticPoses2D(world, module, bodies, 100, () => true)).toBe(true);
        expect(batchStaticPoses2D(world, module, bodies, 100, () => true)).toBe(true);
        const output = module._malloc(ENTITY_POSE_2D_WORDS * 4);
        try {
            const base = output >>> 2; module.HEAPU32[base] = bodies[0];
            module.HEAPF32[base + 1] = 10; module.HEAPF32[base + 2] = 0; module.HEAPF32[base + 3] = 0;
            expect(module._physics_setBodyTransforms!(output, 1, 100)).toBe(0);
            expect(module._physics_setBodyTransforms!(output, 1, 0)).toBe(0);
            module.HEAPF32[base + 1] = NaN;
            expect(module._physics_setBodyTransforms!(output, 1, 100)).toBe(0);
        } finally { module._free(output); }
        vi.mocked(module._physics_setBodyTransforms!).mockImplementation(() => { throw Error('batch failed'); });
        expect(() => batchStaticPoses2D(world, module, bodies, 100, () => true)).toThrow('batch failed');
        expect(frees.mock.calls.map(([ptr]) => ptr).sort()).toEqual(allocations.mock.results.map(result => result.value).sort());
        expect(physicsFree.mock.calls.map(([ptr]) => ptr).sort()).toEqual(physicsAlloc.mock.results.map(result => result.value).sort());
    });
});
