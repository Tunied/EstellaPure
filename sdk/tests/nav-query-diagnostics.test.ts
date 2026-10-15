// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Navigation } from '../src/ai/nav/Navigation';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { NavMesh } from '../src/ai/nav/NavMesh';
import { findPath } from '../src/ai/nav/pathfind';

const islands = () => new NavMesh({
    verts: new Float32Array([0,0,0,10,0,0,10,0,10,0,0,10,20,0,0,30,0,0,30,0,10,20,0,10]),
    polys: new Int32Array([0,1,2,3,4,5,6,7]), neis: new Int32Array(8).fill(-1),
    polyCount: 2, maxVertsPerPoly: 4, agentRadius: 1, snapDistance: 0.1,
    verticalReach: 5, areas: new Uint8Array([1,1]),
});

describe('route diagnostics', () => {
    it('reports no surface and does not guess completeness for custom surfaces', () => {
        const nav = new Navigation(), p = { x: 0, y: 0 };
        expect(nav.queryWorldPath(p, p)).toEqual({ path: null, status: 'unavailable', reason: 'no-surface' });
        nav.setSurface({ up: { x: 0, y: 0, z: 1 }, findWorldPath: () => [], isNavigable: () => true, describe: () => {} });
        expect(nav.queryWorldPath(p, p)).toEqual({ path: [], status: 'unknown', reason: 'diagnostics-unavailable' });
    });

    it('distinguishes a complete grid path from a disconnected best-effort path', () => {
        const grid = new NavGrid({ width: 11, height: 9, cellSize: 1 });
        const start = { x: 2, y: 4 }, target = { x: 8, y: 4 };
        expect(grid.queryWorldPath(start, target).status).toBe('complete');
        for (let y = 0; y < 9; y++) grid.setWalkable(5, y, false);
        for (let i = 0; i < 3; i++) {
            const query = grid.queryWorldPath(start, target);
            expect(query.status).toBe('partial'); expect(query.reason).toBe('disconnected');
            expect(query.path?.at(-1)?.x).toBe(4);
        }
        grid.setWalkable(5, 4, true);
        expect(grid.queryWorldPath(start, target).status).toBe('complete');
    });

    it('explains radius-dependent failure through a one-cell door', () => {
        const grid = new NavGrid({ width: 11, height: 9, cellSize: 1 });
        for (let y = 0; y < 9; y++) if (y !== 4) grid.setWalkable(5, y, false);
        const start = { x: 2, y: 4 }, goal = { x: 8, y: 4 };
        expect(grid.queryWorldPath(start, goal).status).toBe('complete');
        expect(grid.queryWorldPath(start, goal, { radius: 2 })).toMatchObject({ status: 'partial', reason: 'insufficient-clearance' });
    });

    it('keeps endpoint snapping and explains endpoints outside its reach', () => {
        const grid = new NavGrid({ width: 10, height: 10, cellSize: 1 });
        grid.setWalkable(5, 5, false);
        expect(grid.queryWorldPath({ x: 2, y: 2 }, { x: 5, y: 5 }).status).toBe('complete');
        expect(grid.queryWorldPath({ x: -50, y: 0 }, { x: 2, y: 2 }).reason).toBe('start-unavailable');
        expect(grid.queryWorldPath({ x: 2, y: 2 }, { x: 50, y: 50 }).reason).toBe('target-unavailable');
    });

    it('mesh diagnostics retain actual search completeness and reject an undersized bake', () => {
        const mesh = islands(), from = { x: 5, y: 0, z: 5 };
        expect(mesh.queryWorldPath(from, { x: 8, y: 0, z: 8 }).status).toBe('complete');
        expect(mesh.queryWorldPath(from, { x: 25, y: 0, z: 5 })).toMatchObject({ status: 'partial', reason: 'disconnected' });
        expect(mesh.queryWorldPath(from, { x: 100, y: 0, z: 5 })).toMatchObject({ status: 'partial', reason: 'target-unavailable' });
        expect(mesh.queryWorldPath({ x: -100, y: 0, z: 5 }, from).reason).toBe('start-unavailable');
        expect(mesh.queryWorldPath(from, from, { radius: 2 })).toEqual({ path: null, status: 'unavailable', reason: 'radius-mismatch' });
    });
});

