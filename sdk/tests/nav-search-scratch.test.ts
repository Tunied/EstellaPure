// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { findPath } from '../src/ai/nav/pathfind';
import { leaseGridSearch, releaseGridSearch } from '../src/ai/nav/gridSearchScratch';

function referenceCosts(grid: NavGrid, start: { x: number; y: number }, diagonal: boolean): number[] {
    const costs = Array<number>(grid.width * grid.height).fill(Infinity);
    const closed = new Set<number>();
    costs[grid.index(start.x, start.y)] = 0;
    for (;;) {
        let at = -1, nearest = Infinity;
        for (let i = 0; i < costs.length; i++) if (!closed.has(i) && costs[i]! < nearest) {
            at = i; nearest = costs[i]!;
        }
        if (at < 0) return costs;
        closed.add(at);
        const x = at % grid.width, y = Math.floor(at / grid.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
            if (!grid.isWalkable(x + dx, y + dy)) continue;
            if (dx && dy && (!grid.isWalkable(x + dx, y) || !grid.isWalkable(x, y + dy))) continue;
            const next = grid.index(x + dx, y + dy);
            costs[next] = Math.min(costs[next]!, nearest + Math.hypot(dx, dy) * grid.costAt(x + dx, y + dy));
        }
    }
}

describe('grid search working storage', () => {
    it('retains weighted shortest paths and closest partial endpoints across repeated queries', () => {
        let seed = 23;
        const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
        const corners = [{ x: 0, y: 0 }, { x: 8, y: 8 }, { x: 8, y: 0 }, { x: 0, y: 8 }];
        for (let sample = 0; sample < 40; sample++) {
            const mask = Uint8Array.from({ length: 81 }, () => random() > 0.25 ? 1 : 0);
            for (const p of corners) mask[p.y * 9 + p.x] = 1;
            if (sample % 3 === 0) for (let y = 0; y < 9; y++) mask[y * 9 + 4] = 0;
            const grid = new NavGrid({ width: 9, height: 9, cellSize: 1, walkable: mask });
            for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) grid.setCost(x, y, 1 + Math.floor(random() * 4));
            for (const [ai, bi] of [[0,1],[1,0],[0,2],[3,1]]) {
                const a = corners[ai!]!, b = corners[bi!]!, diagonal = sample % 2 === 0;
                const oracle = referenceCosts(grid, a, diagonal);
                const path = findPath(grid, a, b, { diagonal, snapRadius: 0 })!;
                expect(path[0]).toEqual(a);
                const end = path.at(-1)!;
                if (Number.isFinite(oracle[grid.index(b.x, b.y)])) expect(end).toEqual(b);
                else {
                    const distance = (x: number, y: number) => {
                        const dx = Math.abs(x - b.x), dy = Math.abs(y - b.y);
                        return dx + dy + (diagonal ? (Math.SQRT2 - 2) * Math.min(dx, dy) : 0);
                    };
                    const closest = Math.min(...oracle.map((v, i) => Number.isFinite(v) ? distance(i % 9, Math.floor(i / 9)) : Infinity));
                    expect(distance(end.x, end.y)).toBeCloseTo(closest);
                }
                let cost = 0;
                for (let i = 1; i < path.length; i++) {
                    const p = path[i - 1]!, q = path[i]!;
                    expect(grid.isWalkable(q.x, q.y)).toBe(true);
                    expect(Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y))).toBe(1);
                    if (p.x !== q.x && p.y !== q.y) {
                        expect(diagonal && grid.isWalkable(p.x, q.y) && grid.isWalkable(q.x, p.y)).toBe(true);
                    }
                    cost += Math.hypot(q.x - p.x, q.y - p.y) * grid.costAt(q.x, q.y);
                }
                expect(cost).toBeCloseTo(oracle[grid.index(end.x, end.y)]!);
            }
        }
    });

    it('supports a nested query on the same grid without replacing the outer path state', () => {
        const grid = new NavGrid({ width: 16, height: 16, cellSize: 1 });
        for (let y = 0; y < 16; y++) if (y !== 8) grid.setWalkable(8, y, false);
        let nested = false;
        grid.costAt = () => {
            if (!nested) {
                nested = true;
                const route = findPath(grid, { x: 15, y: 0 }, { x: 0, y: 15 })!;
                expect(route[0]).toEqual({ x: 15, y: 0 }); expect(route.at(-1)).toEqual({ x: 0, y: 15 });
            }
            return 1;
        };
        const outer = findPath(grid, { x: 0, y: 0 }, { x: 15, y: 15 })!;
        expect(nested).toBe(true);
        expect(outer[0]).toEqual({ x: 0, y: 0 }); expect(outer.at(-1)).toEqual({ x: 15, y: 15 });
        expect(outer.some(p => p.x === 8 && p.y === 8)).toBe(true);
    });

    it('releases leased storage after a query throws', () => {
        const grid = new NavGrid({ width: 5, height: 5, cellSize: 1 });
        const first = leaseGridSearch(grid); releaseGridSearch(first);
        grid.costAt = () => { throw new Error('cost failed'); };
        expect(() => findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })).toThrow('cost failed');
        const again = leaseGridSearch(grid);
        expect(again).toBe(first); releaseGridSearch(again);
        grid.costAt = () => 1;
        expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })?.at(-1)).toEqual({ x: 4, y: 4 });
    });

    it('clears stamps when their counter wraps', () => {
        const grid = new NavGrid({ width: 5, height: 5, cellSize: 1 });
        const state = leaseGridSearch(grid);
        state.epoch = 0xffffffff;
        state.seen.fill(1); state.closed.fill(1); state.gScore.fill(-100); state.cameFrom.fill(0);
        releaseGridSearch(state);
        const route = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })!;
        expect(route[0]).toEqual({ x: 0, y: 0 }); expect(route.at(-1)).toEqual({ x: 4, y: 4 });
    });

    it('leaves returned routes owned by their caller', () => {
        const grid = new NavGrid({ width: 20, height: 20, cellSize: 1 });
        const first = findPath(grid, { x: 0, y: 0 }, { x: 19, y: 19 })!;
        const snapshot = structuredClone(first);
        for (let i = 0; i < 20; i++) findPath(grid, { x: 19, y: i }, { x: 0, y: 19 - i });
        expect(first).toEqual(snapshot);
    });
});
