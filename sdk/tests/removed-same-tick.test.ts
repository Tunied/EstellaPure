// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it } from 'vitest';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { defineComponent } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { ResourceStorage } from '../src/ecs/resource';
import { Removed } from '../src/ecs/query';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import type { Entity } from '../src/types';

const Marker = defineComponent('SameTickMarker', { value: 0 });
describe('removal delivery within a world tick', () => {
    let world: World;
    let runner: SystemRunner;
    beforeEach(() => {
        setDefaultContext(new AppContext());
        world = new World();
        runner = new SystemRunner(world, new ResourceStorage());
    });
    const removeOne = () => {
        const entity = world.spawn();
        world.insert(entity, Marker);
        world.remove(entity, Marker);
        return entity;
    };
    it('delivers a removal after the previous run exactly once without advancing the tick', () => {
        const batches: Entity[][] = [];
        const reader = defineSystem([Removed(Marker)], rows => { batches.push(rows.toArray()); });
        runner.run(reader);
        const entity = removeOne();
        runner.run(reader);
        runner.run(reader);
        expect(batches).toEqual([[], [entity], []]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('preserves separate removals of a recreated component within one tick', () => {
        const batches: Entity[][] = [];
        const reader = defineSystem([Removed(Marker)], rows => { batches.push([...rows]); });
        runner.run(reader);
        const entity = removeOne();
        world.insert(entity, Marker);
        world.remove(entity, Marker);
        runner.run(reader);
        expect(batches).toEqual([[], [entity, entity]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('keeps removals made after the body last read for the following run', () => {
        const batches: Entity[][] = [];
        let victim: Entity | undefined;
        const reader = defineSystem([Removed(Marker)], rows => {
            batches.push(rows.toArray());
            if (victim !== undefined) {
                world.remove(victim, Marker);
                victim = undefined;
            }
        });
        const entity = world.spawn();
        world.insert(entity, Marker);
        victim = entity;
        runner.run(reader);
        runner.run(reader);
        expect(batches).toEqual([[], [entity]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('does not inherit older rows retained by a parked reader', () => {
        const oldBatches: Entity[][] = [], newBatches: Entity[][] = [];
        const parked = defineSystem([Removed(Marker)], rows => { oldBatches.push(rows.toArray()); });
        runner.run(parked);
        const old = removeOne();
        const fresh = defineSystem([Removed(Marker)], rows => { newBatches.push(rows.toArray()); });
        runner.run(fresh);
        const next = removeOne();
        runner.run(fresh);
        runner.run(parked);
        expect(newBatches).toEqual([[], [next]]);
        expect(oldBatches).toEqual([[], [old, next]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('keeps a removal produced after the last read when the body throws', () => {
        const batches: Entity[][] = [];
        let fail = true;
        let victim: Entity | undefined;
        const reader = defineSystem([Removed(Marker)], rows => {
            batches.push(rows.toArray());
            if (fail) {
                victim = removeOne();
                fail = false;
                throw new Error('body failed after removing');
            }
        });
        expect(() => runner.run(reader)).toThrow('body failed after removing');
        runner.run(reader);
        expect(batches).toEqual([[], [victim]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('does not let a tick-based sampler prune a cursor reader before it reads', () => {
        const batches: Entity[][] = [];
        const reader = defineSystem([Removed(Marker)], rows => { batches.push(rows.toArray()); });
        runner.run(reader);
        const sampler = world.registerRemovedReaderFrom(Marker, 0);
        const entity = removeOne();
        world.advanceRemovedReader(Marker, sampler, world.getWorldTick());
        expect(world.getStorageSizes().changes.removedRows).toBe(1);
        runner.run(reader);
        expect(batches).toEqual([[], [entity]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
        world.disposeRemovedReader(Marker, sampler);
    });
    it('releases the initial window even when the body does not enumerate it', () => {
        const reader = defineSystem([Removed(Marker)], () => {});
        runner.run(reader);
        removeOne();
        expect(world.getStorageSizes().changes.removedRows).toBe(1);
        runner.run(reader);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('leaves a tick samplers overlapping window intact after cursor acknowledgement', () => {
        const sampler = world.registerRemovedReaderFrom(Marker, 0);
        const reader = defineSystem([Removed(Marker)], rows => { rows.toArray(); });
        runner.run(reader);
        const entity = removeOne();
        runner.run(reader);
        expect(world.getRemovedEntitiesSince(Marker, -1)).toEqual([entity]);
        world.advanceRemovedReader(Marker, sampler, 0);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
        world.disposeRemovedReader(Marker, sampler);
    });
    it('preserves a paused reader while a fast one catches up repeatedly', () => {
        const fastBatches: Entity[][] = [], slowBatches: Entity[][] = [];
        const fast = defineSystem([Removed(Marker)], rows => { fastBatches.push(rows.toArray()); });
        const slow = defineSystem([Removed(Marker)], rows => { slowBatches.push(rows.toArray()); });
        runner.run(fast);
        runner.run(slow);
        const victims = Array.from({ length: 4096 }, removeOne);
        runner.run(fast);
        for (let i = 0; i < 50; i++) runner.run(fast);
        expect(fastBatches[1]).toEqual(victims);
        expect(fastBatches.slice(2).every(batch => batch.length === 0)).toBe(true);
        expect(world.getStorageSizes().changes.removedRows).toBe(victims.length);
        runner.run(slow);
        expect(slowBatches).toEqual([[], victims]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
        runner.reset();
        expect(world.removedReaderCount(Marker)).toBe(0);
    });
    it('can read rows produced during an await without releasing another readers claim', async () => {
        const batches: Entity[][] = [];
        let armed = false;
        let victim: Entity | undefined;
        const reader = defineSystem([Removed(Marker)], async rows => {
            if (armed) await Promise.resolve().then(() => { victim = removeOne(); });
            batches.push(rows.toArray());
        });
        await runner.run(reader);
        armed = true;
        await runner.run(reader);
        expect(batches).toEqual([[], [victim]]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
});
