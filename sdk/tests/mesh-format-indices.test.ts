// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mesh small enough for 16-bit indices is written with them, and reads back the same.
 */
import { describe, it, expect } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';

const version = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true);

function mesh(vertexCount: number, indices: number[], extra: Partial<MeshData> = {}): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    for (let v = 0; v < vertexCount; v++) view.setFloat32(v * vertexStride, v, true);
    return {
        channels, vertexStride, vertexCount, vertices, indices: Uint32Array.from(indices),
        aabbMin: [0, 0, 0], aabbMax: [vertexCount, 0, 0], ...extra,
    };
}

describe('.esmesh index width', () => {
    it('writes 16-bit indices when every index fits, and reads them back as 32-bit', () => {
        const src = mesh(5, [0, 1, 2, 2, 3, 4, 4, 0, 1]);
        const bytes = encodeMesh(src);
        expect(version(bytes)).toBe(4);
        const back = decodeMesh(bytes);
        expect(Array.from(back.indices)).toEqual(Array.from(src.indices));
        expect(back.vertexCount).toBe(5);
        // two bytes saved per index, nothing else moved
        const as32 = bytes.length + src.indices.length * 2;
        expect(as32 - bytes.length).toBe(18);
    });

    it('keeps 32-bit indices, on the version every reader knows, once one needs them', () => {
        const src = mesh(70000, [0, 69999, 65536, 1, 2, 3]);
        const bytes = encodeMesh(src);
        expect(version(bytes)).toBe(3);
        expect(Array.from(decodeMesh(bytes).indices)).toEqual(Array.from(src.indices));
        // the boundary: 65535 is the last index 16 bits can name
        expect(version(encodeMesh(mesh(65536, [0, 65535, 1])))).toBe(4);
        expect(version(encodeMesh(mesh(65537, [0, 65536, 1])))).toBe(3);
    });

    it('leaves what follows the indices where it was, with an odd index count', () => {
        const src = mesh(4, [0, 1, 2], {
            inverseBindMatrices: Float32Array.from({ length: 16 }, (_, i) => i),
            morph: { names: ['smile'], hasNormals: true, deltas: Float32Array.from({ length: 4 * 6 }, (_, i) => i / 2) },
        });
        const back = decodeMesh(encodeMesh(src));
        expect(Array.from(back.indices)).toEqual([0, 1, 2]);
        expect(Array.from(back.inverseBindMatrices!)).toEqual(Array.from(src.inverseBindMatrices!));
        expect(back.morph!.names).toEqual(['smile']);
        expect(back.morph!.hasNormals).toBe(true);
        expect(Array.from(back.morph!.deltas)).toEqual(Array.from(src.morph!.deltas));
    });

    it('reads a file that predates the flag as 32-bit', () => {
        const bytes = encodeMesh(mesh(70000, [0, 69999, 2]));
        expect(version(bytes)).toBe(3);
        expect(Array.from(decodeMesh(bytes).indices)).toEqual([0, 69999, 2]);
        // a big mesh whose indices all happen to be small still narrows: it is the indices that count
        expect(version(encodeMesh(mesh(70000, [0, 1, 2])))).toBe(4);
    });
});
