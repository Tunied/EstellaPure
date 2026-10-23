// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shore.ts
 * @brief   Where a lake ends and how deep it is, baked into a grid the CPU and the Water shader both read.
 *
 * @details A lake has an outline (a polygon on its own xz plane) and sits over ground, and the waves know about both: they die away as the
 *          water gets shallow or the edge near, and the shore carries foam. This is that knowledge as a field, sampled on a grid over the
 *          lake's box:
 *            - the signed distance to the outline, positive inside;
 *            - how deep the water is, from the ground under it (infinite where nothing is known).
 *          From the two comes one number, the share of the waves a point keeps: it is written into the mesh's vertices (so the geometry calms
 *          toward the shore) and into a small texture (so the pixels do, the edge is cut where the outline is, and the shore foams), and
 *          {@link ShoreField.damp} answers the same for the CPU. A body without an outline is its rectangle and a body without ground is
 *          as deep as it likes.
 */

/** The depth of water over ground nothing is known of: deep enough that nothing calms for it, and finite so a grid can be blended. */
export const UNKNOWN_DEPTH = 1e9;

/** A point on the body's plane. */
export interface Point2 { x: number; y: number }

/** The signed distance from (x, z) to the polygon's outline, positive inside it, negative outside. Self-intersecting outlines are not judged. */
export function polygonSdf(poly: readonly Point2[], x: number, z: number): number {
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]!, b = poly[i]!;
        const ex = b.x - a.x, ez = b.y - a.y;
        const len2 = ex * ex + ez * ez;
        let t = len2 > 0 ? ((x - a.x) * ex + (z - a.y) * ez) / len2 : 0;
        t = Math.min(Math.max(t, 0), 1);
        const dx = x - (a.x + t * ex), dz = z - (a.y + t * ez);
        best = Math.min(best, Math.hypot(dx, dz));
        if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside ? best : -best;
}

/** The share of the waves kept where the water is `reach` deep or far from the edge: none at the edge, all from `width` in; with no width, all of them everywhere. */
export function shoreDamp(reach: number, width: number): number {
    if (width <= 0) return 1;
    if (reach <= 0) return 0;
    const t = Math.min(reach / width, 1);
    return t * t * (3 - 2 * t);
}

/** The ground under the water: its height in the body's own space at (x, z), or null where none is known. */
export type GroundDepth = (x: number, z: number) => number | null;

/** The baked field over a lake's box. */
export class ShoreField {
    readonly minX: number;
    readonly minZ: number;
    readonly sizeX: number;
    readonly sizeZ: number;
    readonly res: number;
    /** How far from the edge, and how deep, the waves take to come to their full height. */
    readonly width: number;
    /** Signed distance to the outline per sample, and the depth of the water ({@link UNKNOWN_DEPTH} where the ground is not known). */
    readonly sdf: Float32Array;
    readonly depth: Float32Array;

    constructor(poly: readonly Point2[], res: number, width: number, ground?: GroundDepth) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y); }
        this.minX = minX; this.minZ = minZ;
        this.sizeX = Math.max(maxX - minX, 1e-3); this.sizeZ = Math.max(maxZ - minZ, 1e-3);
        this.res = res;
        this.width = width;
        this.sdf = new Float32Array(res * res);
        this.depth = new Float32Array(res * res);
        for (let j = 0; j < res; j++) {
            for (let i = 0; i < res; i++) {
                const x = minX + (i / (res - 1)) * this.sizeX, z = minZ + (j / (res - 1)) * this.sizeZ;
                this.sdf[j * res + i] = polygonSdf(poly, x, z);
                const ground_ = ground ? ground(x, z) : null;
                this.depth[j * res + i] = ground_ === null ? UNKNOWN_DEPTH : Math.min(-ground_, UNKNOWN_DEPTH);
            }
        }
    }

    private at(array: Float32Array, x: number, z: number): number {
        const fx = Math.min(Math.max((x - this.minX) / this.sizeX, 0), 1) * (this.res - 1);
        const fz = Math.min(Math.max((z - this.minZ) / this.sizeZ, 0), 1) * (this.res - 1);
        const i = Math.min(Math.floor(fx), this.res - 2), j = Math.min(Math.floor(fz), this.res - 2);
        const tx = fx - i, tz = fz - j;
        const v = (a: number, b: number): number => array[b * this.res + a]!;
        const lo = v(i, j) * (1 - tx) + v(i + 1, j) * tx, hi = v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx;
        return lo * (1 - tz) + hi * tz;
    }

    /** The signed distance to the outline at (x, z). */
    distance(x: number, z: number): number { return this.at(this.sdf, x, z); }

    /** How deep the water is at (x, z). */
    waterDepth(x: number, z: number): number { return this.at(this.depth, x, z); }

    /** Whether (x, z) is inside the outline: the grid covers the outline's box, and nothing outside it is. */
    inside(x: number, z: number): boolean {
        if (x < this.minX || x > this.minX + this.sizeX || z < this.minZ || z > this.minZ + this.sizeZ) return false;
        return this.distance(x, z) >= 0;
    }

    /** The share of the waves kept at (x, z). */
    damp(x: number, z: number): number {
        return shoreDamp(Math.min(this.distance(x, z), this.waterDepth(x, z)), this.width);
    }

    /**
     * The field as RGBA8 for the shader: red the signed distance (0.5 at the edge, `range` away at 0 and 1), green the depth over `range`, blue the share of
     * the waves kept, alpha 255. `range` is the distance the encoding spans, so the shader needs it too.
     */
    encode(range: number): Uint8Array {
        const out = new Uint8Array(this.res * this.res * 4);
        for (let k = 0; k < this.res * this.res; k++) {
            const sdf = this.sdf[k]!, depth = this.depth[k]!;
            out[k * 4] = Math.round(Math.min(Math.max(sdf / (2 * range) + 0.5, 0), 1) * 255);
            out[k * 4 + 1] = Math.round(Math.min(Math.max(depth / range, 0), 1) * 255);
            out[k * 4 + 2] = Math.round(shoreDamp(Math.min(sdf, depth), this.width) * 255);
            out[k * 4 + 3] = 255;
        }
        return out;
    }
}
