// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    paint.ts
 * @brief   Which paint a point of ground takes, by how high and how steep it is.
 */
import type { TerrainData } from './terrainPlugin';

const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a || 1e-6), 0), 1);
    return t * t * (3 - 2 * t);
};

/** The weights of grass, dirt, snow and rock at a point of ground, by how high (0 to 1 of the terrain) and how steep it is. */
export function paintWeights(h: number, ny: number, t: Pick<TerrainData, 'rockSlope' | 'dirtHeight' | 'snowHeight'>): [number, number, number, number] {
    const rock = smooth(t.rockSlope - 0.08, t.rockSlope + 0.08, 1 - ny);
    const snow = smooth(t.snowHeight - 0.06, t.snowHeight + 0.06, h) * (1 - rock * 0.85);
    const dirt = smooth(t.dirtHeight - 0.15, t.dirtHeight + 0.15, h) * (1 - snow) * (1 - rock);
    const grass = (1 - rock) * (1 - snow) * (1 - dirt);
    const sum = grass + dirt + snow + rock || 1;
    return [grass / sum, dirt / sum, snow / sum, rock / sum];
}

