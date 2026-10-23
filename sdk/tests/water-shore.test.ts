// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { ShoreField, polygonSdf, shoreDamp, type Point2 } from '../src/water/shore';
import { buildBoxMesh } from '../src/water/waterMesh';
import { MeshChannel } from '../src/asset/meshFormat';

const square: Point2[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
// An L: a 20 x 20 square with its upper-right quarter (x > 0, z > 0) taken out.
const ell: Point2[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 10 }];

describe('polygonSdf', () => {
    it('is the distance to the nearest edge, positive inside and negative outside', () => {
        expect(polygonSdf(square, 0, 0)).toBeCloseTo(10, 10);
        expect(polygonSdf(square, 7, 0)).toBeCloseTo(3, 10);
        expect(polygonSdf(square, 13, 0)).toBeCloseTo(-3, 10);
        expect(polygonSdf(square, 13, 14)).toBeCloseTo(-Math.hypot(3, 4), 10);
    });

    it('knows the notch of a concave outline is outside', () => {
        expect(polygonSdf(ell, -5, -5)).toBeGreaterThan(0);
        expect(polygonSdf(ell, 5, -5)).toBeGreaterThan(0);
        expect(polygonSdf(ell, -5, 5)).toBeGreaterThan(0);
        expect(polygonSdf(ell, 5, 5)).toBeLessThan(0);
        // In the notch, the nearest edge is the one that bounds it.
        expect(polygonSdf(ell, 5, 5)).toBeCloseTo(-5, 10);
    });
});

describe('shoreDamp', () => {
    it('keeps none of the waves at the edge and all of them from a shore width in', () => {
        expect(shoreDamp(0, 4)).toBe(0);
        expect(shoreDamp(-1, 4)).toBe(0);
        expect(shoreDamp(4, 4)).toBe(1);
        expect(shoreDamp(40, 4)).toBe(1);
        expect(shoreDamp(2, 4)).toBeCloseTo(0.5, 10);
    });

    it('leaves the waves whole with no shore width', () => {
        expect(shoreDamp(0.01, 0)).toBe(1);
        expect(shoreDamp(0, 0)).toBe(1);
    });
});

describe('ShoreField', () => {
    it('answers the outline and the damping from its grid', () => {
        const field = new ShoreField(square, 65, 4);
        expect(field.inside(0, 0)).toBe(true);
        expect(field.inside(15, 0)).toBe(false);
        expect(field.distance(0, 0)).toBeCloseTo(10, 1);
        expect(field.damp(0, 0)).toBe(1);
        expect(field.damp(9, 0)).toBeLessThan(0.5);
        expect(field.damp(10.5, 0)).toBe(0);
    });

    it('takes the water\'s depth from the ground under it, and calms the waves where it is shallow', () => {
        // Ground rising from 8 under the water at x = -10 to the surface at x = 10.
        const ground = (x: number): number => -8 + ((x + 10) / 20) * 8;
        const field = new ShoreField(square, 65, 4, (x) => ground(x));
        expect(field.waterDepth(-10, 0)).toBeCloseTo(8, 1);
        expect(field.waterDepth(10, 0)).toBeCloseTo(0, 1);
        expect(field.damp(-5, 0)).toBe(1);
        // At x = 6 the water is 3.2 deep but the edge is 4 away: depth is the nearer limit.
        expect(field.damp(6, 0)).toBeCloseTo(shoreDamp(Math.min(4, 8 - ((6 + 10) / 20) * 8), 4), 1);
        expect(field.damp(9.5, 0)).toBeLessThan(0.1);
    });

    it('is as deep as it likes where nothing is known of the ground', () => {
        const field = new ShoreField(square, 33, 4);
        expect(field.waterDepth(0, 0)).toBeGreaterThan(1e6);
    });

    it('encodes distance, depth and damping for the shader', () => {
        const field = new ShoreField(square, 33, 4, () => -2);
        const range = 16;
        const px = field.encode(range);
        const at = (i: number, j: number): number[] => Array.from(px.subarray((j * 33 + i) * 4, (j * 33 + i) * 4 + 4));
        const centre = at(16, 16);
        // Ten from the edge: 0.5 + 10 / 32 of the way up; two deep: 2 / 16; the waves whole.
        expect(centre[0]).toBeCloseTo(Math.round((0.5 + 10 / 32) * 255), 0);
        expect(centre[1]).toBeCloseTo(Math.round((2 / 16) * 255), 0);
        expect(centre[2]).toBeGreaterThan(0);
        expect(centre[3]).toBe(255);
        // A corner is on the edge: half way, and no waves.
        const corner = at(0, 0);
        expect(corner[0]).toBeCloseTo(128, 0);
        expect(corner[2]).toBe(0);
    });
});

describe('a lake mesh with a shore', () => {
    it('writes the damping into each vertex and leaves out the cells wholly outside the outline', () => {
        const field = new ShoreField(ell, 65, 4);
        const mesh = buildBoxMesh(field.minX, field.minZ, field.minX + field.sizeX, field.minZ + field.sizeZ, 1, {
            damp: (x, z) => field.damp(x, z),
            keep: (x, z, cell) => field.distance(x, z) > -cell,
        });
        const full = buildBoxMesh(field.minX, field.minZ, field.minX + field.sizeX, field.minZ + field.sizeZ, 1);
        expect(mesh.indices.length).toBeLessThan(full.indices.length);
        // The far corner of the notch has no cell left in it.
        const channel = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
        const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
        for (let t = 0; t < mesh.indices.length; t += 3) {
            let sx = 0, sz = 0;
            for (let k = 0; k < 3; k++) {
                const v = mesh.indices[t + k]!;
                sx += view.getFloat32(v * mesh.vertexStride + channel.offset, true) / 3;
                sz += view.getFloat32(v * mesh.vertexStride + channel.offset + 8, true) / 3;
            }
            expect(field.distance(sx, sz)).toBeGreaterThan(-2);
        }
        const color = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
        const greens = new Set<number>();
        for (let i = 0; i < mesh.vertexCount; i++) greens.add(mesh.vertices[i * mesh.vertexStride + color.offset + 1]!);
        expect(greens.size).toBeGreaterThan(3);
        expect(Math.max(...greens)).toBe(255);
    });
});
