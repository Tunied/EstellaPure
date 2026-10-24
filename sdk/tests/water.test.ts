// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WAVE_SET, waveFade, waveHeight, waveSlope, type WaveParams } from '../src/water/waves';
import { buildOceanMesh, oceanReach, oceanSnap } from '../src/water/waterMesh';
import { MeshChannel } from '../src/asset/meshFormat';
import type { MeshData } from '../src/asset/meshFormat';

const params: WaveParams = { height: 0.8, length: 14, speed: 1, direction: 30 };

function positions(mesh: MeshData): Float32Array {
    const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const out = new Float32Array(mesh.vertexCount * 3);
    for (let i = 0; i < mesh.vertexCount; i++) {
        for (let k = 0; k < 3; k++) out[i * 3 + k] = view.getFloat32(i * mesh.vertexStride + channel.offset + k * 4, true);
    }
    return out;
}

function colorRed(mesh: MeshData, i: number): number {
    const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
    return mesh.vertices[i * mesh.vertexStride + channel.offset]! / 255;
}

/** Twice the signed area of a triangle on the xz plane, and the sign of its normal's y: positive faces up. */
function facing(p: Float32Array, a: number, b: number, c: number): number {
    const ux = p[b * 3]! - p[a * 3]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    return uz * vx - ux * vz;
}

describe('the waves', () => {
    it('is the sum of the set\'s four peaked sines', () => {
        const x = 3.7, z = -2.2, t = 1.3;
        let expected = 0;
        for (const [heading, lengthShare, heightShare, speedShare] of WAVE_SET) {
            const k = 2 * Math.PI / (params.length * lengthShare);
            const a = (params.direction + heading) * Math.PI / 180;
            const theta = k * (Math.sin(a) * x + Math.cos(a) * z) - Math.sqrt(9.8 * k) * params.speed * speedShare * t;
            expected += params.height * heightShare * Math.exp(Math.sin(theta) - 1);
        }
        expect(waveHeight(params, x, z, t)).toBeCloseTo(expected, 10);
    });

    it('has a slope that is the derivative of its height', () => {
        const e = 1e-4;
        for (const [x, z, t] of [[0, 0, 0], [5.5, -3.1, 2.4], [-12, 9, 7.7]] as const) {
            const [sx, sz] = waveSlope(params, x, z, t);
            expect(sx).toBeCloseTo((waveHeight(params, x + e, z, t) - waveHeight(params, x - e, z, t)) / (2 * e), 4);
            expect(sz).toBeCloseTo((waveHeight(params, x, z + e, t) - waveHeight(params, x, z - e, t)) / (2 * e), 4);
        }
    });

    it('moves with time and is calm without height', () => {
        expect(waveHeight(params, 1, 1, 0)).not.toBeCloseTo(waveHeight(params, 1, 1, 3), 3);
        expect(waveHeight({ ...params, height: 0 }, 1, 1, 5)).toBe(0);
    });

    it('leaves out the waves a coarse cell cannot draw', () => {
        expect(waveFade(14, 0)).toBe(1);
        expect(waveFade(14, 1)).toBe(1);
        expect(waveFade(14, 14 / 3)).toBe(0);
        expect(waveFade(14, 14 / 4.5)).toBeCloseTo(0.5, 10);
        const fine = waveHeight(params, 2, 3, 1, 0);
        const coarse = waveHeight(params, 2, 3, 1, 8);
        expect(coarse).not.toBeCloseTo(fine, 3);
    });
});

describe('the surface\'s mesh', () => {
    const cells = 16, rings = 4, cell = 1;
    const mesh = buildOceanMesh(cells, rings, cell);
    const p = positions(mesh);

    it('reaches as far as it says and tiles its square exactly once', () => {
        const reach = oceanReach(cells, rings, cell);
        expect(reach).toBe(64);
        expect(mesh.aabbMax[0]).toBe(reach);
        let area = 0;
        for (let t = 0; t < mesh.indices.length; t += 3) {
            const f = facing(p, mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!);
            expect(f).toBeGreaterThan(0);
            area += f / 2;
        }
        expect(area).toBeCloseTo((2 * reach) ** 2, 3);
    });

    it('marks each vertex with its ring, which the shader turns into a cell size', () => {
        const reds = new Set<number>();
        for (let i = 0; i < mesh.vertexCount; i++) reds.add(Math.round(colorRed(mesh, i) * 7));
        expect([...reds].sort()).toEqual([0, 1, 2, 3]);
    });

    it('snaps to the lattice its coarsest ring lines up on', () => {
        expect(oceanSnap(rings, cell)).toBe(8);
    });
});
