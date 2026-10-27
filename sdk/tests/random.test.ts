// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { createRng, hashSeed } from '../src/math/random';

describe('createRng', () => {
    it('replays the same sequence for the same seed', () => {
        const a = createRng('ember');
        const b = createRng('ember');
        for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
    });

    it('differs across seeds, and a list seed is not its parts concatenated', () => {
        expect(createRng('a').nextU32()).not.toBe(createRng('b').nextU32());
        expect(hashSeed(['ab', 'c'])).not.toBe(hashSeed(['a', 'bc']));
        expect(hashSeed([1, 2])).not.toBe(hashSeed([2, 1]));
        expect(hashSeed(1)).not.toBe(hashSeed('1'));
    });

    it('pins the first draws so a host that disagrees is caught', () => {
        const r = createRng('estella');
        expect([r.nextU32(), r.nextU32(), r.nextU32()]).toEqual(PINNED_U32);
        expect(createRng(['day', 7, 'weather']).int(0, 999)).toBe(PINNED_INT);
    });

    it('float stays in [0, 1) and covers the range', () => {
        const r = createRng(1);
        let lo = 1, hi = 0;
        for (let i = 0; i < 5000; i++) {
            const f = r.float();
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThan(1);
            lo = Math.min(lo, f);
            hi = Math.max(hi, f);
        }
        expect(lo).toBeLessThan(0.01);
        expect(hi).toBeGreaterThan(0.99);
    });

    it('int is inclusive on both ends and roughly uniform', () => {
        const r = createRng('dice');
        const seen = new Array<number>(6).fill(0);
        for (let i = 0; i < 6000; i++) seen[r.int(1, 6) - 1]!++;
        for (const n of seen) {
            expect(n).toBeGreaterThan(800);
            expect(n).toBeLessThan(1200);
        }
        expect(r.int(5, 5)).toBe(5);
        expect(() => r.int(3, 2)).toThrow(RangeError);
        expect(() => r.int(0.5, 2)).toThrow(RangeError);
    });

    it('weighted never picks a zero weight and follows the odds', () => {
        const r = createRng('loot');
        const items = [{ n: 'common', w: 9 }, { n: 'rare', w: 1 }, { n: 'never', w: 0 }];
        const tally: Record<string, number> = { common: 0, rare: 0, never: 0 };
        for (let i = 0; i < 10000; i++) tally[r.weighted(items, (x) => x.w).n]!++;
        expect(tally.never).toBe(0);
        expect(tally.rare).toBeGreaterThan(800);
        expect(tally.rare).toBeLessThan(1200);
        expect(() => r.weighted([], () => 1)).toThrow(RangeError);
        expect(() => r.weighted([1], () => 0)).toThrow(RangeError);
        expect(() => r.weighted([1], () => -1)).toThrow(RangeError);
    });

    it('shuffle is a permutation and leaves its input alone', () => {
        const input = [1, 2, 3, 4, 5, 6, 7, 8];
        const out = createRng(9).shuffle(input);
        expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([...out].sort((a, b) => a - b)).toEqual(input);
        expect(out).not.toEqual(input);
    });

    it('fork depends on the label, not on how much the parent has drawn', () => {
        const fresh = createRng('world');
        const used = createRng('world');
        for (let i = 0; i < 50; i++) used.nextU32();
        expect(used.fork('market').nextU32()).toBe(fresh.fork('market').nextU32());
        expect(fresh.fork('market').nextU32()).not.toBe(fresh.fork('weather').nextU32());
    });

    it('rejects a seed that cannot be hashed the same everywhere', () => {
        expect(() => createRng(Number.NaN)).toThrow(RangeError);
        expect(() => createRng(Infinity)).toThrow(RangeError);
    });
});

// Filled from the first run; they must never change, on any host.
const PINNED_U32: number[] = [3413397541, 2088129782, 4134660848];
const PINNED_INT = 708;
