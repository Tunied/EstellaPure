// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    random.ts
 * @brief   A seeded random generator that gives the same numbers on every host.
 *          The generator is SFC32 over 32-bit integer arithmetic only, so a
 *          server, a browser, a mini-game and a phone running the same seed draw
 *          the same sequence — the property shared rules code needs when the
 *          server settles an outcome and the client previews it.
 */

/** A seed: one number, one string, or several of either joined into one. */
export type RngSeed = number | string | readonly (number | string)[];

export interface Rng {
    /** The next 32 bits as an unsigned integer. */
    nextU32(): number;
    /** A float in [0, 1). */
    float(): number;
    /** An integer in [min, max], both included, without modulo bias. */
    int(min: number, max: number): number;
    /** True with probability `p` (clamped to [0, 1]). */
    chance(p: number): boolean;
    /** One element of a non-empty list. */
    pick<T>(items: readonly T[]): T;
    /** One element chosen by weight; a weight of 0 never wins. */
    weighted<T>(items: readonly T[], weight: (item: T) => number): T;
    /** A shuffled copy; the input is left alone. */
    shuffle<T>(items: readonly T[]): T[];
    /**
     * An independent generator named `label`. It derives from the original seed
     * and the label alone, never from how much this one has drawn, so adding a
     * draw in one place does not move the numbers of another stream.
     */
    fork(label: string | number): Rng;
}

const SEED_WORDS = 4;
const WARMUP = 12;

function mix(h: number): number {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

function absorb(h: number, word: number): number {
    h = Math.imul(h ^ word, 0x9e3779b1);
    return ((h << 13) | (h >>> 19)) >>> 0;
}

/** A 32-bit hash of a seed, stable across hosts. */
export function hashSeed(seed: RngSeed): number {
    const parts = typeof seed === 'object' ? seed : [seed];
    let h = 0x811c9dc5;
    for (const part of parts) {
        if (typeof part === 'number') {
            if (!Number.isFinite(part)) throw new RangeError('[rng] a numeric seed must be finite');
            const whole = Math.floor(part);
            h = absorb(h, whole >>> 0);
            h = absorb(h, Math.floor(whole / 4294967296) >>> 0);
            h = absorb(h, 0x6e);
        } else {
            for (let i = 0; i < part.length; i++) h = absorb(h, part.charCodeAt(i));
            h = absorb(h, 0x73);
        }
    }
    return mix(h);
}

class Sfc32 implements Rng {
    private a: number;
    private b: number;
    private c: number;
    private d: number;

    constructor(private readonly root: number) {
        let h = root;
        const words: number[] = [];
        for (let i = 0; i < SEED_WORDS; i++) {
            h = mix(absorb(h, i + 1));
            words.push(h);
        }
        [this.a, this.b, this.c, this.d] = words as [number, number, number, number];
        for (let i = 0; i < WARMUP; i++) this.nextU32();
    }

    nextU32(): number {
        const t = (((this.a + this.b) | 0) + this.d) | 0;
        this.d = (this.d + 1) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.c = (this.c + t) | 0;
        return t >>> 0;
    }

    float(): number {
        return this.nextU32() / 4294967296;
    }

    int(min: number, max: number): number {
        if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
            throw new RangeError(`[rng] int(${min}, ${max}) needs integers with min <= max`);
        }
        const range = max - min + 1;
        if (range > 4294967296) throw new RangeError('[rng] int range exceeds 32 bits');
        if (range === 4294967296) return min + this.nextU32();
        const limit = 4294967296 - (4294967296 % range);
        let r = this.nextU32();
        while (r >= limit) r = this.nextU32();
        return min + (r % range);
    }

    chance(p: number): boolean {
        return this.float() < p;
    }

    pick<T>(items: readonly T[]): T {
        if (items.length === 0) throw new RangeError('[rng] pick() of an empty list');
        return items[this.int(0, items.length - 1)]!;
    }

    weighted<T>(items: readonly T[], weight: (item: T) => number): T {
        let total = 0;
        const weights = items.map((item) => {
            const w = weight(item);
            if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError('[rng] a weight must be a finite number >= 0');
            total += w;
            return w;
        });
        if (!(total > 0)) throw new RangeError('[rng] weighted() needs a positive total weight');
        let roll = this.float() * total;
        for (let i = 0; i < items.length; i++) {
            roll -= weights[i]!;
            if (roll < 0 && weights[i]! > 0) return items[i]!;
        }
        for (let i = items.length - 1; i >= 0; i--) if (weights[i]! > 0) return items[i]!;
        return items[0]!;
    }

    shuffle<T>(items: readonly T[]): T[] {
        const out = items.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            const t = out[i]!;
            out[i] = out[j]!;
            out[j] = t;
        }
        return out;
    }

    fork(label: string | number): Rng {
        return new Sfc32(hashSeed([this.root, label]));
    }
}

/** A generator that replays the same numbers for the same seed on every host. */
export function createRng(seed: RngSeed): Rng {
    return new Sfc32(hashSeed(seed));
}
