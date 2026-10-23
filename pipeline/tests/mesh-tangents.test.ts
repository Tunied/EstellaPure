// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The tangent frame an import writes beside the normals.
 *
 * What it must be is geometry, so these are small meshes with a known answer rather than a render: a normal map read against
 * the wrong frame lights the wrong side of every bump, and nothing about that looks like a failure.
 */
import { describe, it, expect } from 'vitest';
import { generateTangents } from '../src/assets/meshTangents';

/** A unit square in the XY plane, facing +Z, two triangles. */
const quad = (uvOf: (x: number, y: number) => [number, number]) => {
    const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    return {
        positions: corners.flatMap(([x, y]) => [x, y, 0]),
        normals: corners.flatMap(() => [0, 0, 1]),
        uvs: corners.flatMap(([x, y]) => uvOf(x, y)),
        indices: [0, 1, 2, 0, 2, 3],
    };
};

const at = (t: Float32Array, i: number) => [...t.subarray(i * 4, i * 4 + 4)].map((v) => Math.round(v * 1e5) / 1e5);

describe('generated tangents', () => {
    it('point along the direction u grows, with a right-handed bitangent where v grows along cross(N, T)', () => {
        const m = quad((x, y) => [x, y]);
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices);
        for (let i = 0; i < 4; i++) expect(at(t, i)).toEqual([1, 0, 0, 1]);
    });

    it('flip the handedness when v grows the other way, as it does after the glTF importer flips v', () => {
        const m = quad((x, y) => [x, 1 - y]);
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices);
        for (let i = 0; i < 4; i++) expect(at(t, i)).toEqual([1, 0, 0, -1]);
    });

    it('follow a rotated unwrap: u growing along +Y gives a +Y tangent', () => {
        const m = quad((x, y) => [y, x]);
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices);
        // u = y, v = x: T = dP/du = +Y; cross(N, T) = (-1, 0, 0) while v grows along +X, so the handedness is -1.
        for (let i = 0; i < 4; i++) expect(at(t, i)).toEqual([0, 1, 0, -1]);
    });

    it("keep a supplied tangent's direction and still take the handedness from the geometry", () => {
        const m = quad((x, y) => [x, 1 - y]);
        const supplied = m.positions.map((_, k) => [1, 0, 0, 1][k % 4]!).slice(0, 16);
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices, supplied, 4);
        for (let i = 0; i < 4; i++) expect(at(t, i)).toEqual([1, 0, 0, -1]);
    });

    it('square a supplied tangent to the normal', () => {
        const m = quad((x, y) => [x, y]);
        const leaning = [1, 0, 0.5, 1, 1, 0, 0.5, 1, 1, 0, 0.5, 1, 1, 0, 0.5, 1];
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices, leaning, 4);
        for (let i = 0; i < 4; i++) expect(at(t, i)).toEqual([1, 0, 0, 1]);
    });

    it('stay a unit frame square to the normal where the UVs give no area to read', () => {
        const m = quad(() => [0.5, 0.5]);
        const t = generateTangents(m.positions, m.normals, m.uvs, m.indices);
        for (let i = 0; i < 4; i++) {
            const [x, y, z, w] = at(t, i) as [number, number, number, number];
            expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
            expect(z).toBeCloseTo(0, 5);
            expect(Math.abs(w)).toBe(1);
        }
    });
});
