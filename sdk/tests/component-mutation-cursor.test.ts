// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { ComponentMutationReader } from '../src/ecs/ComponentMutationReader';
import { createNativeRegistry } from '../src/ecs/bridge/nativeRegistry';

it('acknowledges only sampled writes, including subsequent writes in the same tick', () => {
    const world = new World(), component = defineComponent('CursorWrite', { value: 0 });
    const reader = world.registerMutationCursor(component, 'write');
    const entity = world.spawn(); world.insert(entity, component);
    const through = world.mutationSequence('write');
    expect(world.mutationsForCursor(component, 'write', reader)).toEqual([entity]);
    world.update(entity, component, value => { value.value = 1; });
    world.advanceMutationCursor(component, 'write', reader, through);
    expect(world.mutationsForCursor(component, 'write', reader)).toEqual([entity]);
    world.advanceMutationCursor(component, 'write', reader, world.mutationSequence('write'));
    expect(world.mutationsForCursor(component, 'write', reader)).toEqual([]);
    expect(world.bufferedWriteRows(component)).toBe(0);
    world.disposeMutationCursor(component, 'write', reader);
    expect(world.writeReaderCount(component)).toBe(0);
});

it('retains topology changes for independent readers through remove and reinsert', () => {
    const world = new World(), component = defineComponent('CursorMembership', { value: 0 });
    const fast = world.registerMutationCursor(component, 'topology');
    const slow = world.registerMutationCursor(component, 'topology');
    const entity = world.spawn(); world.insert(entity, component);
    world.advanceMutationCursor(component, 'topology', fast, world.mutationSequence('topology'));
    world.remove(entity, component); world.insert(entity, component, { value: 3 });
    expect(world.mutationsForCursor(component, 'topology', fast)).toEqual([entity, entity]);
    expect(world.mutationsForCursor(component, 'topology', slow)).toEqual([entity, entity, entity]);
    world.disposeMutationCursor(component, 'topology', slow);
    expect(world.mutationsForCursor(component, 'topology', fast)).toEqual([entity, entity]);
    world.disposeMutationCursor(component, 'topology', fast);
    expect(world.topologyReaderCount(component)).toBe(0);
});

it('lets tick samplers and cursor readers retain different windows', () => {
    const world = new World(), component = defineComponent('CursorMixed', { value: 0 });
    const cursor = world.registerMutationCursor(component, 'write');
    const ticks = world.registerWriteReaderFrom(component, 0);
    const entity = world.spawn(); world.insert(entity, component);
    world.advanceTick(); world.update(entity, component, value => { value.value++; });
    world.advanceMutationCursor(component, 'write', cursor, world.mutationSequence('write'));
    expect(world.mutationsForCursor(component, 'write', cursor)).toEqual([]);
    expect(world.getWrittenEntitiesSince(component, -1)).toEqual([entity, entity]);
    world.disposeWriteReader(component, ticks);
    expect(world.bufferedWriteRows(component)).toBe(0);
    world.disposeMutationCursor(component, 'write', cursor);
});

it('keeps older or logic-only hosts on the existing reconciliation path', () => {
    const world = new World(), component = defineComponent('CursorLegacy', { value: 0 });
    const reader = new ComponentMutationReader(world, [component], [], []);
    expect(reader.read()).toBeNull();
    expect(world.writeReaderCount(component)).toBe(0);
    expect(world.topologyReaderCount(component)).toBe(0);
    reader.dispose(); world.disconnectCpp();
});

it('resolves component IDs through the native host without treating names as entities', () => {
    const registry = createNativeRegistry({ es_componentTypeId: (name: string) => name === 'RigidBody2D' ? 17 : -1 });
    expect(registry.componentTypeId?.('RigidBody2D')).toBe(17);
    expect(registry.componentTypeId?.('unknown')).toBe(-1);
});

it('continues disconnect cleanup when another native observer fails', () => {
    const world = new World(); let cleaned = false;
    const first = world.onCoreDisconnect(() => { throw new Error('native core is unavailable'); });
    const second = world.onCoreDisconnect(() => { cleaned = true; });
    expect(() => world.disconnectCpp()).not.toThrow();
    expect(cleaned).toBe(true);
    first(); second();
    expect(world.getStorageSizes().coreDisconnectCallbacks).toBe(0);
});
