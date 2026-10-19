// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../../ecs/resource';
import type { Entity } from '../../types';
export interface ControlPointer {
    id: number;
    down: boolean;
    pressed: boolean;
    /** Captured control while held; null on a released/hover-only pointer. */
    entity: Entity | null;
    /** Press edge target, only populated in the frame the capture starts. */
    pressedEntity: Entity | null;
    layoutX: number;
    layoutY: number;
    worldX: number;
    worldY: number;
}
/** Per-app projection of the UI hit tester's captures; never a second raycast. */
export const UIControlPointers = defineResource<{ pointers: Map<number, ControlPointer> }>({ pointers: new Map() }, 'UIControlPointers');
