// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WaterField, currentShare, type RiverStation, type ZoneBody, type ZoneGrid, type ZoneLake, type ZoneOcean, type ZoneRiver } from '../src/water/zone';
import { polygonSdf, shoreDamp, type Point2 } from '../src/water/shore';

// A square lake 40 across round the origin, its surface at y = 0.
const square: Point2[] = [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }];
const lake = (extra: Partial<ZoneLake> = {}): ZoneLake => ({
    kind: 'lake', key: 1, level: 0, waveHeight: 1, shoreWidth: 4, outline: square, toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z], ...extra,
});
// A river along +x from x = -60 into the lake at x = -10, 6 wide, at the lake's level, running at 2.
const river = (y = 0): ZoneRiver => {
    const stations: RiverStation[] = [];
    for (let x = -60; x <= -10; x += 1) stations.push({ x, z: 0, y, half: 3, dx: 1, dz: 0, speed: 2 });
    return { kind: 'river', key: 2, waveHeight: 0.2, shoreWidth: 1, stations };
};
const ocean = (level = -5): ZoneOcean => ({ kind: 'ocean', key: 3, level, waveHeight: 2, shoreWidth: 6 });
const grid: ZoneGrid = { minX: -80, minZ: -40, sizeX: 120, sizeZ: 80, nx: 241, nz: 161 };
const bake = (bodies: ZoneBody[], ground?: (x: number, z: number) => number | null): WaterField => WaterField.bake(grid, bodies, ground);

describe('the outline of a lake', () => {
    it('is the signed distance to its edge, positive inside', () => {
        expect(polygonSdf(square, 0, 0)).toBeCloseTo(20, 6);
        expect(polygonSdf(square, 19, 0)).toBeCloseTo(1, 6);
        expect(polygonSdf(square, 25, 0)).toBeCloseTo(-5, 6);
    });

    it('calms the waves toward it', () => {
        expect(shoreDamp(0, 4)).toBe(0);
        expect(shoreDamp(2, 4)).toBeCloseTo(0.5, 6);
        expect(shoreDamp(10, 4)).toBe(1);
        expect(shoreDamp(-1, 0)).toBe(1);
    });
});

describe('a zone with a lake', () => {
    const field = bake([lake()]);

    it('is water inside the outline at the lake\'s level, and none outside', () => {
        const mid = field.sample(0, 0)!;
        expect(mid.key).toBe(1);
        expect(mid.height).toBeCloseTo(0, 3);
        expect(mid.shore).toBeCloseTo(20, 0);
        expect(field.sample(30, 0)).toBeNull();
    });

    it('raises its waves to their full height from the shore in', () => {
        expect(field.sample(0, 0)!.amp).toBeCloseTo(1, 3);
        expect(field.sample(19.5, 0)!.amp).toBeLessThan(0.1);
        expect(field.sample(0, 0)!.calm).toBeCloseTo(1, 3);
        expect(field.sample(19.5, 0)!.calm).toBeLessThan(0.1);
    });

    it('keeps the lake\'s height on the dry texels round it, so the surface cut at the shore is not pulled down there', () => {
        expect(field.at(30, 0)!.height).toBeCloseTo(0, 3);
        expect(field.at(30, 0)!.shore).toBeLessThan(0);
    });

    it('takes its depth from the ground, and calms the waves where it is shallow', () => {
        // The bed rises to 0.5 under the surface east of x = 0.
        const shoal = bake([lake()], (x) => (x > 0 ? -0.5 : -10));
        expect(shoal.sample(-5, 0)!.depth).toBeCloseTo(10, 3);
        expect(shoal.sample(5, 0)!.depth).toBeCloseTo(0.5, 3);
        expect(shoal.sample(5, 0)!.amp).toBeLessThan(shoal.sample(-5, 0)!.amp);
    });

    it('turns with the lake, so a lake turned a quarter about up holds its outline in the world turned', () => {
        const long: Point2[] = [{ x: -20, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }, { x: -20, y: 5 }];
        const turned = bake([lake({ outline: long, toLocal: (x, z) => [z, -x], toWorld: (x, z) => [-z, x] })]);
        expect(turned.sample(0, 15)).not.toBeNull();
        expect(turned.sample(15, 0)).toBeNull();
    });
});

