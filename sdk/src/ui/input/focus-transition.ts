// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Focusable, type FocusManagerState } from './focusable';
import { isFocusEligible } from './focus-inspection';
import { UIEventType, type UIEventQueue } from '../core/events';

/** One transition path for Tab traversal and compound widgets. Handlers may redirect focus. */
export function moveUIFocus(world: World, events: UIEventQueue, manager: FocusManagerState,
    entity: Entity, visible: boolean): void {
    if (!isFocusEligible(world, entity)) return;
    if (manager.focusedEntity === entity) { manager.focusVisible = visible; return; }
    const previous = manager.blur();
    if (previous !== null && world.valid(previous) && world.has(previous, Focusable)) {
        world.set(previous, Focusable, { ...world.get(previous, Focusable), isFocused: false });
        events.emit(previous, UIEventType.Blur);
    }
    if (manager.focusedEntity !== null || !isFocusEligible(world, entity)) return;
    manager.focus(entity, visible);
    world.set(entity, Focusable, { ...world.get(entity, Focusable), isFocused: true });
    events.emit(entity, UIEventType.Focus);
    if (manager.focusedEntity === entity && !isFocusEligible(world, entity)) {
        manager.blur();
        if (world.valid(entity) && world.has(entity, Focusable)) {
            world.set(entity, Focusable, { ...world.get(entity, Focusable), isFocused: false });
            events.emit(entity, UIEventType.Blur);
        }
    }
}
