// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { TouchPoint } from './input';

// A host can reuse an id before sampling. Keep the old gesture's press edge
// on its point rather than looking it up under the replacement gesture's id.
const endedPresses = new WeakMap<TouchPoint, boolean>();
export function recordTouchEnd(point: TouchPoint, pressed: boolean): void {
    endedPresses.set(point, pressed);
}
export function touchEndPressed(point: TouchPoint, fallback: boolean): boolean {
    return endedPresses.get(point) ?? fallback;
}
