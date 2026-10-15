// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { defineComponent } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { ResourceStorage } from '../src/ecs/resource';
import { Added, Changed, Mut, Query, QueryInstance } from '../src/ecs/query';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import type { Entity } from '../src/types';

const Marker = defineComponent('BoundaryMarker', { value: 0 });
describe('system change query boundaries', () => {
    let world: World;
    let runner: SystemRunner;
    beforeEach(() => {
        setDefaultContext(new AppContext());
        world = new World();
        runner = new SystemRunner(world, new ResourceStorage());
    });
    it.each([Added, Changed])('delivers %s between runs in one world tick once', filter => {
        const batches: Entity[][] = [];
        const reader = defineSystem([Query(filter(Marker))], query => {
            const batch: Entity[] = [];
            query.forEach(entity => batch.push(entity));
            batches.push(batch);
        });
        runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(reader);
        runner.run(reader);
        expect(batches).toEqual([[], [entity], []]);
        expect(world.getWorldTick()).toBe(0);
    });
    it('delivers a later systems write on the next run in the same tick', () => {
        const batches: Entity[][] = [];
        const reader = defineSystem([Query(Changed(Marker))], query => {
            const batch: Entity[] = [];
            query.forEach(entity => batch.push(entity));
            batches.push(batch);
        });
        runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(reader);
        const writer = defineSystem([], () => { world.update(entity, Marker, marker => { marker.value++; }); });
        runner.run(writer);
        runner.run(reader);
        runner.run(reader);
        expect(batches).toEqual([[], [entity], [entity], []]);
    });
    it('does not retrigger from the readers own Mut writeback', () => {
        const counts: number[] = [];
        const reader = defineSystem([Query(Mut(Marker), Changed(Marker))], query => {
            let count = 0;
            query.forEach((_entity, marker) => { marker.value++; count++; });
            counts.push(count);
        });
        runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(reader);
        runner.run(reader);
        expect(counts).toEqual([0, 1, 0]);
        expect(world.get(entity, Marker).value).toBe(1);
    });
    it('keeps the previous completed boundary while an async system is suspended', async () => {
        const batches: Entity[][] = [];
        let write: (() => void) | undefined;
        const reader = defineSystem([Query(Changed(Marker))], async query => {
            if (write) await Promise.resolve().then(write);
            const batch: Entity[] = [];
            query.forEach(entity => batch.push(entity));
            batches.push(batch);
        });
        await runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        await runner.run(reader);
        write = () => { world.update(entity, Marker, marker => { marker.value++; }); };
        await runner.run(reader);
        write = undefined;
        await runner.run(reader);
        world.update(entity, Marker, marker => { marker.value++; });
        await runner.run(reader);
        expect(batches).toEqual([[], [entity], [entity], [], [entity]]);
    });
    it('keeps a paused reader independent of a fast readers completed boundary', () => {
        const fast: number[] = [], slow: number[] = [];
        const reader = (counts: number[]) => defineSystem([Query(Changed(Marker))], query => {
            let count = 0;
            query.forEach(() => { count++; });
            counts.push(count);
        });
        const fastReader = reader(fast), slowReader = reader(slow);
        runner.run(fastReader);
        runner.run(slowReader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(fastReader);
        runner.run(fastReader);
        world.update(entity, Marker, marker => { marker.value++; });
        runner.run(fastReader);
        runner.run(slowReader);
        runner.run(slowReader);
        expect(fast).toEqual([0, 1, 0, 1]);
        expect(slow).toEqual([0, 1, 0]);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('preserves explicit tick-based query instances without opting into sequence storage', () => {
        world.enableChangeTracking(Marker);
        const entity = world.spawn();
        world.insert(entity, Marker);
        const query = new QueryInstance(world, Query(Changed(Marker)), 0);
        let count = 0;
        query.forEach(() => { count++; });
        expect(count).toBe(0);
        world.advanceTick();
        world.update(entity, Marker, marker => { marker.value++; });
        query.forEach(() => { count++; });
        expect(count).toBe(1);
        expect(world.getStorageSizes().changes.sequenceRows).toBe(0);
        expect(world.getChangeSequence()).toBe(0);
    });
    it.each([Added, Changed])('does not enumerate stable %s queries for any read form', filter => {
        let armed = false;
        const reader = defineSystem([Query(filter(Marker))], query => {
            if (!armed) { query.forEach(() => {}); return; }
            expect(query.isEmpty()).toBe(true);
            expect(query.count()).toBe(0);
            expect(query.single()).toBeNull();
            expect(query.toArray()).toEqual([]);
            query.forEach(() => { throw new Error('stable query yielded a row'); });
        });
        runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(reader);
        const candidates = vi.spyOn(world, 'queryEntities');
        armed = true;
        runner.run(reader);
        expect(candidates).not.toHaveBeenCalled();
        candidates.mockRestore();
    });
    it.each([Added, Changed])('preserves tick sampling after existing %s records gain sequences', filter => {
        world.enableChangeTracking(Marker);
        const first = world.spawn();
        world.insert(first, Marker);
        const counts: number[] = [];
        const reader = defineSystem([Query(filter(Marker))], query => { counts.push(query.count()); });
        runner.run(reader);
        expect(counts).toEqual([1]);
        const manual = new QueryInstance(world, Query(filter(Marker)), 0);
        expect(manual.count()).toBe(0);
        world.advanceTick();
        if (filter === Added) {
            const next = world.spawn();
            world.insert(next, Marker);
        } else world.update(first, Marker, marker => { marker.value++; });
        expect(manual.count()).toBe(1);
        runner.run(reader);
        expect(counts).toEqual([1, 1]);
    });
    it.each([Added, Changed])('keeps %s sequence storage proportional to live components', filter => {
        const reader = defineSystem([Query(filter(Marker))], query => { query.forEach(() => {}); });
        runner.run(reader);
        const nodes = Array.from({ length: 128 }, () => {
            const entity = world.spawn();
            world.insert(entity, Marker);
            return entity;
        });
        for (let i = 0; i < 100; i++) {
            world.update(nodes[0], Marker, marker => { marker.value++; });
            runner.run(reader);
        }
        expect(world.getStorageSizes().changes.sequenceRows).toBe(nodes.length);
        for (const [i, entity] of nodes.entries()) {
            if (i % 2) world.despawn(entity);
            else world.remove(entity, Marker);
        }
        expect(world.getStorageSizes().changes.sequenceRows).toBe(0);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it.each(['evict', 'reset'] as const)('starts a fresh query window after %s', operation => {
        const counts: number[] = [];
        const reader = defineSystem([Query(Changed(Marker))], query => { counts.push(query.count()); });
        runner.run(reader);
        const entity = world.spawn();
        world.insert(entity, Marker);
        runner.run(reader);
        runner.run(reader);
        if (operation === 'evict') runner.evict(reader._id);
        else runner.reset();
        runner.run(reader);
        expect(counts).toEqual([0, 1, 0, 1]);
    });
});
