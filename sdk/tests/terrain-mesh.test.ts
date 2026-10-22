// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { MeshChannel } from '../src/asset/meshFormat';
import { heightfieldFromPixels, proceduralHeightfield, sampleHeight, terrainNormal } from '../src/terrain/heightfield';
import { buildChunkMesh, cellsAtLod, chunkCenter, lodCount, type TerrainShape } from '../src/terrain/mesh';

const SHAPE: TerrainShape = { sizeX: 800, sizeZ: 400, height: 100, chunks: 4, chunkCells: 16 };
const paint = (): [number, number, number, number] => [1, 0, 0, 1];

function positionsOf(mesh: ReturnType<typeof buildChunkMesh>): number[][] {
    const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer);
    const out: number[][] = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
        const at = i * mesh.vertexStride + pos.offset;
        out.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
    }
    return out;
}

describe('heightfield', () => {
    it('reads a red channel as the height, and a green one as the low byte of a 16-bit height', () => {
        const flat = heightfieldFromPixels(2, 2, [0, 0, 0, 255, 255, 255, 255, 255, 128, 0, 0, 255, 0, 0, 0, 255]);
        expect(flat.data[0]).toBe(0);
        expect(flat.data[1]).toBe(1);
        expect(flat.data[2]).toBeCloseTo(128 / 255, 5);
        const wide = heightfieldFromPixels(2, 1, [1, 0, 0, 255, 1, 7, 0, 255]);
        expect(wide.data[1]!).toBeGreaterThan(wide.data[0]!);
        expect(wide.data[1]).toBeCloseTo(263 / 65535, 6);
    });

    it('makes the same ground from the same seed, different ground from another, spanning 0 to 1', () => {
        const params = { resolution: 33, seed: 7, frequency: 3, octaves: 4, persistence: 0.5, ridged: 0 };
        const a = proceduralHeightfield(params), b = proceduralHeightfield(params), c = proceduralHeightfield({ ...params, seed: 8 });
        expect([...a.data]).toEqual([...b.data]);
        expect([...a.data]).not.toEqual([...c.data]);
        expect(Math.min(...a.data)).toBeCloseTo(0, 6);
        expect(Math.max(...a.data)).toBeCloseTo(1, 6);
    });

    it('is bilinear between samples and clamps outside the field', () => {
        const f = heightfieldFromPixels(2, 2, [0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
        expect(sampleHeight(f, 0.5, 0.5)).toBeCloseTo(0.5, 5);
        expect(sampleHeight(f, -3, 0)).toBe(0);
        expect(sampleHeight(f, 4, 0)).toBe(1);
    });

    it('has an upward normal on level ground and one that leans away from a rise', () => {
        const level = heightfieldFromPixels(4, 4, new Array(64).fill(0));
        const n0 = terrainNormal(level, 0.5, 0.5, 100, 100, 50);
        expect(n0[0]).toBeCloseTo(0, 6);
        expect(n0[1]).toBeCloseTo(1, 6);
        // Heights climb with x: the ground faces back toward -x and up.
        const ramp = heightfieldFromPixels(4, 4, new Array(16).fill(0).flatMap((_, i) => [(i % 4) * 85, 0, 0, 255]));
        const n = terrainNormal(ramp, 0.5, 0.5, 100, 100, 50);
        expect(n[0]).toBeLessThan(-0.1);
        expect(n[1]).toBeGreaterThan(0);
        expect(Math.hypot(...n)).toBeCloseTo(1, 5);
    });
});

describe('terrain chunk mesh', () => {
    const field = proceduralHeightfield({ resolution: 65, seed: 3, frequency: 4, octaves: 4, persistence: 0.5, ridged: 0.3 });

    it('halves its grid at each level and keeps at least two cells', () => {
        expect([0, 1, 2, 3].map((l) => cellsAtLod(SHAPE, l))).toEqual([16, 8, 4, 2]);
        expect(lodCount(SHAPE, 4)).toBe(4);
        expect(lodCount({ ...SHAPE, chunkCells: 2 }, 4)).toBe(1);
    });

    it('has a surface of cells x cells x 2 triangles and a skirt of 8 x cells more', () => {
        for (const lod of [0, 1, 2, 3]) {
            const cells = cellsAtLod(SHAPE, lod);
            const mesh = buildChunkMesh(field, SHAPE, 1, 2, lod, paint);
            expect(mesh.indices.length / 3).toBe(cells * cells * 2 + cells * 8);
            expect(mesh.vertexCount).toBe((cells + 1) ** 2 + 4 * (cells + 1));
            for (const i of mesh.indices) expect(i).toBeLessThan(mesh.vertexCount);
        }
    });

    it('is centred on its own origin and spans one chunk', () => {
        const mesh = buildChunkMesh(field, SHAPE, 0, 0, 0, paint);
        expect(mesh.aabbMin[0]).toBeCloseTo(-100, 4);
        expect(mesh.aabbMax[0]).toBeCloseTo(100, 4);
        expect(mesh.aabbMin[2]).toBeCloseTo(-50, 4);
        expect(mesh.aabbMax[2]).toBeCloseTo(50, 4);
        expect(chunkCenter(SHAPE, 0, 0)).toEqual([-300, -150]);
        expect(chunkCenter(SHAPE, 3, 3)).toEqual([300, 150]);
    });

    it('faces its surface triangles up', () => {
        const mesh = buildChunkMesh(field, SHAPE, 2, 1, 0, paint);
        const p = positionsOf(mesh);
        const cells = cellsAtLod(SHAPE, 0);
        let up = 0;
        for (let t = 0; t < cells * cells * 2; t++) {
            const [a, b, c] = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
            const u = [p[b]![0]! - p[a]![0]!, p[b]![1]! - p[a]![1]!, p[b]![2]! - p[a]![2]!];
            const v = [p[c]![0]! - p[a]![0]!, p[c]![1]! - p[a]![1]!, p[c]![2]! - p[a]![2]!];
            if (u[2]! * v[0]! - u[0]! * v[2]! < 0) up++;
        }
        expect(up).toBe(0);
    });

    it('lets a skirt down below every edge so a coarser neighbour cannot show a crack', () => {
        const mesh = buildChunkMesh(field, SHAPE, 1, 1, 1, paint);
        const p = positionsOf(mesh);
        const cells = cellsAtLod(SHAPE, 1);
        const surface = (cells + 1) ** 2;
        for (let k = 0; k < 4 * (cells + 1); k++) {
            const drop = p[surface + k]!;
            const edge = p.slice(0, surface).find((q) => q[0] === drop[0] && q[2] === drop[2]);
            expect(edge).toBeDefined();
            expect(edge![1]! - drop[1]!).toBeGreaterThan(0);
        }
    });

    it('agrees with its neighbour on the height of the corners they share, at every level', () => {
        for (const lod of [0, 1, 2, 3]) {
            const left = positionsOf(buildChunkMesh(field, SHAPE, 1, 1, lod, paint));
            const right = positionsOf(buildChunkMesh(field, SHAPE, 2, 1, lod, paint));
            const cells = cellsAtLod(SHAPE, lod);
            const row = cells + 1;
            for (let j = 0; j <= cells; j++) expect(left[j * row + cells]![1]).toBeCloseTo(right[j * row]![1]!, 4);
        }
    });

    it('carries the paint in the vertex colour', () => {
        const mesh = buildChunkMesh(field, SHAPE, 0, 0, 3, () => [0, 0.5, 1, 1]);
        const color = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
        expect([...mesh.vertices.slice(color.offset, color.offset + 4)]).toEqual([0, 128, 255, 255]);
    });
});