describe('cached disconnected grid searches', () => {
    it('retains the first search nearest-endpoint distance across deterministic maps', () => {
        let seed = 17;
        const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
        const distance = (p: { x: number; y: number }) => {
            const x = 8 - p.x, y = 8 - p.y;
            return x + y + (Math.SQRT2 - 2) * Math.min(x, y);
        };
        for (let sample = 0; sample < 40; sample++) {
            const mask = Uint8Array.from({ length: 81 }, () => random() > 0.25 ? 1 : 0);
            mask[0] = mask[80] = 1;
            if (sample % 2) for (let y = 0; y < 9; y++) mask[y * 9 + 4] = 0;
            const grid = new NavGrid({ width: 9, height: 9, cellSize: 1, walkable: mask });
            const first = findPath(grid, { x: 0, y: 0 }, { x: 8, y: 8 })!;
            const repeated = findPath(grid, { x: 0, y: 0 }, { x: 8, y: 8 })!;
            expect(distance(repeated.at(-1)!)).toBeCloseTo(distance(first.at(-1)!));
            for (let i = 1; i < repeated.length; i++) {
                const a = repeated[i - 1]!, b = repeated[i]!;
                expect(grid.isWalkable(b.x, b.y)).toBe(true);
                expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1);
                if (a.x !== b.x && a.y !== b.y) {
                    expect(grid.isWalkable(a.x, b.y) && grid.isWalkable(b.x, a.y)).toBe(true);
                }
            }
        }
    });
    it('invalidates after obstacle removal and still routes around newly placed blockers', () => {
        const grid = new NavGrid({ width: 11, height: 9, cellSize: 1 });
        for (let y = 0; y < 9; y++) grid.setObstructed(5, y, true);
        const a = { x: 2, y: 4 }, b = { x: 8, y: 4 };
        expect(findPath(grid, a, b)?.at(-1)?.x).toBe(4);
        expect(findPath(grid, a, b)?.at(-1)?.x).toBe(4);
        grid.clearObstructions();
        expect(findPath(grid, a, b)?.at(-1)).toEqual(b);
        grid.setObstructed(4, 4, true);
        expect(findPath(grid, a, b)?.some(p => p.x === 4 && p.y === 4)).toBe(false);
    });

    it('includes dynamic blockers in clearance and restores room after removal', () => {
        const grid = new NavGrid({ width: 11, height: 9, cellSize: 1 });
        expect(grid.clearanceAt(4, 4)).toBeGreaterThan(1);
        grid.setObstructed(5, 4, true);
        expect(grid.clearanceAt(4, 4)).toBe(1);
        grid.clearObstructions();
        expect(grid.clearanceAt(4, 4)).toBeGreaterThan(1);
    });

    it('keeps weighted routing live after connectivity is remembered', () => {
        const grid = new NavGrid({ width: 9, height: 5, cellSize: 1 });
        for (let y = 0; y < 5; y++) grid.setWalkable(4, y, false);
        const a = { x: 0, y: 2 }, b = { x: 8, y: 2 };
        findPath(grid, a, b);
        grid.setCost(2, 2, 100);
        const path = findPath(grid, a, b)!;
        expect(path.at(-1)).toEqual({ x: 3, y: 2 });
        expect(path.some(p => p.x === 2 && p.y === 2)).toBe(false);
    });

    it('does not connect diagonal corners or reuse clearance for another body size', () => {
        const pinched = new NavGrid({ width: 2, height: 2, cellSize: 1, walkable: [1,0,0,1] });
        for (let i = 0; i < 2; i++) expect(findPath(pinched, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([{ x: 0, y: 0 }]);
        const grid = new NavGrid({ width: 11, height: 9, cellSize: 1 });
        for (let y = 0; y < 9; y++) if (y !== 4) grid.setWalkable(5, y, false);
        const a = { x: 2, y: 4 }, b = { x: 8, y: 4 };
        for (let i = 0; i < 2; i++) expect(grid.queryWorldPath(a, b, { radius: 2 }).reason).toBe('insufficient-clearance');
        expect(grid.queryWorldPath(a, b).status).toBe('complete');
    });
});
