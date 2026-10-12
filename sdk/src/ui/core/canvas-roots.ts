// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Top-level canvases in input order; parentOf returns null for absent or invalid parents. @experimental */
export function canvasRootEntities<T>(entities: readonly T[], parentOf: (entity: T) => T | null): T[] {
    if (entities.length <= 1) return [...entities];
    const ancestry = new Map<T, number>(entities.map(entity => [entity, 3]));
    const roots: T[] = [];
    const trail: T[] = [];
    for (const entity of entities) {
        trail.length = 0;
        let ancestor = parentOf(entity);
        let nested = false;
        while (ancestor !== null) {
            const state = ancestry.get(ancestor);
            if (state !== undefined) { nested = state === 3; break; }
            ancestry.set(ancestor, 1);
            trail.push(ancestor);
            ancestor = parentOf(ancestor);
        }
        for (const visited of trail) ancestry.set(visited, nested ? 3 : 2);
        if (!nested) roots.push(entity);
    }
    return roots;
}
