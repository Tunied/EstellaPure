// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { SplineCurve, type SplinePoint } from '../src/spline/curve';
import { buildRiverMesh, currentShare } from '../src/water/riverMesh';
import { MeshChannel } from '../src/asset/meshFormat';

const pt = (x: number, y: number, z: number, width = 1): SplinePoint => ({ x, y, z, width });

describe('SplineCurve', () => {
    it('is as long as the line between two points, and runs along it', () => {
        const c = new SplineCurve([pt(0, 0, 0, 2), pt(10, 0, 0, 6)]);
        expect(c.length).toBeCloseTo(10, 6);
        expect(c.position(0)).toEqual([0, 0, 0]);
        expect(c.position(5)[0]).toBeCloseTo(5, 6);
        expect(c.position(100)[0]).toBeCloseTo(10, 6);
        expect(c.position(-5)[0]).toBeCloseTo(0, 6);
        expect(c.tangent(5)[0]).toBeCloseTo(1, 6);
    });

    it('eases a width from one point\'s to the next\'s', () => {
        const c = new SplineCurve([pt(0, 0, 0, 2), pt(10, 0, 0, 6)]);
        expect(c.width(0)).toBeCloseTo(2, 6);
        expect(c.width(10)).toBeCloseTo(6, 6);
        expect(c.width(5)).toBeCloseTo(4, 2);
        expect(c.width(2.5)).toBeLessThan(3);
    });

    it('passes through every point it was given', () => {
        const points = [pt(0, 0, 0), pt(10, 0, 4), pt(20, 2, -3), pt(30, 3, 5)];
        const c = new SplineCurve(points);
        for (const p of points) expect(c.nearest(p.x, p.z).distance).toBeLessThan(0.05);
    });

    it('measures by the distance along it, not by the points', () => {
        // Points on a wide circle, bunched at one end and far apart at the other: equal steps along the curve are equal steps in space.
        const on = (deg: number): SplinePoint => pt(60 * Math.cos((deg * Math.PI) / 180), 0, 60 * Math.sin((deg * Math.PI) / 180));
        const c = new SplineCurve([on(0), on(6), on(12), on(70), on(160)]);
        const steps: number[] = [];
        for (let s = 0; s < c.length - 1; s += 1) {
            const a = c.position(s), b = c.position(s + 1);
            steps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        }
        expect(Math.min(...steps)).toBeGreaterThan(0.97);
        expect(Math.max(...steps)).toBeLessThan(1.0001);
    });

    it('goes round when it is closed', () => {
        const c = new SplineCurve([pt(0, 0, 0), pt(10, 0, 0), pt(10, 0, 10), pt(0, 0, 10)], true);
        const a = c.position(7), b = c.position(7 + c.length);
        expect(b[0]).toBeCloseTo(a[0], 6);
        expect(b[2]).toBeCloseTo(a[2], 6);
        // The piece back from the last point to the first is part of it.
        expect(c.length).toBeGreaterThan(40);
        expect(c.nearest(-0.0, 5).distance).toBeLessThan(3);
    });

    it('finds the nearest place on it, and says which side', () => {
        const c = new SplineCurve([pt(0, 0, 0), pt(20, 0, 0)]);
        const left = c.nearest(7, 2), right = c.nearest(7, -2);
        expect(left.s).toBeCloseTo(7, 4);
        expect(left.distance).toBeCloseTo(2, 6);
        expect(right.s).toBeCloseTo(7, 4);
        expect(right.distance).toBeCloseTo(2, 6);
        expect(left.side).toBe(-right.side);
        expect(left.side).not.toBe(0);
    });

    it('survives a point, or none', () => {
        expect(new SplineCurve([pt(3, 4, 5)]).position(2)).toEqual([3, 4, 5]);
        expect(new SplineCurve([]).length).toBe(0);
        expect(new SplineCurve([]).position(1)).toEqual([0, 0, 0]);
    });
});

function positions(mesh: { channels: { semantic: number; offset: number }[]; vertexStride: number; vertexCount: number; vertices: Uint8Array }): Float32Array {
    const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const out = new Float32Array(mesh.vertexCount * 3);
    for (let i = 0; i < mesh.vertexCount; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = view.getFloat32(i * mesh.vertexStride + channel.offset + k * 4, true);
    return out;
}

describe('a river\'s mesh', () => {
    // Along +x, widening from 2 to 6, falling a unit over its length.
    const curve = new SplineCurve([pt(0, 1, 0, 2), pt(20, 0, 0, 6)]);
    const mesh = buildRiverMesh(curve, 2, 4);
    const p = positions(mesh);

    it('faces up, whichever way it runs', () => {
        for (const c of [curve, new SplineCurve([pt(0, 0, 0, 3), pt(0, 0, 20, 3)]), new SplineCurve([pt(0, 0, 0, 3), pt(-12, 0, -9, 3)])]) {
            const m = buildRiverMesh(c, 2, 3);
            const q = positions(m);
            for (let t = 0; t < m.indices.length; t += 3) {
                const a = m.indices[t]!, b = m.indices[t + 1]!, d = m.indices[t + 2]!;
                const f = (q[b * 3 + 2]! - q[a * 3 + 2]!) * (q[d * 3]! - q[a * 3]!) - (q[b * 3]! - q[a * 3]!) * (q[d * 3 + 2]! - q[a * 3 + 2]!);
                expect(f).toBeGreaterThan(0);
            }
        }
    });

    it('is as wide as the curve at each station and lies at its height', () => {
        const stride = 5;
        const stations = mesh.vertexCount / stride;
        for (const i of [0, Math.floor(stations / 2), stations - 1]) {
            const s = (i / (stations - 1)) * curve.length;
            const first = i * stride, last = i * stride + 4;
            const width = Math.hypot(p[first * 3]! - p[last * 3]!, p[first * 3 + 2]! - p[last * 3 + 2]!);
            expect(width).toBeCloseTo(curve.width(s), 4);
            expect(p[first * 3 + 1]).toBeCloseTo(curve.position(s)[1], 4);
        }
    });

    it('carries the direction of the current in its colour, and a narrow reach runs faster than a wide one', () => {
        const colorAt = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!.offset;
        const rgb = (v: number): number[] => [0, 1, 2].map((k) => mesh.vertices[v * mesh.vertexStride + colorAt + k]! / 255);
        const first = rgb(0), last = rgb(mesh.vertexCount - 1);
        // Heading along +x: red high, green at rest.
        expect(first[0]).toBeGreaterThan(0.95);
        expect(first[1]).toBeCloseTo(0.5, 1);
        expect(first[2]).toBeGreaterThan(last[2]);
        expect(currentShare(2, 6)).toBe(1);
        expect(currentShare(6, 6)).toBe(0.5);
        expect(currentShare(60, 6)).toBe(0.125);
    });
});
