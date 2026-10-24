// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { SplineCurve, type SplinePoint } from '../src/spline/curve';
import { currentShare } from '../src/water/zone';
import { riverStations } from '../src/water/waterPlugin';

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

describe('a river\'s stations', () => {
    // Along +x, widening from 2 to 6, falling a unit over its length; in the world as it is.
    const curve = new SplineCurve([pt(0, 1, 0, 2), pt(20, 0, 0, 6)]);
    const same = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
    const stations = riverStations(curve, 4, same, same, 1);

    it('run the river\'s length, a few to its narrowest width', () => {
        expect(stations[0]!.x).toBeCloseTo(0, 6);
        expect(stations[stations.length - 1]!.x).toBeCloseTo(20, 6);
        expect(stations.length).toBeGreaterThanOrEqual(20 / (2 / 3));
    });

    it('are as wide as the curve and at its height, heading downstream, quicker where it is narrow', () => {
        const first = stations[0]!, last = stations[stations.length - 1]!;
        expect(first.half).toBeCloseTo(curve.width(0) / 2, 6);
        expect(last.half).toBeCloseTo(curve.width(curve.length) / 2, 6);
        expect(first.y).toBeCloseTo(1, 4);
        expect(last.y).toBeCloseTo(0, 4);
        expect(first.dx).toBeCloseTo(1, 3);
        expect(first.speed).toBeGreaterThan(last.speed);
        expect(last.speed).toBeCloseTo(4 * currentShare(6, 6) * 2, 4);
    });
});
