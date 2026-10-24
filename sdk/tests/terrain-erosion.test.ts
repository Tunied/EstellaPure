// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { erodeHeightfield, proceduralHeightfield, type Heightfield } from '../src/terrain/heightfield';

// A valley: two slopes falling toward a line down the middle along z, and the whole tilting down toward +z.
function valley(n: number): Heightfield {
    const data = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const across = Math.abs(i / (n - 1) - 0.5) * 2, along = 1 - j / (n - 1);
        data[j * n + i] = 0.15 + 0.6 * across + 0.25 * along;
    }
    return { width: n, height: n, data };
}
const worn = (field: Heightfield, amount = 1, seed = 3) => erodeHeightfield(field, { amount, seed, sizeX: 1000, sizeZ: 1000, height: 300 });

describe('erosion', () => {
    it('wears the same ground the same way from the same seed, and another way from another', () => {
        const a = worn(valley(65)), b = worn(valley(65)), c = worn(valley(65), 1, 4);
        expect(Array.from(a.field.data)).toEqual(Array.from(b.field.data));
        expect(Array.from(a.field.data)).not.toEqual(Array.from(c.field.data));
    });

    it('leaves the ground alone with no rain', () => {
        const field = valley(33);
        expect(Array.from(worn(field, 0).field.data)).toEqual(Array.from(field.data));
    });

    it('cuts the slopes and lays silt in the valley floor', () => {
        const n = 65, field = valley(n), out = worn(field, 2);
        let cut = 0, laid = 0;
        for (let j = 8; j < n - 8; j++) {
            const side = j * n + 12, floor = j * n + (n - 1) / 2;
            cut += field.data[side]! - out.field.data[side]!;
            laid += out.field.data[floor]! - field.data[floor]!;
        }
        expect(cut).toBeGreaterThan(0);
        expect(laid).toBeGreaterThan(0);
        for (const v of out.field.data) expect(v >= 0 && v <= 1).toBe(true);
    });

    it('keeps where the water ran: the valley floor more than the ridge', () => {
        const n = 65, out = worn(valley(n), 2);
        let floor = 0, ridge = 0;
        for (let j = 8; j < n - 8; j++) { floor += out.flow[j * n + (n - 1) / 2]!; ridge += out.flow[j * n + 1]!; }
        expect(floor).toBeGreaterThan(ridge * 2);
    });
});

describe('warped noise', () => {
    it('bends the ground it would have made, and still spans 0 to 1', () => {
        const base = { resolution: 65, seed: 2, frequency: 3, octaves: 4, persistence: 0.5, ridged: 0.3 };
        const plain = proceduralHeightfield(base), bent = proceduralHeightfield({ ...base, warp: 0.8 });
        expect(Array.from(bent.data)).not.toEqual(Array.from(plain.data));
        expect(Math.min(...bent.data)).toBeCloseTo(0, 6);
        expect(Math.max(...bent.data)).toBeCloseTo(1, 6);
        expect(Array.from(proceduralHeightfield({ ...base, warp: 0 }).data)).toEqual(Array.from(plain.data));
    });
});
