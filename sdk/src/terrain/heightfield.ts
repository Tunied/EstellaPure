// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    heightfield.ts
 * @brief   The ground as numbers: a grid of heights, read by a heightmap image or made by noise.
 *
 * @details Heights are stored as 0..1 and scaled by the terrain's own height, so the same field
 *          serves a terrain of any size and a rescale never touches the data. Everything here is
 *          pure and has no engine in it, which is what lets the mesh builder and the tests stand on it.
 */

/** A rectangular grid of heights, 0 to 1, row-major with z as the row. */
export interface Heightfield {
    readonly width: number;
    readonly height: number;
    readonly data: Float32Array;
}

/**
 * A heightfield from an RGBA image: the red channel is the height. 8 bits is 256 steps, which on a tall terrain
 * reads as terraces, so a green channel that is not all zero is taken as the low byte of a 16-bit height
 * (red is the high one), the way an exported 16-bit map is usually packed into an 8-bit-per-channel PNG.
 */
export function heightfieldFromPixels(width: number, height: number, pixels: ArrayLike<number>): Heightfield {
    const data = new Float32Array(width * height);
    let wide = false;
    for (let i = 0; i < width * height; i++) {
        if (pixels[i * 4 + 1]! !== 0 && pixels[i * 4 + 1]! !== pixels[i * 4]!) { wide = true; break; }
    }
    for (let i = 0; i < width * height; i++) {
        const hi = pixels[i * 4]!;
        data[i] = wide ? (hi * 256 + pixels[i * 4 + 1]!) / 65535 : hi / 255;
    }
    return { width, height, data };
}

/** A 32-bit integer hash, stable across hosts, so a seed makes the same ground everywhere. */
function hash2(x: number, y: number, seed: number): number {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** What {@link proceduralHeightfield} is made from. */
export interface ProceduralParams {
    /** Samples along each side. */
    resolution: number;
    seed: number;
    /** How many times the biggest hill repeats across the terrain. */
    frequency: number;
    octaves: number;
    /** What each octave keeps of the height of the one before it: lower is smoother. */
    persistence: number;
    /** 0 is rolling hills; 1 is sharp ridges, the way eroded mountains look. */
    ridged: number;
}

/** Fractal noise as a heightfield, scaled to span 0 to 1 so the terrain's height is its true range. */
export function proceduralHeightfield(p: ProceduralParams): Heightfield {
    const n = Math.max(2, Math.floor(p.resolution));
    const data = new Float32Array(n * n);
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            let amplitude = 1, frequency = p.frequency, sum = 0, norm = 0;
            for (let o = 0; o < Math.max(1, Math.min(8, Math.floor(p.octaves))); o++) {
                let v = valueNoise(i / (n - 1) * frequency, j / (n - 1) * frequency, p.seed + o * 101);
                v = v * (1 - p.ridged) + (1 - Math.abs(v * 2 - 1)) * p.ridged;
                sum += v * amplitude;
                norm += amplitude;
                amplitude *= p.persistence;
                frequency *= 2;
            }
            const v = sum / norm;
            data[j * n + i] = v;
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    const span = max - min || 1;
    for (let i = 0; i < data.length; i++) data[i] = (data[i]! - min) / span;
    return { width: n, height: n, data };
}

/** The height at (u, v), each 0 to 1 across the field, bilinear between the four samples it falls among. */
export function sampleHeight(field: Heightfield, u: number, v: number): number {
    const x = Math.min(Math.max(u, 0), 1) * (field.width - 1);
    const y = Math.min(Math.max(v, 0), 1) * (field.height - 1);
    const x0 = Math.min(Math.floor(x), field.width - 2), y0 = Math.min(Math.floor(y), field.height - 2);
    const fx = x - x0, fy = y - y0;
    const at = (i: number, j: number): number => field.data[j * field.width + i]!;
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
}

/** The unit normal of the ground at (u, v), from the heights a texel either side of it, in world units. */
export function terrainNormal(
    field: Heightfield, u: number, v: number, sizeX: number, sizeZ: number, heightScale: number,
): [number, number, number] {
    const du = 1 / (field.width - 1), dv = 1 / (field.height - 1);
    const dx = (sampleHeight(field, u + du, v) - sampleHeight(field, u - du, v)) * heightScale / (2 * du * sizeX);
    const dz = (sampleHeight(field, u, v + dv) - sampleHeight(field, u, v - dv)) * heightScale / (2 * dv * sizeZ);
    const len = Math.hypot(dx, 1, dz);
    return [-dx / len, 1 / len, -dz / len];
}
