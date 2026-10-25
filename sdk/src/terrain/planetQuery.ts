// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetQuery.ts
 * @brief   What the world asks of a planet: which way is up where something stands, how high the ground is under it, and what pulls it.
 *
 * @details A round world has no one up. Everything that stands, falls or aims on a planet asks it here: `up` is away from the centre of the planet
 *          the position is over, `altitude` the height above the radius, `groundHeight` the generator's own height at the direction (the ground
 *          itself, before any tile is built), and `gravity` how hard the nearest planet pulls. The planets themselves are kept by the Planet
 *          plugin; this file holds only the registry they are written into, so a system that needs to ask (physics, a character, a camera) does
 *          not carry the renderer.
 */
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';

/** What a planet says of itself, from its component and its provider. */
export interface PlanetFacts {
    /** The centre, in world units. */
    centre: [number, number, number];
    radius: number;
    /** How hard it pulls, in metres a second squared at the surface (0: it pulls nothing). */
    gravity: number;
    /** The ground's height above the radius in a direction from the centre, or null while the provider answers later or the planet is not made. */
    height: ((dx: number, dy: number, dz: number) => number | null) | null;
}

/** The planets of the app. @experimental */
export class PlanetRegistry {
    readonly planets = new Map<Entity, PlanetFacts>();

    /** The planet whose surface is nearest the position (a planet pulls from any distance), or null with none. */
    nearest(x: number, y: number, z: number): Entity | null {
        let best: Entity | null = null;
        let bestGap = Infinity;
        for (const [entity, p] of this.planets) {
            const gap = Math.abs(Math.hypot(x - p.centre[0], y - p.centre[1], z - p.centre[2]) - p.radius);
            if (gap < bestGap) { bestGap = gap; best = entity; }
        }
        return best;
    }

    /** The unit direction away from the centre of the planet `entity`, at a position; null for no such planet, or at its very centre. */
    up(entity: Entity, x: number, y: number, z: number): [number, number, number] | null {
        const p = this.planets.get(entity);
        if (!p) return null;
        const dx = x - p.centre[0], dy = y - p.centre[1], dz = z - p.centre[2];
        const len = Math.hypot(dx, dy, dz);
        return len > 1e-9 ? [dx / len, dy / len, dz / len] : null;
    }

    /** How far the position is above the planet's radius (negative inside), or null for no such planet. */
    altitude(entity: Entity, x: number, y: number, z: number): number | null {
        const p = this.planets.get(entity);
        return p ? Math.hypot(x - p.centre[0], y - p.centre[1], z - p.centre[2]) - p.radius : null;
    }

    /** The ground's height above the radius under the position, from the generator; null where it cannot say yet. */
    groundHeight(entity: Entity, x: number, y: number, z: number): number | null {
        const p = this.planets.get(entity);
        if (!p?.height) return null;
        const dx = x - p.centre[0], dy = y - p.centre[1], dz = z - p.centre[2];
        const len = Math.hypot(dx, dy, dz);
        return len > 1e-9 ? p.height(dx / len, dy / len, dz / len) : null;
    }

    /** The point on the ground under the position, in world units, or null where the ground cannot be said yet. */
    groundPoint(entity: Entity, x: number, y: number, z: number): [number, number, number] | null {
        const p = this.planets.get(entity);
        const h = this.groundHeight(entity, x, y, z);
        const up = this.up(entity, x, y, z);
        if (!p || h === null || !up) return null;
        const r = p.radius + h;
        return [p.centre[0] + up[0] * r, p.centre[1] + up[1] * r, p.centre[2] + up[2] * r];
    }
}

export const PlanetRegistryRes = defineResource<PlanetRegistry>(new PlanetRegistry(), 'PlanetRegistry');
