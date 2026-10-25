// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { buildPlacedMesh, buildPlacements, PLACEMENT_FLOATS, type Plant } from '../src/foliage/builder';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';

/** One triangle with a vertex off every axis, so a turn, a scale or a lean moves each of them. */
function triangle(): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(3 * vertexStride);
    const f = new Float32Array(vertices.buffer);
    [[1, 0.5, 0.25], [-0.5, 2, 1], [0.25, 1, -1.5]].forEach((p, v) => f.set([...p, 0, 1, 0], v * (vertexStride / 4)));
    return { channels, vertexStride, vertexCount: 3, vertices, indices: new Uint32Array([0, 1, 2]), aabbMin: [-0.5, 0.5, -1.5], aabbMax: [1, 2, 1] };
}

/** A placement's three rows applied to a point, as the engine applies them to the mesh's vertices. */
const apply = (rows: Float32Array, at: number, p: number[]): number[] =>
    [0, 1, 2].map((r) => rows[at + r * 4]! * p[0]! + rows[at + r * 4 + 1]! * p[1]! + rows[at + r * 4 + 2]! * p[2]! + rows[at + r * 4 + 3]!);

describe('plant placements', () => {
    const plants: Plant[] = [
        { x: 3, y: 1, z: -2, yaw: 0.7, scale: 1.4, phase: 0, shade: 1 },
        { x: -5, y: 0.5, z: 4, yaw: 3.1, scale: 0.6, phase: 0, shade: 1, up: [0.3, 0.9, 0.1] },
    ];

    it('place a mesh where merging its copies would have put the vertices', () => {
        const source = triangle();
        const merged = buildPlacedMesh(source, plants);
        const rows = buildPlacements(plants);
        const world = new Float32Array(merged.vertices.buffer);
        const words = merged.vertexStride / 4;
        plants.forEach((_, n) => {
            for (let v = 0; v < 3; v++) {
                const local = Array.from(new Float32Array(source.vertices.buffer).subarray(v * words, v * words + 3));
                const placed = apply(rows, n * PLACEMENT_FLOATS, local);
                const baked = Array.from(world.subarray((n * 3 + v) * words, (n * 3 + v) * words + 3));
                placed.forEach((c, i) => expect(c).toBeCloseTo(baked[i]!, 4));
            }
        });
    });

    it('take sixteen numbers a plant, tinted white', () => {
        const rows = buildPlacements(plants);
        expect(rows.length).toBe(plants.length * PLACEMENT_FLOATS);
        expect(Array.from(rows.subarray(12, 16))).toEqual([1, 1, 1, 1]);
        expect(rows[3]).toBe(3);
        expect(rows[7]).toBe(1);
        expect(rows[11]).toBe(-2);
    });
});
