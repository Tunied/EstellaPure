// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mesh.ts
 * @brief   One square of the ground, as geometry, at as many levels of detail as it is wanted at.
 *
 * @details The terrain is cut into chunks and each chunk is built several times over, a grid a half
 *          as fine at every level. The engine's own level-of-detail picks among them by how large
 *          the chunk is on screen, so a hill in the distance costs a few hundred triangles and one
 *          underfoot a couple of thousand.
 *
 *          Two neighbours at different levels have different numbers of vertices along the edge they
 *          share, so their surfaces part there — a crack the sky shows through. The cure is a skirt:
 *          a wall let down from each edge of the chunk, deep enough to hide the gap. It is cheap, it
 *          needs no knowledge of the neighbour (a chunk is built alone, and may change level without
 *          rebuilding anyone else), and it costs a ring of triangles that is never seen from above.
 *
 *          Heights and normals are read from the one field at every level, so a chunk keeps its
 *          lighting as it coarsens; only its silhouette changes.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { sampleHeight, terrainNormal, type Heightfield } from './heightfield';

/** The size and cut of a terrain. */
export interface TerrainShape {
    /** World extent along x and z. The terrain is centred on its entity. */
    sizeX: number;
    sizeZ: number;
    /** World height of a field value of 1. */
    height: number;
    /** Chunks along each side. */
    chunks: number;
    /** Cells along a chunk's side at the finest level (a power of two reads best). */
    chunkCells: number;
}

/** What a vertex is painted: the weights of four layers, or the colour of a terrain that has no material. */
export type TerrainPaint = (
    u: number, v: number, height01: number, slope: number,
) => [number, number, number, number];

/** How many cells a chunk has a side at `lod`: half as many at each, never fewer than two. */
export function cellsAtLod(shape: TerrainShape, lod: number): number {
    return Math.max(2, shape.chunkCells >> lod);
}

/** How many levels of detail a chunk is worth having, from the finest down to one that is still two cells across. */
export function lodCount(shape: TerrainShape, wanted = 4): number {
    let levels = 1;
    while (levels < wanted && cellsAtLod(shape, levels) < cellsAtLod(shape, levels - 1)) levels++;
    return levels;
}

/** The centre of chunk (cx, cz) in the terrain's own space, which is centred on its origin. */
export function chunkCenter(shape: TerrainShape, cx: number, cz: number): [number, number] {
    const w = shape.sizeX / shape.chunks, d = shape.sizeZ / shape.chunks;
    return [-shape.sizeX / 2 + (cx + 0.5) * w, -shape.sizeZ / 2 + (cz + 0.5) * d];
}

/**
 * Chunk (cx, cz) at level `lod`. Positions are relative to {@link chunkCenter}, so the entity that draws it is
 * placed there and the mesh itself stays small and centred (which is what culling and sorting measure).
 */
export function buildChunkMesh(
    field: Heightfield, shape: TerrainShape, cx: number, cz: number, lod: number, paint: TerrainPaint,
): MeshData {
    const cells = cellsAtLod(shape, lod);
    const w = shape.sizeX / shape.chunks, d = shape.sizeZ / shape.chunks;
    const stepX = w / cells, stepZ = d / cells;
    const skirt = Math.max(stepX, stepZ) * 1.5 + shape.height * 0.02;
    const row = cells + 1;

    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const addVertex = (i: number, j: number, drop: number): number => {
        // The vertex's place in the whole terrain, 0 to 1.
        const u = (cx * cells + i) / (shape.chunks * cells);
        const v = (cz * cells + j) / (shape.chunks * cells);
        const h = sampleHeight(field, u, v);
        const n = terrainNormal(field, u, v, shape.sizeX, shape.sizeZ, shape.height);
        positions.push(-w / 2 + i * stepX, h * shape.height - drop, -d / 2 + j * stepZ);
        uvs.push(u, v);
        normals.push(n[0], n[1], n[2]);
        const c = paint(u, v, h, n[1]);
        colors.push(c[0], c[1], c[2], c[3]);
        return positions.length / 3 - 1;
    };

    for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) addVertex(i, j, 0);
    const at = (i: number, j: number): number => j * row + i;
    for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
            // Up is the way the face looks: a, then the next row, then the next column, runs counter-clockwise from above.
            indices.push(at(i, j), at(i, j + 1), at(i + 1, j));
            indices.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
        }
    }

    // The skirt: a second row of vertices under each edge one, wound to face outward.
    const wall = (edge: number[], flip: boolean): void => {
        const below = edge.map((v) => {
            const i = v % row, j = Math.floor(v / row);
            return addVertex(i, j, skirt);
        });
        for (let k = 0; k < edge.length - 1; k++) {
            const a = edge[k]!, b = edge[k + 1]!, c = below[k]!, e = below[k + 1]!;
            if (flip) { indices.push(a, c, b); indices.push(b, c, e); }
            else { indices.push(a, b, c); indices.push(b, e, c); }
        }
    };
    const north: number[] = [], south: number[] = [], west: number[] = [], east: number[] = [];
    for (let i = 0; i <= cells; i++) { north.push(at(i, 0)); south.push(at(i, cells)); }
    for (let j = 0; j <= cells; j++) { west.push(at(0, j)); east.push(at(cells, j)); }
    wall(north, false);
    wall(south, true);
    wall(west, true);
    wall(east, false);

    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = positions.length / 3;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const posAt = channels[0]!.offset, uvAt = channels[1]!.offset, colorAt = channels[2]!.offset, normalAt = channels[3]!.offset;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
        const base = i * vertexStride;
        for (let k = 0; k < 3; k++) {
            const value = positions[i * 3 + k]!;
            view.setFloat32(base + posAt + k * 4, value, true);
            view.setFloat32(base + normalAt + k * 4, normals[i * 3 + k]!, true);
            if (value < min[k]!) min[k] = value;
            if (value > max[k]!) max[k] = value;
        }
        view.setFloat32(base + uvAt, uvs[i * 2]!, true);
        view.setFloat32(base + uvAt + 4, uvs[i * 2 + 1]!, true);
        for (let k = 0; k < 4; k++) {
            view.setUint8(base + colorAt + k, Math.round(Math.min(Math.max(colors[i * 4 + k]!, 0), 1) * 255));
        }
    }
    return { channels, vertexStride, vertexCount, vertices, indices: new Uint32Array(indices), aabbMin: min, aabbMax: max };
}
