// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { onGestureClick, fireGestureClick, takeGestureFired } from '../src/ui/input/gestureClick';

it('despawning a gesture target removes its callback and pending frame marker', () => {
    const world = new World(), entity = world.spawn(), clicked = vi.fn();
    onGestureClick(world, entity, clicked);
    expect(fireGestureClick(world, entity)).toBe(true);
    world.despawn(entity);
    expect(takeGestureFired(world, entity)).toBe(false);
    expect(fireGestureClick(world, entity)).toBe(false);
    expect(clicked).toHaveBeenCalledOnce();
});
it('does not retain a registration made for an already destroyed target', () => {
    const world = new World(), entity = world.spawn(), clicked = vi.fn();
    world.despawn(entity); onGestureClick(world, entity, clicked);
    expect(fireGestureClick(world, entity)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
});
it('does not install a gesture during the target destruction notification', () => {
    const world = new World(), entity = world.spawn(), clicked = vi.fn();
    world.onDespawn(target => onGestureClick(world, target, clicked));
    world.despawn(entity);
    expect(world.getStorageSizes().despawnCallbacks).toBe(1);
    expect(fireGestureClick(world, entity)).toBe(false);
});
it('target destruction inside its gesture clears the pending frame marker immediately', () => {
    const world = new World(), entity = world.spawn();
    onGestureClick(world, entity, () => world.despawn(entity));
    expect(fireGestureClick(world, entity)).toBe(true);
    expect(takeGestureFired(world, entity)).toBe(false);
});
it('shares one despawn observer across repeated gesture target lifetimes', () => {
    const world = new World(), before = world.getStorageSizes().despawnCallbacks;
    for (let i = 0; i < 1000; i++) {
        const entity = world.spawn(); onGestureClick(world, entity, () => {});
        fireGestureClick(world, entity); world.despawn(entity);
        expect(takeGestureFired(world, entity)).toBe(false);
    }
    expect(world.getStorageSizes().despawnCallbacks).toBe(before + 1);
});
