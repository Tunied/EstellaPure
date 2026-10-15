// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Parent } from '../../ecs/component';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';

type VisibilityWorld = Pick<World, 'valid' | 'has' | 'get'> & Partial<Pick<World, 'resolveGetter'>>;

/** Authored display is current even between layout passes. Memoize shared
 * ancestors only within this read-only query, never across scene mutations. */
export function createLiveVisibilityQuery(world: VisibilityWorld, fallback: (entity: Entity) => boolean) {
    const fastWorld = world as VisibilityWorld & Partial<Pick<World, 'resolveGetter'>>;
    const getter = fastWorld.resolveGetter?.(UINode) as ((entity: Entity) => UINodeData) | null | undefined;
    const readNode = getter ?? ((entity: Entity) => world.get(entity, UINode));
    const parentGetter = fastWorld.resolveGetter?.(Parent) as ((entity: Entity) => { entity: Entity }) | null | undefined;
    const readParent = parentGetter ?? ((entity: Entity) => world.get(entity, Parent));
    const HIDDEN = 1, AUTHORED = 2, PENDING = 4;
    const memo = new Map<Entity, number>();
    const path: Entity[] = [];
    return (entity: Entity): boolean => {
        path.length = 0;
        let current = entity, flags = 0;
        for (;;) {
            const cached = memo.get(current);
            if (cached !== undefined) {
                // Invalid cyclic ancestry cannot receive keyboard input.
                flags = cached === PENDING ? HIDDEN | AUTHORED : cached;
                break;
            }
            if (!world.valid(current)) break;
            memo.set(current, PENDING);
            path.push(current);
            if (!world.has(current, Parent)) break;
            current = readParent(current).entity;
        }
        for (let i = path.length - 1; i >= 0; i--) {
            if (world.has(path[i], UINode)) {
                flags |= AUTHORED;
                if (!(flags & HIDDEN) && readNode(path[i]).display === UIDisplay.None) flags |= HIDDEN;
            }
            memo.set(path[i], flags);
        }
        return flags & AUTHORED ? !!(flags & HIDDEN) : fallback(entity);
    };
}

