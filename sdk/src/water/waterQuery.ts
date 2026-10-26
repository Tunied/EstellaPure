// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterQuery.ts
 * @brief   What a world is laid out by in the water: how deep it stands over a height, and how far a point is from the shore.
 *
 * @details A part of a baked water field that is a function of three arrays, so a worker given them answers as the main thread does. Its own file so that a
 *          worker carries these few lines and not the baking of water.
 */

/** The grid a zone is baked over. */
export interface ZoneGrid { minX: number; minZ: number; sizeX: number; sizeZ: number; nx: number; nz: number }

/** How far a texel is from a shore when it is the open sea's: past any shore, deep in. */
export const DEEP = 1e6;

/** The part of a baked water field that a world is laid out by, as data a worker can be given. */
export interface WaterQueryData {
    grid: ZoneGrid;
    /** The surface's height at rest, and the distance from the shore (above zero in the water), at each texel. */
    height: Float32Array;
    shore: Float32Array;
    /** The open sea past the region, if the zone has one. */
    ocean: { level: number } | null;
}

/** How deep water stands at a point and how far it is from the shore: what a world is laid out by, from the field's own numbers. */
export class WaterQuery {
    constructor(readonly data: WaterQueryData) {}

    private lerp(x: number, z: number): { height: number; shore: number } | null {
        const { minX, minZ, sizeX, sizeZ, nx, nz } = this.data.grid;
        if (nx < 2 || nz < 2) return null;
        const u = (x - minX) / sizeX, v = (z - minZ) / sizeZ;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        const fx = u * (nx - 1), fz = v * (nz - 1);
        const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
        const tx = fx - i, tz = fz - j, k = j * nx + i;
        const at = (a: Float32Array): number => (a[k]! * (1 - tx) + a[k + 1]! * tx) * (1 - tz) + (a[k + nx]! * (1 - tx) + a[k + nx + 1]! * tx) * tz;
        return { height: at(this.data.height), shore: at(this.data.shore) };
    }

    /** How deep the water stands at rest over the world height `y` at (x, z): above zero under water, null where there is none. */
    depthAt(x: number, z: number, y: number): number | null {
        const inside = this.lerp(x, z);
        if (inside) return inside.shore > 0 ? inside.height - y : null;
        return this.data.ocean ? this.data.ocean.level - y : null;
    }

    /** How far (x, z) is from the water's edge: above zero on dry land, below in the water, deep in the open sea past the region; null where no water is baked. */
    shoreAt(x: number, z: number): number | null {
        const inside = this.lerp(x, z);
        if (inside) return -inside.shore;
        return this.data.ocean ? -DEEP : null;
    }
}

