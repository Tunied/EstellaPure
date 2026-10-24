// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { findGroundPath } from '../src/terrain/reach';

const flat = { heightAt: () => 0 };
/** A wall of cliff along x = 50 for |z| < 100, sheer; open round its ends. */
const cliff = { heightAt: (x: number, z: number) => (Math.abs(x - 50) < 2 && Math.abs(z) < 100 ? 40 : 0) };
/** A ramp rising 1 in 2 (about 27°) east. */
const ramp = { heightAt: (x: number) => Math.max(0, x) * 0.5 };

describe('findGroundPath', () => {
    it('walks flat ground in a straight line', () => {
        const r = findGroundPath(flat, 0, 0, 100, 37);
        expect(r.state).toBe('reached');
        expect(r.path).toHaveLength(2);
        expect(r.length).toBeCloseTo(Math.hypot(100, 37), 3);
    });

    it('goes round a cliff it cannot climb, and is longer for it', () => {
        const r = findGroundPath(cliff, 0, 0, 100, 0, { step: 4 });
        expect(r.state).toBe('reached');
        expect(r.length).toBeGreaterThan(200);
        for (const p of r.path) expect(p.y).toBe(0);
        expect(r.path.at(-1)).toMatchObject({ x: 100, z: 0 });
    });

    it('climbs a slope under the limit and not one over it', () => {
        expect(findGroundPath(ramp, 0, 0, 80, 0, { maxSlope: 30 }).state).toBe('reached');
        // Across the ramp at an angle it is gentler: at 20 degrees a walker switches back up it, at 15 not even that.
        expect(findGroundPath(ramp, 0, 0, 80, 0, { maxSlope: 20 }).state).toBe('reached');
        const steep = findGroundPath(ramp, 0, 0, 80, 0, { maxSlope: 15, detour: 0.2 });
        expect(steep.state).toBe('unreachable');
        expect(steep.path.length).toBeGreaterThan(0);
    });

    it('keeps out of refused places, and says when an end stands in one', () => {
        const moat = (x: number, z: number) => Math.hypot(x - 100, z) > 20 && Math.hypot(x - 100, z) < 30;
        expect(findGroundPath(flat, 0, 0, 100, 0, { blocked: moat }).state).toBe('unreachable');
        expect(findGroundPath(flat, 0, 0, 100, 25, { blocked: moat }).state).toBe('noGround');
        expect(findGroundPath({ heightAt: () => null }, 0, 0, 10, 0).state).toBe('noGround');
    });

    it('says it ran out rather than claiming there is no way', () => {
        expect(findGroundPath(cliff, 0, 0, 100, 0, { step: 1, maxCells: 50 }).state).toBe('exhausted');
    });
});
