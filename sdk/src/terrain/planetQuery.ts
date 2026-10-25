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
import type { PlanetSamples } from './planetProvider';

/** What a planet says of itself, from its component and its provider. */
export interface PlanetFacts {
    /** The centre, in world units. */
    centre: [number, number, number];
    radius: number;
    /** How hard it pulls, in metres a second squared at the surface (0: it pulls nothing). */
    gravity: number;
    /** The ground's height above the radius in a direction from the centre, or null while the provider answers later or the planet is not made. */
    height: ((dx: number, dy: number, dz: number) => number | null) | null;
    /** The weights of the planet's layers there, as its provider paints them (null where it does not, or cannot say yet), and the layers' names (their files', without the extension). */
    paint: ((dx: number, dy: number, dz: number) => readonly number[] | null) | null;
    layers: readonly string[];
    /** The names of the provider's own fields, and their values in a direction (null where it cannot say yet). */
    fieldNames: readonly string[];
    fieldsAt: ((dx: number, dy: number, dz: number) => readonly number[] | null) | null;
    /** The provider's answer for many directions at once (heights, paint, fields), or null while it answers later: a world is laid out from tiles of it, not a call a point. */
    sampleMany: ((directions: Float32Array, count: number) => PlanetSamples | null) | null;
}

/**
 * What paints a planet's ground: given a direction from the centre and the paint the provider gave there (the weights of the planet's layers), the paint
 * to use. A generated world's biomes are one.
 */
export type PlanetPainter = (dx: number, dy: number, dz: number, base: readonly number[]) => readonly number[];

/** The planets of the app. @experimental */
export class PlanetRegistry {
    readonly planets = new Map<Entity, PlanetFacts>();
    private readonly painters_ = new Map<Entity, PlanetPainter>();
    /** Bumped when a painter is set, changed or taken away, so the planet's pages are painted again. */
    paintRevision = 0;

    /** Sets what paints the planet `entity`'s ground (null takes it away); a planet paints with its provider's paint until then. */
    setPaint(entity: Entity, painter: PlanetPainter | null): void {
        if (painter) this.painters_.set(entity, painter); else this.painters_.delete(entity);
        this.paintRevision++;
    }

    /** What paints the planet `entity`'s ground, if anything does. */
    paintOf(entity: Entity): PlanetPainter | null {
        return this.painters_.get(entity) ?? null;
    }

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
