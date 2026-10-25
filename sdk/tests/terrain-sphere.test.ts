// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    FACES, direction, faceOf, levelsFor, nodeAt, nodeBound, nodePoint, nodeRect, selectSphereNodes, sphereNodeKey, type SphereNode, type SphereTreeParams,
} from '../src/terrain/sphere';

const planet: SphereTreeParams = { radius: 4000, minHeight: -30, maxHeight: 200, leafSize: 48, range0: 180 };
const levels = levelsFor(planet.radius, planet.leafSize);

/** A reproducible stream of directions all over the sphere. */
function* directions(count: number): Generator<[number, number, number]> {
    let a = 12345;
    const next = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
    for (let i = 0; i < count; i++) {
        const z = next() * 2 - 1, t = next() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        yield [r * Math.cos(t), r * Math.sin(t), z];
    }
}

describe('a planet as a cube', () => {
    it('has right-handed faces whose normals point out', () => {
        for (const f of FACES) {
            const cross = [f.a[1] * f.b[2] - f.a[2] * f.b[1], f.a[2] * f.b[0] - f.a[0] * f.b[2], f.a[0] * f.b[1] - f.a[1] * f.b[0]];
            cross.forEach((c, i) => expect(c).toBeCloseTo(f.normal[i]!, 12));
        }
    });

    it('names a direction by a face and a place on it, and the place names the direction back', () => {
        for (const d of directions(2000)) {
            const { face, u, v } = faceOf(d[0], d[1], d[2]);
            expect(Math.abs(u)).toBeLessThanOrEqual(1 + 1e-9);
            expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9);
            const back = direction(face, u, v);
            expect(Math.hypot(back[0] - d[0], back[1] - d[1], back[2] - d[2])).toBeLessThan(1e-9);
        }
    });

    it('agrees with the neighbouring face along the edge two faces share, so the ground has no seam', () => {
        // The +X face's u = 1 edge and the -Z face's u = -1 edge are the same line of the cube: the same directions from either side.
        for (let v = -1; v <= 1; v += 0.25) {
            const a = direction(0, 1, v), b = direction(5, -1, v);
            expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-12);
        }
        // And the +X face's v = 1 edge with the +Y face's u = 1 edge (the same line, t along both).
        for (let t = -1; t <= 1; t += 0.25) {
            const a = direction(0, t, 1), b = direction(2, 1, t);
            expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-12);
        }
    });

    it('spreads the squares evenly: no node is more than about 1.4 times another on the ground', () => {
        const node = (face: number, ix: number, iz: number): SphereNode => ({ face, level: 0, ix, iz });
        const n = 2 ** (levels - 1);
        const side = (nd: SphereNode) => {
            const a = nodePoint(planet, levels, nd, 0, 0.5, 0), b = nodePoint(planet, levels, nd, 1, 0.5, 0);
            return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        };
        const middle = side(node(0, n >> 1, n >> 1)), corner = side(node(0, 0, 0));
        expect(Math.max(middle, corner) / Math.min(middle, corner)).toBeLessThan(1.4);
    });
});

describe('the nodes drawn round an eye', () => {
    const eyeOn = (d: [number, number, number], altitude: number): [number, number, number] =>
        [d[0] * (planet.radius + altitude), d[1] * (planet.radius + altitude), d[2] * (planet.radius + altitude)];

    it('cover every point of the planet exactly once, from the ground and from space', () => {
        for (const altitude of [2, 800, 60000]) {
            const eye = eyeOn([0.3, 0.8, 0.52], altitude);
            const nodes = selectSphereNodes(planet, eye[0], eye[1], eye[2], levels);
            for (const d of directions(600)) {
                const { face, u, v } = faceOf(d[0], d[1], d[2]);
                const holding = nodes.filter((n) => {
                    if (n.face !== face) return false;
                    const { u0, v0, span } = nodeRect(levels, n);
                    return u >= u0 && u <= u0 + span && v >= v0 && v <= v0 + span;
                });
                // A point on a shared edge is in two of them; anywhere else exactly one.
                expect(holding.length).toBeGreaterThanOrEqual(1);
                expect(holding.length).toBeLessThanOrEqual(4);
            }
            const area = nodes.reduce((sum, n) => sum + nodeRect(levels, n).span ** 2, 0);
            expect(area).toBeCloseTo(6 * 4, 6);
        }
    });

    it('are finest under the eye and coarsen with distance, and few when the eye is far', () => {
        const ground = selectSphereNodes(planet, 0, 0, planet.radius + 2, levels);
        const space = selectSphereNodes(planet, 0, 0, planet.radius * 6, levels);
        expect(Math.min(...ground.map((n) => n.level))).toBe(0);
        expect(Math.max(...ground.map((n) => n.level))).toBeGreaterThan(4);
        expect(ground.length).toBeLessThan(500);
        // From far off the whole planet is a handful of coarse nodes, none of them the finest.
        expect(space.length).toBeLessThan(ground.length);
        expect(Math.min(...space.map((n) => n.level))).toBeGreaterThan(Math.min(...ground.map((n) => n.level)));
    });

    it('have bounds that hold every point of the node at any height in the range', () => {
        const nd: SphereNode = { face: 2, level: 3, ix: 5, iz: 9 };
        const b = nodeBound(planet, levels, nd);
        for (let s = 0; s <= 1; s += 0.25) for (let t = 0; t <= 1; t += 0.25) for (const h of [planet.minHeight, 0, planet.maxHeight]) {
            const p = nodePoint(planet, levels, nd, s, t, h);
            expect(Math.hypot(p[0] - b.x, p[1] - b.y, p[2] - b.z)).toBeLessThanOrEqual(b.r + 1e-6);
        }
    });

    it('finds the node of a level that holds a place, and names nodes by a key', () => {
        const { face, u, v } = faceOf(0.2, -0.9, 0.3);
        const nd = nodeAt(levels, face, 2, u, v);
        const { u0, v0, span } = nodeRect(levels, nd);
        expect(u).toBeGreaterThanOrEqual(u0 - 1e-12);
        expect(u).toBeLessThanOrEqual(u0 + span + 1e-12);
        expect(v).toBeGreaterThanOrEqual(v0 - 1e-12);
        expect(sphereNodeKey(nd)).toBe(`${face}:2:${nd.ix}:${nd.iz}`);
    });
});
