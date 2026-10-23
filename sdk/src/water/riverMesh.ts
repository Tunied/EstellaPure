// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    riverMesh.ts
 * @brief   The geometry of a river: a ribbon laid along a curve, as wide as the curve says at every point.
 *
 * @details Stations are cut along the curve a `step` apart and each is a row of vertices across the width, from one bank to the other, in the
 *          body's own space with the height of the curve under them (a river runs downhill). The uv is the position, as for a lake, so the Water
 *          shader's body space is the same. The vertex colour carries the current: red and green the direction of travel on the xz plane (0.5
 *          is none), blue how fast the water runs there against its nominal speed, half being the nominal: a narrow reach is quick and a wide one slow,
 *          which is what the same water through a different width does.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import type { SplineCurve } from '../spline/curve';

/** What the current is at a station: the speed against the nominal one, for a reach this wide against the curve's widest. */
export function currentShare(width: number, widest: number): number {
    return Math.min(Math.max(widest / Math.max(width, 1e-3), 0.25), 2) / 2;
}

/** A river along `curve`, a station every `step` along it and `across` cells from bank to bank. */
export function buildRiverMesh(curve: SplineCurve, step: number, across: number): MeshData {
    const stations = Math.max(2, Math.ceil(curve.length / Math.max(step, 1e-3)) + 1);
    const cells = Math.max(1, Math.floor(across));
    let widest = 0;
    for (let i = 0; i < stations; i++) widest = Math.max(widest, curve.width((i / (stations - 1)) * curve.length));
    const positions: number[] = [], colors: number[] = [];
    for (let i = 0; i < stations; i++) {
        const s = (i / (stations - 1)) * curve.length;
        const [cx, cy, cz] = curve.position(s);
        const [tx, , tz] = curve.tangent(s);
        const along = Math.hypot(tx, tz) || 1;
        const dx = tx / along, dz = tz / along;
        // The bank to the right of the heading (looking along it from above, +x right, +z toward the viewer): the perpendicular (-dz, dx).
        const nx = -dz, nz = dx;
        const half = curve.width(s) / 2;
        const share = currentShare(half * 2, widest);
        for (let k = 0; k <= cells; k++) {
            const v = (k / cells) * 2 - 1;
            positions.push(cx + nx * v * half, cy, cz + nz * v * half);
            colors.push(dx * 0.5 + 0.5, dz * 0.5 + 0.5, share, 1);
        }
    }
    const stride = cells + 1;
    const indices: number[] = [];
    for (let i = 0; i < stations - 1; i++) {
        for (let k = 0; k < cells; k++) {
            const a = i * stride + k, b = i * stride + k + 1, c = (i + 1) * stride + k, d = (i + 1) * stride + k + 1;
            // Facing up for a heading along +x with the right bank toward +z: (a, b, c) turns the way the lake's cells do.
            indices.push(a, b, c, c, b, d);
        }
    }
    return pack(positions, colors, indices);
}

function pack(positions: number[], colors: number[], indices: number[]): MeshData {
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
            if (value < min[k]!) min[k] = value;
            if (value > max[k]!) max[k] = value;
        }
        view.setFloat32(base + normalAt, 0, true);
        view.setFloat32(base + normalAt + 4, 1, true);
        view.setFloat32(base + normalAt + 8, 0, true);
        view.setFloat32(base + uvAt, positions[i * 3]!, true);
        view.setFloat32(base + uvAt + 4, positions[i * 3 + 2]!, true);
        for (let k = 0; k < 4; k++) view.setUint8(base + colorAt + k, Math.round(Math.min(Math.max(colors[i * 4 + k]!, 0), 1) * 255));
    }
    return { channels, vertexStride, vertexCount, vertices, indices: new Uint32Array(indices), aabbMin: min, aabbMax: max };
}
