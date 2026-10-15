// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Focusable, UIEventType, type FocusManagerState, type UIEventQueue, type World } from 'esengine';

/** Returning to gameplay gives Space back to the game instead of the last menu button. */
export function releaseTrainingFocus(world: World, events: UIEventQueue, focus: FocusManagerState): void {
    const previous = focus.blur();
    if (previous === null || !world.valid(previous) || !world.has(previous, Focusable)) return;
    world.update(previous, Focusable, data => { data.isFocused = false; });
    events.emit(previous, UIEventType.Blur);
}
