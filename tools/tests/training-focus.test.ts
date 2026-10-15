// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { World } from '../../sdk/src/ecs/world';
import { Focusable, FocusManagerState } from '../../sdk/src/ui/input/focusable';
import { UIEventQueue } from '../../sdk/src/ui/core/events';
vi.mock('esengine', async () => ({
    Focusable: (await import('../../sdk/src/ui/input/focusable')).Focusable,
    UIEventType: (await import('../../sdk/src/ui/core/events')).UIEventType,
}));
import { releaseTrainingFocus } from '../../examples/mobile-controls/src/trainingFocus';

function fixture() {
    const world = new World(), entity = world.spawn(), events = new UIEventQueue(), focus = new FocusManagerState();
    world.insert(entity, Focusable, { isFocused: true }); focus.focus(entity, true);
    return { world, entity, events, focus };
}
it('releases the menu focus and its component flag before notifying blur', () => {
    const { world, entity, events, focus } = fixture();
    const samples: unknown[] = [];
    events.on(entity, 'blur', () => samples.push([focus.focusedEntity, world.get(entity, Focusable).isFocused]));
    releaseTrainingFocus(world, events, focus);
    expect(samples).toEqual([[null, false]]); expect(focus.focusVisible).toBe(false);
});
it('does not repeat blur for an already released focus', () => {
    const { world, events, focus } = fixture();
    releaseTrainingFocus(world, events, focus); events.drain();
    releaseTrainingFocus(world, events, focus); expect(events.drain()).toEqual([]);
});
it('drops a destroyed focus target without reading its components', () => {
    const { world, entity, events, focus } = fixture(); world.despawn(entity);
    releaseTrainingFocus(world, events, focus); expect(focus.focusedEntity).toBeNull(); expect(events.drain()).toEqual([]);
});
it('preserves focus explicitly acquired by a blur handler', () => {
    const { world, entity, events, focus } = fixture(), next = world.spawn(); world.insert(next, Focusable);
    events.on(entity, 'blur', () => focus.focus(next, true));
    releaseTrainingFocus(world, events, focus); expect(focus.focusedEntity).toBe(next);
});
