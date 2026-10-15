// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { Focusable } from './focusable';
import { Interactable } from './interactable';
import { UIDialog, isDialogOpen } from '../behavior/dialog';
import { walkParentChain } from '../util/helpers';
import { Parent } from '../../ecs/component';
import { UINode, UIDisplay, type UINodeData } from '../core/ui-node';

/** Read-only scene queries needed to inspect focus. @experimental */
export type FocusInspectionWorld = Pick<World, 'getWasmModule' | 'getCppRegistry' | 'getEntitiesWithComponents' | 'valid' | 'has' | 'get'>;

/** Why a focusable is absent from the current Tab ring. @experimental */
export type FocusSkipReason = 'disabled' | 'hidden' | 'outside-dialog';
/** A read-only focus traversal entry. Equal indices keep ECS query order. @experimental */
export interface FocusTraversalEntry {
    entity: Entity;
    tabIndex: number;
    skipped: FocusSkipReason | null;
}
/** The same snapshot used by keyboard traversal. @experimental */
export interface FocusTraversalInspection {
    entries: FocusTraversalEntry[];
    /** False when the host cannot report resolved hierarchical visibility. */
    visibilityResolved: boolean;
}

function focusContext(world: FocusInspectionWorld) {
    const engine = worldEngineApi(world);
    const registry = world.getCppRegistry();
    const visibilityResolved = !!(registry && engine?.getUINodeHiddenInTree);
    const hiddenInTree = liveVisibility(world, entity =>
        visibilityResolved && engine!.getUINodeHiddenInTree!(registry!, entity));
    const roots = new Set(world.getEntitiesWithComponents([UIDialog])
        .filter(entity => isDialogOpen(world, entity)
            && !hiddenInTree(entity)));
    // A nested modal excludes its parent dialog's other controls. Independent
    // dialog branches retain the existing union policy; no stacking order is inferred.
    for (const root of [...roots]) {
        walkParentChain(world, root, ancestor => {
            roots.delete(ancestor);
            return false;
        });
    }
    return { visibilityResolved, roots, hiddenInTree };
}

/** Authored display is current even between layout passes. Memoize shared
 * ancestors only within this read-only query, never across scene mutations. */
function liveVisibility(world: FocusInspectionWorld, fallback: (entity: Entity) => boolean) {
    const getter = (world as FocusInspectionWorld & Partial<Pick<World, 'resolveGetter'>>)
        .resolveGetter?.(UINode) as ((entity: Entity) => UINodeData) | null | undefined;
    const readNode = getter ?? ((entity: Entity) => world.get(entity, UINode));
    const memo = new Map<Entity, { hidden: boolean; authored: boolean; pending: boolean }>();
    const path: Entity[] = [];
    return (entity: Entity): boolean => {
        path.length = 0;
        let current = entity, hidden = false, authored = false;
        while (world.valid(current)) {
            const cached = memo.get(current);
            if (cached) {
                // Invalid cyclic ancestry cannot receive keyboard input.
                hidden = cached.pending || cached.hidden;
                authored = cached.pending || cached.authored;
                break;
            }
            memo.set(current, { hidden: false, authored: false, pending: true });
            path.push(current);
            if (!world.has(current, Parent)) break;
            current = world.get(current, Parent).entity;
        }
        for (let i = path.length - 1; i >= 0; i--) {
            const entry = memo.get(path[i])!;
            if (world.has(path[i], UINode)) {
                authored = true;
                hidden = hidden || readNode(path[i]).display === UIDisplay.None;
            }
            entry.hidden = hidden;
            entry.authored = authored;
            entry.pending = false;
        }
        return authored ? hidden : fallback(entity);
    };
}

function skipReason(world: FocusInspectionWorld, entity: Entity,
    { hiddenInTree, roots }: ReturnType<typeof focusContext>): FocusSkipReason | null {
    let skipped: FocusSkipReason | null = null;
    if (world.has(entity, Interactable) && !world.get(entity, Interactable).enabled) {
        skipped = 'disabled';
    } else if (hiddenInTree(entity)) {
        skipped = 'hidden';
    } else if (roots.size > 0 && !roots.has(entity)) {
        let inside = false;
        walkParentChain(world, entity, ancestor => {
            inside = roots.has(ancestor);
            return inside;
        });
        if (!inside) skipped = 'outside-dialog';
    }
    return skipped;
}

/** Check a single target without sorting the entire Tab ring. */
export function isFocusEligible(world: FocusInspectionWorld & Partial<Pick<World, 'isEntityActive'>>, entity: Entity): boolean {
    if (!world.valid(entity) || !world.has(entity, Focusable)) return false;
    const active = world.isEntityActive
        ? world.isEntityActive(entity)
        : world.getEntitiesWithComponents([Focusable]).includes(entity);
    return active && skipReason(world, entity, focusContext(world)) === null;
}

/** Inspect Tab order without moving focus or emitting events. @experimental */
export function inspectFocusTraversal(world: FocusInspectionWorld): FocusTraversalInspection {
    const context = focusContext(world);
    const entries: FocusTraversalEntry[] = [];
    for (const entity of world.getEntitiesWithComponents([Focusable])) {
        if (!world.valid(entity)) continue;
        entries.push({ entity, tabIndex: world.get(entity, Focusable).tabIndex,
            skipped: skipReason(world, entity, context) });
    }
    entries.sort((a, b) => a.tabIndex - b.tabIndex);
    return { entries, visibilityResolved: context.visibilityResolved };
}
