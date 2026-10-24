// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    surface.ts
 * @brief   The ground as one set of triangles: what is drawn near the eye, what is collided with and what a query answers.
 *
 * @details The ground is the lattice of `cellSize` cells in the terrain's space (a node at every multiple of the cell), each node as
 *          high as the source says there (an area's nodes past its edge take the edge's height), and each cell cut in two along the
 *          diagonal from its (1, 0) corner to its (0, 1) corner. That is the finest level the quadtree draws (a patch's vertices fall
 *          on the lattice and are cut the same way), the triangles collision is built from, and what `heightAt` and `normalAt` read, so
 *          all three agree to the GPU's 16-bit height encoding. Coarser levels farther from the eye are drawn coarser; nothing collides
 *          with them. The rule does not change with the camera, the order tiles are made in, or a reload.
 */
import type { TerrainSource } from './source';

/** Cells along a collision tile's side. */
export const TILE_CELLS = 32;

/** A tile's triangles: positions relative to its corner (x0, 0, z0) in the terrain's space, wound counter-clockwise from above. */
export interface SurfaceTile { x0: number; z0: number; positions: Float32Array; indices: Uint32Array }

export class TerrainSurface {
    constructor(readonly source: TerrainSource, readonly cell: number) {}

    /** The height of lattice node (i, k), or null where the source has not answered. Off an area it is its nearest edge's, as the pages have it. */
    node(i: number, k: number): number | null {
        let x = i * this.cell, z = k * this.cell;
        const b = this.source.bounds;
        if (b) {
            x = Math.min(Math.max(x, b[0]), b[2]);
            z = Math.min(Math.max(z, b[1]), b[3]);
        }
        return this.source.height(x, z);
    }

    /** Whether (x, z) is on the ground: inside an area, anywhere for ground without end. */
    covers(x: number, z: number): boolean {
        const b = this.source.bounds;
        return !b || (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
    }

    /** The height at (x, z) on its cell's triangle, or null off the ground or where a corner is not known yet. */
    height(x: number, z: number): number | null {
        const c = this.corners(x, z);
        if (!c) return null;
        const [a, b, cc, d, fx, fz] = c;
        return fx + fz <= 1 ? a + (b - a) * fx + (cc - a) * fz : d + (cc - d) * (1 - fx) + (b - d) * (1 - fz);
    }

    /** The normal of the triangle under (x, z), or null where its height is not known. */
    normal(x: number, z: number): [number, number, number] | null {
        const c = this.corners(x, z);
        if (!c) return null;
        const [a, b, cc, d, fx, fz] = c;
        const sx = (fx + fz <= 1 ? b - a : d - cc) / this.cell, sz = (fx + fz <= 1 ? cc - a : d - b) / this.cell;
        const len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    /** Tile (tx, tz)'s triangles, or null while a node of it is not known yet. */
    tile(tx: number, tz: number): SurfaceTile | null {
        const n = TILE_CELLS, side = n + 1;
        const positions = new Float32Array(side * side * 3);
        for (let k = 0; k <= n; k++) for (let i = 0; i <= n; i++) {
            const h = this.node(tx * n + i, tz * n + k);
            if (h === null) return null;
            const at = (k * side + i) * 3;
            positions[at] = i * this.cell;
            positions[at + 1] = h;
            positions[at + 2] = k * this.cell;
        }
        const indices = new Uint32Array(n * n * 6);
        let at = 0;
        for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
            const a = k * side + i, b = a + 1, c = a + side, d = c + 1;
            // The patch's cut and winding (patch.ts): a, the next row, the next column; then the other half.
            indices.set([a, c, b, b, c, d], at);
            at += 6;
        }
        return { x0: tx * n * this.cell, z0: tz * n * this.cell, positions, indices };
    }

    /** The four corners of the cell under (x, z) and where in it the point is, or null. */
    private corners(x: number, z: number): [number, number, number, number, number, number] | null {
        if (!this.covers(x, z)) return null;
        const u = x / this.cell, v = z / this.cell;
        const i = Math.floor(u), k = Math.floor(v);
        const a = this.node(i, k), b = this.node(i + 1, k), c = this.node(i, k + 1), d = this.node(i + 1, k + 1);
        if (a === null || b === null || c === null || d === null) return null;
        return [a, b, c, d, u - i, v - k];
    }
}
