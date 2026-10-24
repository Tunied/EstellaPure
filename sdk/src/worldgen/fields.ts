// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fields.ts
 * @brief   The environment a world is laid out by: numbers read anywhere in it, the same for the same seed on every machine.
 *
 * @details A field is a function of the world position. The ground's (`height`, `up`, `slope`) and the water's (`waterDepth`) are
 *          read from the terrain and the water; `moisture`, `temperature` and `rock` are seeded noise, slow across the world; a game
 *          adds fields of its own. A zone may set a field over its area, blended in by its weight, so a designer can make a wet hollow
 *          or a dry clearing by hand. Nothing here depends on what is loaded or in what order it was asked.
 */
import { noised } from '../terrain/source';

/** The fields at one place, by name. `height` is NaN where there is no ground. */
export type FieldValues = Record<string, number>;

/** A field of the game's own: a number at (x, z), read after the built-in ones (which it may read from `at`). */
export type FieldFn = (x: number, z: number, at: Readonly<FieldValues>) => number;

/** A seeded noise field: `scale` world units to a feature, `octaves` layers of detail. */
export interface NoiseField { scale: number; octaves?: number }

/** Where the environment comes from. */
export interface EnvironmentInputs {
    seed: number;
    /** The ground's height, how much it faces up and (if known) its normal at (x, z), or null where there is none. */
    ground(x: number, z: number): { y: number; up: number; normal?: [number, number, number] } | null;
    /** How deep water stands over the world height `y` at (x, z): above zero under water, null where there is none. */
    waterDepth?(x: number, z: number, y: number): number | null;
    /** The noise fields; absent ones keep their defaults (moisture 900, temperature 2400, rock 500 world units). */
    noise?: Partial<Record<string, NoiseField>>;
    /** Fields of the game's own. */
    fields?: Record<string, FieldFn>;
    /** Fields set by hand over an area: the value, and how much of it holds at (x, z) (0 to 1). */
    overrides?(x: number, z: number): { field: string; value: number; weight: number }[];
}

const DEFAULT_NOISE: Record<string, NoiseField> = {
    moisture: { scale: 900, octaves: 4 },
    temperature: { scale: 2400, octaves: 3 },
    rock: { scale: 500, octaves: 4 },
};

/** A stable 32-bit hash of integers, as a number in [0, 1). */
export function hash01(...v: number[]): number {
    let h = 0x9e3779b9 | 0;
    for (const n of v) {
        h = Math.imul(h ^ (n | 0), 0x85ebca6b);
        h = (h ^ (h >>> 13)) | 0;
        h = Math.imul(h, 0xc2b2ae35);
        h = (h ^ (h >>> 16)) | 0;
    }
    return (h >>> 0) / 4294967296;
}

/** A stable hash of a string, for mixing a name into a seed. */
export function hashString(s: string): number {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h | 0;
}

/** Fractal value noise, 0 to 1. */
export function fbm(x: number, z: number, seed: number, octaves: number): number {
    let sum = 0, norm = 0, amp = 1, freq = 1;
    for (let o = 0; o < octaves; o++) {
        sum += noised(x * freq, z * freq, seed + o * 131)[0] * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

/** Samples the environment. */
export class Environment {
    private readonly noise_: Record<string, NoiseField>;
    private readonly seeds_: Record<string, number> = {};

    constructor(readonly inputs: EnvironmentInputs) {
        this.noise_ = { ...DEFAULT_NOISE };
        for (const [name, f] of Object.entries(inputs.noise ?? {})) if (f) this.noise_[name] = f;
        for (const name of Object.keys(this.noise_)) this.seeds_[name] = (inputs.seed * 7919) ^ hashString(name);
    }

    /** Every field at (x, z). */
    sample(x: number, z: number): FieldValues {
        const g = this.inputs.ground(x, z);
        const at: FieldValues = {
            height: g ? g.y : NaN,
            up: g ? g.up : 1,
            slope: g ? 1 - g.up : 0,
            waterDepth: g && this.inputs.waterDepth ? this.inputs.waterDepth(x, z, g.y) ?? -Infinity : -Infinity,
        };
        for (const [name, f] of Object.entries(this.noise_)) {
            at[name] = fbm(x / Math.max(f.scale, 1e-6), z / Math.max(f.scale, 1e-6), this.seeds_[name]!, Math.max(1, f.octaves ?? 3));
        }
        for (const [name, f] of Object.entries(this.inputs.fields ?? {})) at[name] = f(x, z, at);
        for (const o of this.inputs.overrides?.(x, z) ?? []) {
            const base = at[o.field] ?? o.value;
            at[o.field] = base + (o.value - base) * Math.min(Math.max(o.weight, 0), 1);
        }
        return at;
    }
}
