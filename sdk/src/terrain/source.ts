// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    source.ts
 * @brief   Where the ground's height and paint come from: a field over an area, or noise that goes on for ever.
 *
 * @details The terrain draws from height pages (pages.ts) and answers the CPU (what stands on it, what floats over it) from the same
 *          numbers, so both ask one source. Positions are in the terrain's own space (its entity at the origin), heights in world units
 *          above it.
 *            - An area is a heightfield (a heightmap, or noise made once and worn by rain) over `sizeX` by `sizeZ`, painted by its splatmap
 *              or by height and slope, with dirt where the rain ran.
 *            - An infinite ground is noise read at any (x, z), so it never ends and the same seed is the same ground everywhere. Rain cannot
 *              be run over ground that has no edge, so its wear is the noise's own: each octave is damped where the octaves under it are
 *              already steep, which leaves smooth valleys between sharp ridges and gullies down the slopes.
 */
import { paintWeights, type TerrainData } from './terrainPlugin';
import { sampleHeight, terrainNormal, type Heightfield } from './heightfield';

/** The ground a terrain draws, as the pages and the CPU read it. */
export interface TerrainSource {
    /** Whether the ground goes on for ever (no edge to clip, no area to bake). */
    readonly infinite: boolean;
    /** The area the ground covers, [minX, minZ, maxX, maxZ] in the terrain's space; null for an infinite one. */
    readonly bounds: readonly [number, number, number, number] | null;
    /** The least and the most the height can be: what the pages encode their heights over. */
    readonly minHeight: number;
    readonly maxHeight: number;
    /** The height at (x, z), or null off the area (or where a provider has not answered yet). */
    height(x: number, z: number): number | null;
    /** The ground's unit normal at (x, z), or null where the height is not known. */
    normal(x: number, z: number): [number, number, number] | null;
    /** The weights of the four layers (grass, dirt, snow, rock) at (x, z), where the ground there is `h` high and faces `ny` up. */
    paint(x: number, z: number, h: number, ny: number): [number, number, number, number];
    /**
     * The ground over a grid of `count` by `count` samples `spacing` apart from (x0, z0), when the source samples whole regions (a
     * provider, which may answer later); without it the pages read `height` and `paint` point by point.
     */
    region?(x0: number, z0: number, spacing: number, count: number): { heights: Float32Array; paint?: Float32Array } | Promise<{ heights: Float32Array; paint?: Float32Array }>;
}

/** The pixels of a splatmap, as the terrain read them. */
export interface Splat { width: number; height: number; pixels: Uint8Array }

/** An area's ground: a field of heights `height` tall, centred on the terrain, with its splatmap and where its rain ran. */
export class FieldSource implements TerrainSource {
    readonly infinite = false;
    readonly bounds: readonly [number, number, number, number];
    readonly minHeight = 0;
    readonly maxHeight: number;

    constructor(
        readonly field: Heightfield,
        private readonly data: Pick<TerrainData, 'sizeX' | 'sizeZ' | 'height' | 'rockSlope' | 'dirtHeight' | 'snowHeight'>,
        private readonly splat: Splat | null,
        private readonly flow: Float32Array | null,
    ) {
        this.bounds = [-data.sizeX / 2, -data.sizeZ / 2, data.sizeX / 2, data.sizeZ / 2];
        this.maxHeight = data.height;
    }

    height(x: number, z: number): number | null {
        const u = x / this.data.sizeX + 0.5, v = z / this.data.sizeZ + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        return sampleHeight(this.field, u, v) * this.data.height;
    }

    /** The ground's normal at (x, z), or null off the area. */
    normal(x: number, z: number): [number, number, number] | null {
        const u = x / this.data.sizeX + 0.5, v = z / this.data.sizeZ + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        return terrainNormal(this.field, u, v, this.data.sizeX, this.data.sizeZ, this.data.height);
    }

    paint(x: number, z: number, h: number, ny: number): [number, number, number, number] {
        const u = Math.min(Math.max(x / this.data.sizeX + 0.5, 0), 1), v = Math.min(Math.max(z / this.data.sizeZ + 0.5, 0), 1);
        let w = paintWeights(h / Math.max(this.data.height, 1e-6), ny, this.data);
        const splat = this.splat;
        if (splat) {
            const sx = Math.round(u * (splat.width - 1)), sy = Math.round(v * (splat.height - 1));
            const at = (sy * splat.width + sx) * 4;
            const s: [number, number, number, number] = [splat.pixels[at]! / 255, splat.pixels[at + 1]! / 255, splat.pixels[at + 2]! / 255, splat.pixels[at + 3]! / 255];
            const sum = s[0] + s[1] + s[2] + s[3];
            if (sum > 0.001) w = [s[0] / sum, s[1] / sum, s[2] / sum, s[3] / sum];
        }
        if (this.flow) {
            // Where the rain ran it took the grass and left dirt; snow and rock stay as they are.
            const fx = Math.round(u * (this.field.width - 1)), fy = Math.round(v * (this.field.height - 1));
            const channel = smooth(0.45, 0.85, this.flow[fy * this.field.width + fx]!) * 0.8 * w[0];
            w = [w[0] - channel, w[1] + channel, w[2], w[3]];
        }
        return w;
    }
}

