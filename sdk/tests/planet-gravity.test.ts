// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/types';
import { PlanetRegistry } from '../src/terrain/planetQuery';
import { planetPullForce } from '../src/physics3d/planetGravity';

const a = 1 as Entity, b = 2 as Entity;

describe('the planets of a world', () => {
    const registry = new PlanetRegistry();
    registry.planets.set(a, { centre: [0, -4000, 0], radius: 4000, gravity: 9.81, height: (dx, dy, dz) => 10 * dy + 0 * dx * dz, paint: null, layers: [], fieldNames: [], fieldsAt: null, sampleMany: null });
    registry.planets.set(b, { centre: [50000, 0, 0], radius: 1000, gravity: 3, height: null, paint: null, layers: [], fieldNames: [], fieldsAt: null, sampleMany: null });

    it('name the planet whose surface is nearest, from anywhere', () => {
        expect(registry.nearest(0, 100, 0)).toBe(a);
        expect(registry.nearest(49000, 0, 0)).toBe(b);
        expect(registry.nearest(25000, 0, 0)).toBe(a);
    });

    it('say which way is up and how high', () => {
        expect(registry.up(a, 0, 100, 0)).toEqual([0, 1, 0]);
        const side = registry.up(a, 4000, -4000, 0)!;
        expect(side[0]).toBeCloseTo(1, 12);
        expect(registry.altitude(a, 0, 120, 0)).toBeCloseTo(120, 9);
        expect(registry.altitude(a, 0, -100, 0)).toBeCloseTo(-100, 9);
        expect(registry.up(a, 0, -4000, 0)).toBeNull();
    });

    it('give the ground under a position from the generator, and the point on it', () => {
        expect(registry.groundHeight(a, 0, 100, 0)).toBeCloseTo(10, 6);
        const p = registry.groundPoint(a, 0, 100, 0)!;
        expect(p[1]).toBeCloseTo(10, 6);
        expect(registry.groundHeight(b, 50000, 2000, 0)).toBeNull();
    });
});

describe('the pull of a planet on a body', () => {
    it('is the planet\'s gravity down, in place of the world\'s', () => {
        // The world's gravity is zero: the force is the planet's pull alone.
        expect(planetPullForce(10, 1, [0, -1, 0], 9.81, [0, 0, 0])[1]).toBeCloseTo(-98.1, 9);
        // The world pulls along -Y at 9.81: standing on the top of the planet needs nothing more.
        expect(planetPullForce(10, 1, [0, -1, 0], 9.81, [0, -9.81, 0])[1]).toBeCloseTo(0, 9);
        // Round the side it takes the world's pull off and puts the planet's on.
        const f = planetPullForce(2, 1, [-1, 0, 0], 9.81, [0, -9.81, 0]);
        expect(f[0]).toBeCloseTo(-19.62, 9);
        expect(f[1]).toBeCloseTo(19.62, 9);
        // A body the world does not pull (gravity scale 0) is pulled by the planet alone.
        expect(planetPullForce(2, 0, [0, -1, 0], 9.81, [0, -9.81, 0])[1]).toBeCloseTo(-19.62, 9);
    });
});