describe('a river running into a lake', () => {
    const field = bake([lake(), river()]);

    it('is one water along its course and into the lake, with no shore across its mouth', () => {
        for (let x = -55; x <= 0; x += 0.5) {
            const s = field.sample(x, 0);
            expect(s, `water at x = ${x}`).not.toBeNull();
            expect(s!.height).toBeCloseTo(0, 3);
        }
        // Where the river's middle crosses the lake's outline the water is a river's half width or more from any shore: nothing foams there.
        expect(field.sample(-20, 0)!.shore).toBeGreaterThan(2.5);
        // Its banks run on into the lake's shores: beside the river, outside the lake, there is no water.
        expect(field.sample(-30, 5)).toBeNull();
    });

    it('carries its current, which fades out in the still water', () => {
        const mid = field.sample(-40, 0)!;
        expect(mid.flowX).toBeGreaterThan(1.5);
        expect(Math.abs(mid.flowZ)).toBeLessThan(1e-3);
        expect(Math.hypot(field.sample(0, 0)!.flowX, field.sample(0, 0)!.flowZ)).toBeLessThan(0.05);
    });

    it('is at its own height up its course, and blends to the lake\'s where they meet', () => {
        const high = bake([lake(), river(2)]);
        expect(high.sample(-50, 0)!.height).toBeCloseTo(2, 2);
        expect(high.sample(0, 0)!.height).toBeCloseTo(0, 2);
    });
});

describe('an ocean', () => {
    it('is everywhere the ground is below its level, and goes on past the region', () => {
        const field = bake([ocean()], (x) => (x > 0 ? 5 : -20));
        expect(field.sample(-30, 0)!.height).toBeCloseTo(-5, 3);
        expect(field.sample(30, 0)).toBeNull();
        const past = field.sample(5000, 5000)!;
        expect(past.key).toBe(3);
        expect(past.height).toBe(-5);
        expect(past.amp).toBe(2);
    });

    it('gives way to a lake over it: a point on the lake is the lake\'s, not the sea\'s under it', () => {
        const field = bake([ocean(-5), lake()], () => -30);
        const s = field.sample(0, 0)!;
        expect(s.key).toBe(1);
        expect(s.height).toBeCloseTo(0, 3);
        expect(field.sample(-60, 30)!.key).toBe(3);
    });
});

describe('the field as the shader reads it', () => {
    it('holds the height to a 65535th of its span, and the shore, the waves and the current in bytes', () => {
        const field = bake([lake(), river(3)]);
        const r = field.ranges();
        const { heights, field: rest } = field.encode(r);
        const k = Math.round((0 - grid.minZ) / grid.sizeZ * (grid.nz - 1)) * grid.nx + Math.round((-50 - grid.minX) / grid.sizeX * (grid.nx - 1));
        const h = r.heightMin + ((heights[k * 4]! * 256 + heights[k * 4 + 1]!) / 65535) * r.heightSpan;
        expect(h).toBeCloseTo(field.height[k]!, 3);
        expect((rest[k * 4 + 1]! / 255 - 0.5) * 2 * r.flow).toBeCloseTo(field.flowX[k]!, 1);
        expect((rest[k * 4]! / 255 - 0.5) * 2 * r.shore).toBeCloseTo(Math.max(-r.shore, Math.min(r.shore, field.shore[k]!)), 0);
    });

    it('is nothing over an ocean alone: there is no region, and every point is the ocean', () => {
        const field = WaterField.bake({ minX: 0, minZ: 0, sizeX: 0, sizeZ: 0, nx: 0, nz: 0 }, [ocean(1)]);
        expect(field.at(0, 0)).toBeNull();
        expect(field.sample(0, 0)!.height).toBe(1);
    });
});

describe('a river\'s current', () => {
    it('is quicker in a narrow reach than a wide one', () => {
        expect(currentShare(2, 6)).toBe(1);
        expect(currentShare(6, 6)).toBe(0.5);
        expect(currentShare(60, 6)).toBe(0.125);
    });
});
