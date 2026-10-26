// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planePlan.ts
 * @brief   The plan of a world on a plane (a terrain of x and z), made the same way on the main thread and on a worker.
 *
 * @details A plane's plan reads the ground (its height, its normal, how it is painted) and the water (how deep it stands, how far a point is from the shore).
 *          Both are asked through two small interfaces, so the main thread can give it the terrain and the water it has and a worker the same answers rebuilt
 *          from the data they were sent: one function makes the plan, and where it is made is not part of what it places.
 */
import { Environment } from './fields';
import { WorldPlan } from './plan';
import type { WorldRules } from './rules';
import type { Zones } from './zones';

/** What the plan asks of the ground. */
export interface GroundLike {
    heightAt(x: number, z: number): number | null;
    normalAt(x: number, z: number): [number, number, number] | null;
    paintAt(x: number, z: number): readonly number[] | null;
}

/** What the plan asks of the water. */
export interface WaterLike {
    depthAt(x: number, z: number, y: number): number | null;
    shoreAt(x: number, z: number): number | null;
}

/** What a plane's plan is made from. */
export interface PlanePlanInputs {
    rules: WorldRules;
    farRules: WorldRules | null;
    seed: number;
    world: string;
    /** The ground, or null where there is none: the world is then flat at `flatY`. */
    ground: GroundLike | null;
    flatY: number;
    water: WaterLike | null;
    /** The names of the ground's layers, whose paint is a field each (`paint.<name>`). */
    layers: readonly string[];
    zones: Zones;
}

/** A plane's plan, and the far one. */
export function makePlanePlan(i: PlanePlanInputs): { plan: WorldPlan; farPlan: WorldPlan | null } {
    // The ground's paint is a field for each of its layers, `paint.grass` for a layer file grass.esterrainlayer: how much of the ground there is that.
    const paintFields: Record<string, (x: number, z: number) => number> = {};
    if (i.ground) i.layers.forEach((name, k) => { paintFields[`paint.${name}`] = (x, z) => i.ground!.paintAt(x, z)?.[k] ?? 0; });
    const env = new Environment({
        seed: i.seed, noise: i.rules.noise, fields: { ...paintFields, ...i.rules.fields },
        ground: (x, z) => {
            if (i.ground) {
                const y = i.ground.heightAt(x, z);
                if (y === null) return null;
                const n = i.ground.normalAt(x, z) ?? [0, 1, 0];
                return { y, up: n[1], normal: n };
            }
            // No terrain: the world is flat at the WorldGen's own height.
            return { y: i.flatY, up: 1, normal: [0, 1, 0] };
        },
        waterDepth: (x, z, y) => i.water?.depthAt(x, z, y) ?? null,
        shoreDistance: (x, z) => i.water?.shoreAt(x, z) ?? null,
        overrides: (x, z) => {
            const out: { field: string; value: number; weight: number }[] = [];
            for (const { zone, weight } of i.zones.at(x, z)) for (const [field, value] of Object.entries(zone.fields ?? {})) out.push({ field, value, weight });
            return out;
        },
    });
    return {
        plan: new WorldPlan(i.rules, env, i.zones, i.seed, i.world),
        farPlan: i.farRules ? new WorldPlan(i.farRules, env, i.zones, i.seed, i.world) : null,
    };
}