/** What shapes an infinite ground: the noise's seed and scale, and how worn and how ridged it is. */
export type NoiseParams = Pick<TerrainData, 'seed' | 'frequency' | 'octaves' | 'persistence' | 'ridged' | 'warp' | 'erosion' | 'sizeX' | 'height'
    | 'rockSlope' | 'dirtHeight' | 'snowHeight'>;

/**
 * Ground that goes on for ever: fractal noise read at any point, `frequency` hills to every `sizeX` world units, `height` tall at most.
 * `erosion` damps each octave by how steep the ones under it already are, which is what rain does to real ground.
 */
export class NoiseSource implements TerrainSource {
    readonly infinite = true;
    readonly bounds = null;
    readonly minHeight = 0;
    readonly maxHeight: number;

    constructor(private readonly p: NoiseParams) {
        this.maxHeight = p.height;
    }

    height(x: number, z: number): number {
        return this.sample(x, z)[0] * this.p.height;
    }

    /** The normal at (x, z), from the noise's own slope. */
    normal(x: number, z: number): [number, number, number] {
        const [, dx, dz] = this.sample(x, z);
        const sx = dx * this.p.height, sz = dz * this.p.height;
        const len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    paint(_x: number, _z: number, h: number, ny: number): [number, number, number, number] {
        return paintWeights(h / Math.max(this.p.height, 1e-6), ny, this.p);
    }

    /** The height (0 to 1) at (x, z) and its slope along x and z, per world unit. */
    sample(x: number, z: number): [number, number, number] {
        const p = this.p;
        const scale = Math.max(p.frequency, 1e-6) / Math.max(p.sizeX, 1e-6);
        let u = x * scale, v = z * scale;
        const warp = Math.min(Math.max(p.warp, 0), 1);
        if (warp > 0) {
            // Pushed about by noise of its own, up to half a hill: valleys wind and ridges bend.
            u += (noised(u + 5.2, v + 1.3, p.seed + 7001)[0] * 2 - 1) * warp * 0.5;
            v += (noised(u + 8.3, v + 2.8, p.seed + 7003)[0] * 2 - 1) * warp * 0.5;
        }
        const octaves = Math.max(1, Math.min(8, Math.floor(p.octaves)));
        const wear = Math.min(Math.max(p.erosion, 0), 4);
        let amp = 1, freq = 1, sum = 0, norm = 0, dx = 0, dz = 0;
        // The slope the octaves so far have built up, which damps the ones that follow.
        let gx = 0, gz = 0;
        for (let o = 0; o < octaves; o++) {
            const [n, nx, nz] = noised(u * freq, v * freq, p.seed + o * 101);
            let value = n, ddx = nx * freq, ddz = nz * freq;
            if (p.ridged > 0) {
                // Folded about its middle, a sharp crest where it turns.
                const s = n * 2 - 1, sign = s >= 0 ? 1 : -1;
                value = n * (1 - p.ridged) + (1 - Math.abs(s)) * p.ridged;
                ddx = ddx * (1 - p.ridged) - 2 * sign * ddx * p.ridged;
                ddz = ddz * (1 - p.ridged) - 2 * sign * ddz * p.ridged;
            }
            gx += ddx * amp; gz += ddz * amp;
            const damp = wear > 0 ? 1 / (1 + wear * (gx * gx + gz * gz) * 0.25) : 1;
            sum += value * amp * damp;
            dx += ddx * amp * damp; dz += ddz * amp * damp;
            norm += amp;
            amp *= p.persistence;
            freq *= 2;
        }
        return [sum / norm, (dx / norm) * scale, (dz / norm) * scale];
    }
}

/** A 32-bit integer hash, stable across hosts, so a seed makes the same ground everywhere. */
function hash2(x: number, y: number, seed: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

/** Value noise at (x, y), 0 to 1, and its derivatives along x and y. */
export function noised(x: number, y: number, seed: number): [number, number, number] {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const dsx = 6 * fx * (1 - fx), dsy = 6 * fy * (1 - fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    const k1 = b - a, k2 = c - a, k3 = a - b - c + d;
    return [a + k1 * sx + k2 * sy + k3 * sx * sy, (k1 + k3 * sy) * dsx, (k2 + k3 * sx) * dsy];
}

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(Math.max((x - a) / (b - a || 1e-6), 0), 1);
    return t * t * (3 - 2 * t);
}
