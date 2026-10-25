// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetSurface.ts
 * @brief   A planet's ground as a plane for laying a world out on: each face of the cube is one, in metres.
 *
 * @details The plan (plan.ts) works on a plane of x and z. A round world has none, but each face of the cube the planet is cut into (terrain/sphere.ts)
 *          is a square of ground that reads as one: x and z are metres across the face from its middle (a quarter turn of the great circle
 *          is a face's width, so a metre on the plane is a metre on the ground at the middle and a third less at the corner), and the
 *          height is the ground's height above the radius. A world is laid out face by face, and a direction is laid out by the face it falls on, so
 *          a point is planned once. What is placed is taken from the plane to the planet here: its place, and which way is up.
 */
import type { PlanetFacts } from '../terrain/planetQuery';
import { FACES, direction, facePlace } from '../terrain/sphere';
import { tangentFrame } from '../terrain/planetPages';
import type { EnvironmentInputs } from './fields';
import { Zones, type ZoneDef } from './zones';

/** The metres a unit of a face's -1 to 1 is, at its middle. */
export const faceUnit = (radius: number): number => radius * Math.PI / 4;

/** How wide a face is, in metres across the plane (-half to +half). */
export const faceHalf = (radius: number): number => faceUnit(radius);

/** Where a point of the plane stands on the planet: its direction from the centre, the unit vectors along the plane's x, up and z there. */
export interface PlaneFrame {
    dir: [number, number, number];
    eu: [number, number, number];
    ev: [number, number, number];
}

/** One face of a planet as a plane. */
export class PlanetFace {
    constructor(readonly face: number, readonly planet: () => PlanetFacts | null) {}

    private facts(): PlanetFacts | null { return this.planet(); }

    /** The unit direction from the centre at a point of the plane (beyond the face's edge it carries on over the next). */
    directionAt(x: number, z: number): [number, number, number] {
        const f = this.facts();
        const unit = faceUnit(f?.radius ?? 1);
        return direction(this.face, x / unit, z / unit);
    }

    /** The point of the plane under a direction from the centre, or null for a direction that does not face this one. */
    planeOf(dx: number, dy: number, dz: number): { x: number; z: number } | null {
        const f = this.facts();
        const at = facePlace(this.face, dx, dy, dz);
        if (!f || !at) return null;
        const unit = faceUnit(f.radius);
        return { x: at.u * unit, z: at.v * unit };
    }

    /** The frame at a point of the plane. */
    frameAt(x: number, z: number): PlaneFrame {
        const dir = this.directionAt(x, z);
        const eu: [number, number, number] = [0, 0, 0], ev: [number, number, number] = [0, 0, 0];
        tangentFrame(this.face, dir, eu, ev);
        return { dir, eu, ev };
    }

    /** The world position of a point of the plane at a height above the radius. */
    world(x: number, y: number, z: number): [number, number, number] {
        const f = this.facts()!;
        const d = this.directionAt(x, z), r = f.radius + y;
        return [f.centre[0] + d[0] * r, f.centre[1] + d[1] * r, f.centre[2] + d[2] * r];
    }

    /** The ground under a point of the plane: its height above the radius, how much it faces away from the centre, and its normal along the plane's x, up and z. */
    ground(x: number, z: number): { y: number; up: number; normal: [number, number, number] } | null {
        const f = this.facts();
        if (!f?.height) return null;
        const at = (px: number, pz: number): number | null => { const d = this.directionAt(px, pz); return f.height!(d[0], d[1], d[2]); };
        const h = at(x, z);
        if (h === null) return null;
        // The normal from the ground a couple of metres either way along the plane, taken in the frame there.
        const step = 2;
        const hx0 = at(x - step, z), hx1 = at(x + step, z), hz0 = at(x, z - step), hz1 = at(x, z + step);
        if (hx0 === null || hx1 === null || hz0 === null || hz1 === null) return { y: h, up: 1, normal: [0, 1, 0] };
        // The ground's rise along each axis, over the run of the chord between the two points (the curve itself is not a slope).
        const run = 2 * step;
        const nx = -(hx1 - hx0) / run, nz = -(hz1 - hz0) / run;
        const len = Math.hypot(nx, 1, nz);
        return { y: h, up: 1 / len, normal: [nx / len, 1 / len, nz / len] };
    }

    /** What a plane normal is in the world: along the frame's x, up and z. */
    worldNormal(normal: readonly [number, number, number], x: number, z: number): [number, number, number] {
        const fr = this.frameAt(x, z);
        return [
            normal[0] * fr.eu[0] + normal[1] * fr.dir[0] + normal[2] * fr.ev[0],
            normal[0] * fr.eu[1] + normal[1] * fr.dir[1] + normal[2] * fr.ev[1],
            normal[0] * fr.eu[2] + normal[1] * fr.dir[2] + normal[2] * fr.ev[2],
        ];
    }

    /** The environment's inputs for this face: the ground, and the noise read in three dimensions from the point's place on the sphere. */
    environment(): Pick<EnvironmentInputs, 'ground' | 'space'> {
        return {
            ground: (x, z) => this.ground(x, z),
            space: (x, z) => {
                const f = this.facts()!;
                const d = this.directionAt(x, z);
                return [d[0] * f.radius, d[1] * f.radius, d[2] * f.radius];
            },
        };
    }

    /** A zone of the world (a circle or a box standing at a world position) as this face's plane has it, or null where its centre is not over this face. */
    zoneOnFace(zone: ZoneDef): ZoneDef | null {
        const f = this.facts();
        const s = zone.shape;
        if (!f || s.y === undefined) return null;
        const dx = s.x - f.centre[0], dy = s.y - f.centre[1], dz = s.z - f.centre[2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-9) return null;
        const at = this.planeOf(dx / len, dy / len, dz / len);
        const half = faceHalf(f.radius);
        // A zone is kept on the face its centre falls on, and on a neighbour when it reaches over the edge.
        const reach = (s.type === 'circle' ? s.radius : Math.hypot(s.halfX, s.halfZ)) + zone.falloff;
        if (!at || Math.abs(at.x) > half + reach || Math.abs(at.z) > half + reach) return null;
        if (s.type === 'circle') return { ...zone, shape: { type: 'circle', x: at.x, z: at.z, radius: s.radius } };
        // A box's own turn: where its x axis points, as an angle from the plane's x toward its z there (the world's own turn when it names no facing).
        const fr = this.frameAt(at.x, at.z);
        const ax = s.facing ?? [Math.cos(s.yaw ?? 0), 0, Math.sin(s.yaw ?? 0)];
        const yaw = Math.atan2(ax[0] * fr.ev[0] + ax[1] * fr.ev[1] + ax[2] * fr.ev[2], ax[0] * fr.eu[0] + ax[1] * fr.eu[1] + ax[2] * fr.eu[2]);
        return { ...zone, shape: { type: 'rect', x: at.x, z: at.z, halfX: s.halfX, halfZ: s.halfZ, yaw } };
    }

    /** The streaming sources, in this face's plane (those over it, and over its neighbours' edges within `reach`). */
    sourcesOnFace(sources: Iterable<{ x: number; y?: number; z: number }>, reach: number): { x: number; z: number }[] {
        const f = this.facts();
        const out: { x: number; z: number }[] = [];
        if (!f) return out;
        const half = faceHalf(f.radius);
        for (const s of sources) {
            const dx = s.x - f.centre[0], dy = (s.y ?? 0) - f.centre[1], dz = s.z - f.centre[2];
            const len = Math.hypot(dx, dy, dz);
            if (len < 1e-9) continue;
            const at = this.planeOf(dx / len, dy / len, dz / len);
            if (at && Math.abs(at.x) <= half + reach && Math.abs(at.z) <= half + reach) out.push(at);
        }
        return out;
    }
}

/** The six faces of a planet, as planes. */
export function planetFaces(planet: () => PlanetFacts | null): PlanetFace[] {
    return FACES.map((_f, i) => new PlanetFace(i, planet));
}

/** The zones of a world as each face has them: those over it, in its plane. Kept in step by `sync`. */
export class FaceZones {
    readonly zones = new Zones();
    constructor(readonly face: PlanetFace) {}

    /** Takes the world's zones, replacing what was there: only what changed touches the plan. */
    sync(world: Iterable<ZoneDef>): void {
        const keep = new Set<string>();
        for (const z of world) {
            const mine = this.face.zoneOnFace(z);
            if (!mine) continue;
            this.zones.set(mine);
            keep.add(mine.id);
        }
        for (const z of [...this.zones.all()]) if (!keep.has(z.id)) this.zones.delete(z.id);
    }
}
