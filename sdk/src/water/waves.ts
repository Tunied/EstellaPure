// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waves.ts
 * @brief   The height of the water, in one formula the CPU and the Water shader share.
 *
 * @details Four peaked sines (`exp(sin(theta) - 1)`: a crest narrower than its trough) a few directions apart, each with its own length,
 *          weight and speed taken from four numbers. The shader's `waterWaveHeight` and `waveSlope` are the same arithmetic written in
 *          GLSL and WGSL, so what a floating object reads here is what is drawn there. Change a constant in one place and the other
 *          two places have to change with it; the table below is the one the shaders repeat.
 *
 *          Everything here is in the body's own space: x and z along its surface, the height along its up.
 */

/** Each wave of the set: its heading off the base direction (degrees), its length and its height as shares of the body's, and its speed share. */
export const WAVE_SET: readonly (readonly [number, number, number, number])[] = [
    [0, 1, 1, 1],
    [28, 0.62, 0.55, 1.1],
    [-37, 0.37, 0.3, 1.2],
    [71, 0.21, 0.15, 1.35],
];

/** What shapes the waves: the fields of a WaterBody, and the parameters of the Water material they are written to. */
export interface WaveParams {
    /** Height of the tallest wave, in world units. */
    height: number;
    /** Length of the longest wave. */
    length: number;
    /** A multiplier on how fast they travel. */
    speed: number;
    /** The base heading, in degrees. */
    direction: number;
}

const TAU = Math.PI * 2;
const GRAVITY = 9.8;

/**
 * How much of a wave a mesh of `cell`-sized cells can draw: none below three cells to a wavelength, all of it from six. The shader applies the
 * same ramp per vertex with the cell size of the ring the vertex is in, so a coarse far ring does not alias; `cell` 0 draws every wave.
 */
export function waveFade(length: number, cell: number): number {
    if (cell <= 0) return 1;
    return Math.min(Math.max((length / cell - 3) / 3, 0), 1);
}

/** The surface's height above the body's rest plane at (x, z), `time` seconds in. */
export function waveHeight(p: WaveParams, x: number, z: number, time: number, cell = 0): number {
    let height = 0;
    const base = p.direction * Math.PI / 180;
    for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
        const length = p.length * lengthShare;
        const k = TAU / length;
        const a = base + heading * Math.PI / 180;
        const omega = Math.sqrt(GRAVITY * k) * p.speed * speedShare;
        const theta = k * (Math.sin(a) * x + Math.cos(a) * z) - omega * time;
        height += p.height * heightShare * Math.exp(Math.sin(theta) - 1) * waveFade(length, cell);
    }
    return height;
}

/** The slope of the surface at (x, z): how fast its height changes along x and along z. */
export function waveSlope(p: WaveParams, x: number, z: number, time: number): [number, number] {
    let sx = 0, sz = 0;
    const base = p.direction * Math.PI / 180;
    for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
        const k = TAU / (p.length * lengthShare);
        const a = base + heading * Math.PI / 180;
        const dx = Math.sin(a), dz = Math.cos(a);
        const omega = Math.sqrt(GRAVITY * k) * p.speed * speedShare;
        const theta = k * (dx * x + dz * z) - omega * time;
        const rise = p.height * heightShare * Math.exp(Math.sin(theta) - 1) * Math.cos(theta) * k;
        sx += dx * rise;
        sz += dz * rise;
    }
    return [sx, sz];
}
