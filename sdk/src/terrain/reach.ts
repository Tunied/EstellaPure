// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    reach.ts
 * @brief   Whether one place on the ground can be walked to from another, and by what way: a search over the ground itself, held to
 *          how steep a walker can climb.
 *
 * @details The ground is read where it is asked, a cell of `step` at a time, so it works on ground without end and on ground a modifier
 *          has just changed, with nothing baked first. A step between two cells is taken when the ground between them is no steeper
 *          than `maxSlope` (sampled along it, so a ridge narrower than a cell is not stepped over) and the caller does not refuse the
 *          place (deep water, a zone kept clear). The way found is pulled straight wherever a straight walk holds, so it reads as a
 *          route, not a staircase of cells. The search is bounded (`maxCells`), and says when it ran out rather than claiming no way.
 */
import { MinHeap } from '../ai/nav/minHeap';

/** What a walker can cross. @experimental */
export interface ReachOptions {
    /** The side of a cell of the search, in world units. Smaller finds narrower passes and costs more. Default 4. */
    step?: number;
    /** The steepest ground a walker climbs, in degrees from flat. Default 35. */
    maxSlope?: number;
    /** A place the walker may not stand, besides ground too steep: water deeper than it wades, a zone kept clear. */
    blocked?: (x: number, z: number) => boolean;
    /** How many cells the search may open before it gives up (and says so). Default 200 000. */
    maxCells?: number;
    /** How far past the box round both ends the search may wander, as a share of the distance between them. Default 1. */
    detour?: number;
}

/** The way from one place to another, or why there is none. @experimental */
export interface ReachResult {
    /**
     * `reached`: a way was found. `unreachable`: every way out of the start within the search's bounds was walked, and none came to
     * the end. `exhausted`: the search ran out of cells before it knew. `noGround`: one end stands where no ground is known, too steep
     * or refused.
     */
    state: 'reached' | 'unreachable' | 'exhausted' | 'noGround';
    /** The way, from the start to the end (or to the nearest place reached, when it was not), on the ground. */
    path: { x: number; y: number; z: number }[];
    /** How long the way is, along the ground. */
    length: number;
    /** How many cells were opened. */
    cells: number;
}

/** The ground a search reads. */
export interface ReachGround {
    heightAt(x: number, z: number): number | null;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Searches the ground for a way from (fromX, fromZ) to (toX, toZ) that a walker held to `maxSlope` can take.
 * @experimental
 */
export function findGroundPath(ground: ReachGround, fromX: number, fromZ: number, toX: number, toZ: number, options: ReachOptions = {}): ReachResult {
    const step = Math.max(options.step ?? 4, 1e-3);
    const grade = Math.tan(Math.min(Math.max(options.maxSlope ?? 35, 0), 89.9) * Math.PI / 180);
    const blocked = options.blocked;
    const maxCells = Math.max(1, options.maxCells ?? 200_000);
    const detour = Math.max(options.detour ?? 1, 0);

    const standable = (x: number, z: number): number | null => {
        const h = ground.heightAt(x, z);
        return h === null || (blocked && blocked(x, z)) ? null : h;
    };
    // Every step is checked a few times along its run, so ground that rises and falls inside one cell is not stepped over.
    const samples = 3;
    const walkable = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number): boolean => {
        const run = Math.hypot(bx - ax, bz - az) / samples;
        let prev = ah;
        for (let i = 1; i <= samples; i++) {
            const t = i / samples;
            const h = i === samples ? bh : standable(ax + (bx - ax) * t, az + (bz - az) * t);
            if (h === null || Math.abs(h - prev) > grade * run + 1e-6) return false;
            prev = h;
        }
        return true;
    };

    const fromH = standable(fromX, fromZ), toH = standable(toX, toZ);
    if (fromH === null || toH === null) return { state: 'noGround', path: [], length: 0, cells: 0 };

    // The cells are a lattice anchored at the start; the end is joined from the cell nearest it.
    const span = Math.hypot(toX - fromX, toZ - fromZ);
    const margin = span * detour + step * 4;
    const minI = Math.floor((Math.min(fromX, toX) - margin - fromX) / step), maxI = Math.ceil((Math.max(fromX, toX) + margin - fromX) / step);
    const minJ = Math.floor((Math.min(fromZ, toZ) - margin - fromZ) / step), maxJ = Math.ceil((Math.max(fromZ, toZ) + margin - fromZ) / step);
    const cols = maxI - minI + 1;
    const keyOf = (i: number, j: number): number => (j - minJ) * cols + (i - minI);
    const xOf = (i: number): number => fromX + i * step;
    const zOf = (j: number): number => fromZ + j * step;
    const endI = Math.round((toX - fromX) / step), endJ = Math.round((toZ - fromZ) / step);

