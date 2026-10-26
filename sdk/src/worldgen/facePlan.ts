// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    facePlan.ts
 * @brief   The plan of one face of a planet's world, made the same way on the main thread and on a worker.
 *
 * @details A face's plan is a function of the rules, the seed, the world's name, the sea, the face's zones and what the planet's provider says. Where it is made
 *          is not part of that: the main thread makes it for painting the ground, a worker makes it to place what grows, and the two must agree, so there is
 *          one place that makes it.
 */
import { Environment } from './fields';
import { WorldPlan } from './plan';
import type { WorldRules } from './rules';
import type { Zones } from './zones';
import type { PlanetFace } from './planetSurface';

/** What a face's plan is made from, besides the face itself. */
export interface FacePlanInputs {
    rules: WorldRules;
    /** The rules with the layers that have a `farSpacing` planned sparser, for the far versions of their plants; null when none has one. */
    farRules: WorldRules | null;
    seed: number;
    world: string;
    /** The height of the sea above the planet's radius. */
    seaLevel: number;
    /** The names of the planet's layers, whose paint is a field each (`paint.<name>`), and of the provider's own fields. */
    layers: readonly string[];
    fieldNames: readonly string[];
    /** The zones over this face, in its plane. */
    zones: Zones;
}

/** The far rules for `rules`: each layer with a `farSpacing` spaced that many times further; null when none has one. */
export function farRulesOf(rules: WorldRules): WorldRules | null {
    if (!rules.layers.some((l) => (l.farSpacing ?? 1) > 1)) return null;
    return { ...rules, layers: rules.layers.map((l) => ((l.farSpacing ?? 1) > 1 ? { ...l, spacing: l.spacing * l.farSpacing! } : l)) };
}

/** A face's plan, and the far one. */
export function makeFacePlan(face: PlanetFace, i: FacePlanInputs): { plan: WorldPlan; farPlan: WorldPlan | null } {
    // The planet's layers, as the provider paints them, are fields (`paint.grass` for a layer file grass.esterrainlayer), as a terrain's are, and the
    // provider's own fields (an ecology) are fields by the names it gives them.
    const fields: Record<string, (x: number, z: number) => number> = {};
    i.layers.forEach((name, k) => { fields[`paint.${name}`] = (x, z) => face.paintAt(x, z)?.[k] ?? 0; });
    i.fieldNames.forEach((name, k) => { fields[name] = (x, z) => face.fieldsAt(x, z)?.[k] ?? 0; });
    const env = new Environment({
        seed: i.seed, noise: i.rules.noise, fields: { ...fields, ...i.rules.fields },
        ...face.environment(),
        // The sea stands at a height, so the water over a point is how far it is below it (negative on land, by how far above).
        waterDepth: (_x, _z, y) => i.seaLevel - y,
        overrides: (x, z) => {
            const out: { field: string; value: number; weight: number }[] = [];
            for (const { zone, weight } of i.zones.at(x, z)) for (const [field, value] of Object.entries(zone.fields ?? {})) out.push({ field, value, weight });
            return out;
        },
    });
    const name = `${i.world}#${face.face}`;
    return {
        plan: new WorldPlan(i.rules, env, i.zones, i.seed, name),
        farPlan: i.farRules ? new WorldPlan(i.farRules, env, i.zones, i.seed, name) : null,
    };
}
