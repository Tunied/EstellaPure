// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    groundQuery.ts
 * @brief   What the ground says at a world point, from the ground's own data: the same answers on the main thread and on a worker.
 *
 * @details A terrain answers three questions at a point: how high, which way it faces, how it is painted. They are the ground's surface (the lattice of
 *          triangles, surface.ts) and its source (the field or the noise), shifted by where the terrain stands. Everything here is a function of that data
 *          alone, so a worker given the data (`GroundData`) answers as the terrain does, and what a world is laid out from does not depend on which of them
 *          was asked.
 */
import { FieldSource, NoiseSource, type FieldSourceData, type NoiseParams, type TerrainSource } from './source';
import { TerrainSurface } from './surface';

/** Where a terrain stands, in the world. */
export interface GroundOrigin { x: number; y: number; z: number }

/** The world height of the ground at (x, z) on a surface standing at `origin`, or null off it. */
export function groundHeightAt(surface: TerrainSurface, origin: GroundOrigin, x: number, z: number): number | null {
    const h = surface.height(x - origin.x, z - origin.z);
    return h === null ? null : origin.y + h;
}

/** The ground's unit normal at (x, z), or null off the ground. */
export function groundNormalAt(surface: TerrainSurface, origin: GroundOrigin, x: number, z: number): [number, number, number] | null {
    return surface.normal(x - origin.x, z - origin.z);
}

/** The weights of the ground's layers at (x, z), or null off the ground. */
export function groundPaintAt(source: TerrainSource, surface: TerrainSurface, origin: GroundOrigin, x: number, z: number): readonly number[] | null {
    const lx = x - origin.x, lz = z - origin.z;
    const h = surface.height(lx, lz), n = surface.normal(lx, lz);
    return h === null || !n ? null : source.paint(lx, lz, h, n[1]);
}

/** A terrain's ground as data a worker can rebuild it from. */
export interface GroundData {
    origin: GroundOrigin;
    /** The lattice's cell, in the terrain's units. */
    cell: number;
    source: { kind: 'field'; data: FieldSourceData } | { kind: 'noise'; data: NoiseParams };
}

/** The ground of a terrain from its data. */
export class GroundQuery {
    private readonly source_: TerrainSource;
    private readonly surface_: TerrainSurface;
    private readonly origin_: GroundOrigin;

    constructor(data: GroundData) {
        this.source_ = data.source.kind === 'field' ? FieldSource.fromData(data.source.data) : NoiseSource.fromData(data.source.data);
        this.surface_ = new TerrainSurface(this.source_, data.cell);
        this.origin_ = data.origin;
    }

    heightAt(x: number, z: number): number | null { return groundHeightAt(this.surface_, this.origin_, x, z); }
    normalAt(x: number, z: number): [number, number, number] | null { return groundNormalAt(this.surface_, this.origin_, x, z); }
    paintAt(x: number, z: number): readonly number[] | null { return groundPaintAt(this.source_, this.surface_, this.origin_, x, z); }
}
