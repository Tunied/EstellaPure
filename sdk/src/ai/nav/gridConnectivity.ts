// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { NavGrid, Cell } from './NavGrid';

interface Components { labels: Int32Array; cells: number[][] }
interface Cache { revision: number; radii: Map<number, Components> }
const caches = new WeakMap<NavGrid, Cache>();
const fits = (grid: NavGrid, x: number, y: number, radius: number) =>
    grid.isWalkable(x, y) && (radius <= 0 || grid.clearanceAt(x, y) >= radius);

/** A failed search establishes connectivity once for subsequent requests on this map. */
export function rememberGridComponents(grid: NavGrid, radius: number): void {
    let cache = caches.get(grid);
    if (!cache || cache.revision !== grid.topologyRevision) {
        cache = { revision: grid.topologyRevision, radii: new Map() };
        caches.set(grid, cache);
    }
    if (cache.radii.has(radius)) return;
    // Bound storage when a game asks for many different body sizes.
    if (cache.radii.size >= 4) cache.radii.delete(cache.radii.keys().next().value!);
    const { width, height } = grid;
    const labels = new Int32Array(width * height), cells: number[][] = [];
    for (let i = 0; i < labels.length; i++) {
        if (labels[i] || !fits(grid, i % width, Math.floor(i / width), radius)) continue;
        const group = [i], label = cells.length + 1;
        cells.push(group); labels[i] = label;
        for (let head = 0; head < group.length; head++) {
            const at = group[head]!, x = at % width, y = Math.floor(at / width);
            for (const next of [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1,
                y > 0 ? at - width : -1, y + 1 < height ? at + width : -1]) {
                if (next < 0 || labels[next] || !fits(grid, next % width, Math.floor(next / width), radius)) continue;
                labels[next] = label; group.push(next);
            }
        }
    }
    cache.radii.set(radius, { labels, cells });
}

/** Retarget a disconnected query to its nearest reachable cell; preserve partial routes. */
export function cachedGridGoal(
    grid: NavGrid, start: Cell, goal: Cell, radius: number,
    distance: (x: number, y: number) => number,
): Cell | null {
    const cache = caches.get(grid);
    if (!cache || cache.revision !== grid.topologyRevision) return null;
    const components = cache.radii.get(radius);
    if (!components) return null;
    const label = components.labels[grid.index(start.x, start.y)]!;
    // A cramped starting cell may escape into an adjacent component; use the search.
    if (!label || !components.labels[grid.index(goal.x, goal.y)]
        || label === components.labels[grid.index(goal.x, goal.y)]) return null;
    let best = grid.index(start.x, start.y), nearest = distance(start.x, start.y);
    for (const cell of components.cells[label - 1]!) {
        const score = distance(cell % grid.width, Math.floor(cell / grid.width));
        if (score < nearest) { nearest = score; best = cell; }
    }
    return { x: best % grid.width, y: Math.floor(best / grid.width) };
}