    const g = new Map<number, number>();
    const height = new Map<number, number>();
    const parent = new Map<number, number>();
    const closed = new Set<number>();
    const open = new MinHeap(1024);
    const startKey = keyOf(0, 0);
    g.set(startKey, 0); height.set(startKey, fromH); open.push(startKey, span);
    let best = startKey, bestLeft = span, found = -1, cells = 0, exhausted = false;

    while (open.size > 0) {
        const key = open.pop();
        if (closed.has(key)) continue;
        closed.add(key);
        if (++cells > maxCells) { exhausted = true; break; }
        const i = (key % cols) + minI, j = Math.floor(key / cols) + minJ;
        const x = xOf(i), z = zOf(j), h = height.get(key)!;
        const left = Math.hypot(toX - x, toZ - z);
        if (left < bestLeft) { bestLeft = left; best = key; }
        // Near the end the last step is to the end itself, so the way ends where it was asked to, not at a lattice point.
        if (Math.abs(i - endI) <= 1 && Math.abs(j - endJ) <= 1 && walkable(x, z, h, toX, toZ, toH)) { found = key; break; }
        for (const [di, dj] of NEIGHBOURS) {
            const ni = i + di, nj = j + dj;
            if (ni < minI || ni > maxI || nj < minJ || nj > maxJ) continue;
            const nk = keyOf(ni, nj);
            if (closed.has(nk)) continue;
            const nx = xOf(ni), nz = zOf(nj);
            let nh = height.get(nk);
            if (nh === undefined) {
                const read = standable(nx, nz);
                if (read === null) { closed.add(nk); continue; }
                nh = read; height.set(nk, nh);
            }
            if (!walkable(x, z, h, nx, nz, nh)) continue;
            const cost = g.get(key)! + Math.hypot(nx - x, nz - z, nh - h);
            if (cost >= (g.get(nk) ?? Infinity)) continue;
            g.set(nk, cost); parent.set(nk, key);
            open.push(nk, cost + Math.hypot(toX - nx, toZ - nz));
        }
    }

    const tail = found >= 0 ? found : best;
    const cellsOf: number[] = [];
    for (let k: number | undefined = tail; k !== undefined; k = parent.get(k)) cellsOf.push(k);
    cellsOf.reverse();
    const points = cellsOf.map((k) => ({ x: xOf((k % cols) + minI), y: height.get(k)!, z: zOf(Math.floor(k / cols) + minJ) }));
    points[0] = { x: fromX, y: fromH, z: fromZ };
    if (found >= 0) points.push({ x: toX, y: toH, z: toZ });
    // A straight walk is held to the same rule as a step, checked a cell at a time along it.
    const direct = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => {
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
        let px = a.x, pz = a.z, ph = a.y;
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
            const h = k === n ? b.y : standable(x, z);
            if (h === null || !walkable(px, pz, ph, x, z, h)) return false;
            px = x; pz = z; ph = h;
        }
        return true;
    };
    const path = straighten(points, direct);
    let length = 0;
    for (let k = 1; k < path.length; k++) length += Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y, path[k]!.z - path[k - 1]!.z);
    const state = found >= 0 ? 'reached' : exhausted ? 'exhausted' : 'unreachable';
    return { state, path, length, cells };
}

/** The way with every corner a straight walk can cut left out: each point joined to the farthest one ahead it can walk to directly. */
function straighten<P>(points: P[], direct: (a: P, b: P) => boolean): P[] {
    if (points.length <= 2) return points;
    const out = [points[0]!];
    let at = 0;
    while (at < points.length - 1) {
        let next = at + 1;
        // Farthest first, within a window, so a long way costs a bounded number of checks per point.
        for (let k = Math.min(points.length - 1, at + 64); k > at + 1; k--) if (direct(points[at]!, points[k]!)) { next = k; break; }
        out.push(points[next]!);
        at = next;
    }
    return out;
}
