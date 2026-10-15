// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';

const Panel = defineComponent('LifetimePanel', { value: 0 });

describe('opted-in component identities', () => {
    it('distinguishes same-tick replacements while ordinary writes keep identity', () => {
        const world = new World();
        world.enableIncarnationTracking(Panel);
        const entity = world.spawn();
        world.insert(entity, Panel);
        const first = world.getComponentIncarnation(entity, Panel);
        expect(first).toBeGreaterThan(0);
        world.insert(entity, Panel, { value: 2 });
        world.update(entity, Panel, panel => { panel.value = 3; });
        expect(world.getComponentIncarnation(entity, Panel)).toBe(first);
        world.remove(entity, Panel);
        expect(world.getComponentIncarnation(entity, Panel)).toBe(0);
        world.insert(entity, Panel);
        expect(world.getComponentIncarnation(entity, Panel)).toBeGreaterThan(first);
        expect(world.getWorldTick()).toBe(0);
        world.despawn(entity);
        expect(world.getComponentIncarnation(entity, Panel)).toBe(0);
        expect(world.getStorageSizes().changes.tracked).toBe(0);
        expect(world.getStorageSizes().changes.removedRows).toBe(0);
    });
    it('supports tracking after insertion and does not reset a live identity on repeat enrollment', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Panel);
        world.enableIncarnationTracking(Panel);
        expect(world.getComponentIncarnation(entity, Panel)).toBe(0);
        world.remove(entity, Panel);
        world.insert(entity, Panel);
        const next = world.getComponentIncarnation(entity, Panel);
        expect(next).toBeGreaterThan(0);
        world.enableIncarnationTracking(Panel);
        expect(world.getComponentIncarnation(entity, Panel)).toBe(next);
    });
    it('does not store identities for components that never opted in', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Panel);
        expect(world.getComponentIncarnation(entity, Panel)).toBe(0);
    });
});
