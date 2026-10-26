// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import type { PlanetFacts } from '../src/terrain/planetQuery';
import { PlanetFace, FaceZones } from '../src/worldgen/planetSurface';
import { farRulesOf, makeFacePlan } from '../src/worldgen/facePlan';
import { page, placements, type PageRequest, type PlacementsRequest, type PlanSpec } from '../src/worldgen/planWorker';
import { makePlanetPage } from '../src/terrain/planetPages';
import { faceOf } from '../src/terrain/sphere';
import { PLAN_WORKER_SOURCE } from '../src/runtime/planWorkerBundle.generated';
import type { WorldRules } from '../src/worldgen/rules';
import { createJobPool } from '../src/runtime/jobs';

const radius = 4000;
/** A provider as a game writes it for a worker: a module of plain JavaScript whose default export answers. */
const providerSource = `
const fields = ['ecology.island', 'ecology.wild'];
export default {
    id: 'test', versions: [1], range: () => [-10, 40], fields,
    sample({ radius, directions, count }) {
        const heights = new Float32Array(count), paint = new Float32Array(count * 4), f = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            const x = directions[i * 3], y = directions[i * 3 + 1], z = directions[i * 3 + 2];
            heights[i] = 6 + 5 * Math.sin(x * 40) * Math.cos(z * 33) + 3 * y;
            paint[i * 4] = 0.7; paint[i * 4 + 1] = 0.3;
            f[i * 2] = 0.5 + 0.5 * Math.sin(x * 20); f[i * 2 + 1] = 1 - f[i * 2];
        }
        return { heights, paint, fields: f };
    },
};`;

const loader = async (source: string) => (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

const rules: WorldRules = {
    id: 't', versions: [1],
    biomes: [{ id: 'meadow', transition: 3, conditions: [{ field: 'height', min: -100, max: 100 }, { field: 'ecology.island', min: 0.3, blend: 0.2 }, { field: 'paint.grass', min: 0.2, blend: 0.2 }], recipes: [{ recipe: 'tuft', layer: 'cover', density: 1 }] }],
    recipes: [{ id: 'tuft', version: 1, anchor: { id: 'a', mesh: 1, material: 1, footprint: 0.4 }, members: [{ id: 'b', mesh: 1, material: 1, footprint: 0.2, ring: [0.5, 1.5], count: [1, 3] }] }],
    layers: [{ id: 'cover', spacing: 6, drawDistance: 100, farSpacing: 2 }],
    noise: { moisture: { scale: 40, octaves: 2 } },
};

const spec = (face: number): PlanSpec => ({
    rules, seed: 9, world: 'w', seaLevel: 0, face, radius, centre: [0, -radius, 0], layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'],
    zones: [], provider: { source: providerSource, seed: 9, version: 1, world: 'w' },
});

/** What the main thread makes for the same face, with the same provider. */
async function onMain(face: number, layer: string, far: boolean, sq: [number, number, number, number]) {
    const provider = await loader(providerSource);
    const facts: PlanetFacts = {
        centre: [0, -radius, 0], radius, gravity: 0, height: null, paint: null, layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'], fieldsAt: null,
        sampleMany: (directions, count) => provider.sample({ world: 'w', seed: 9, version: 1, radius, directions, count }),
    };
    const f = new PlanetFace(face, () => facts);
    const zones = new FaceZones(f);
    const { plan, farPlan } = makeFacePlan(f, { rules, farRules: farRulesOf(rules), seed: 9, world: 'w', seaLevel: 0, layers: facts.layers, fieldNames: facts.fieldNames, zones: zones.zones });
    return (far && farPlan ? farPlan : plan).placementsIn(sq[0], sq[1], sq[2], sq[3], [layer]);
}

describe('a planet\'s pages made in a worker', () => {
    it('are the pages the main thread makes, with the world\'s biomes painting the ground', async () => {
        const provider = await loader(providerSource);
        const facts: PlanetFacts = {
            centre: [0, -radius, 0], radius, gravity: 0, height: null, paint: null, layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'], fieldsAt: null,
            sampleMany: (directions, count) => provider.sample({ world: 'w', seed: 9, version: 1, radius, directions, count }),
        };
        const faces = [0, 1, 2, 3, 4, 5].map((f) => {
            const face = new PlanetFace(f, () => facts);
            const zones = new FaceZones(face);
            return { face, ...makeFacePlan(face, { rules, farRules: null, seed: 9, world: 'w', seaLevel: 0, layers: facts.layers, fieldNames: facts.fieldNames, zones: zones.zones }) };
        });
        const painter = (dx: number, dy: number, dz: number, base: readonly number[]) => {
            const u = faces[faceOf(dx, dy, dz).face]!;
            const at = u.face.planeOf(dx, dy, dz);
            return at ? u.plan.paint(at.x, at.z, base) : base;
        };
        const node = { face: 2, level: 3, ix: 5, iz: 6 };
        const common = { levels: 8, radius, minHeight: -10, maxHeight: 40 };
        const here = await makePlanetPage({ provider, world: 'w', seed: 9, version: 1, ...common, paint: () => painter }, node);
        const keys = [0, 1, 2, 3, 4, 5].map((f) => `pk${f}`);
        const request: PageRequest = {
            id: 1, type: 'page', node, ...common, provider: { source: providerSource, seed: 9, version: 1, world: 'w' },
            paintKeys: keys, specs: keys.map((_k, f) => spec(f)),
        };
        const away = (await page(request, loader)).result;
        expect(Buffer.from(away.heights)).toEqual(Buffer.from(here.heights));
        expect(Buffer.from(away.paint)).toEqual(Buffer.from(here.paint));
        expect(away.min).toBe(here.min);
        expect(away.max).toBe(here.max);
        // And without a painter, the provider's own paint.
        const plainHere = await makePlanetPage({ provider, world: 'w', seed: 9, version: 1, ...common }, node);
        const plainAway = (await page({ ...request, id: 2, paintKeys: null, specs: [] }, loader)).result;
        expect(Buffer.from(plainAway.paint)).toEqual(Buffer.from(plainHere.paint));
    });
});

describe('a planet\'s world planned in a worker', () => {
    it('places exactly what the main thread places, near and far, on any face', async () => {
        for (const face of [0, 2, 5]) {
            for (const far of [false, true]) {
                const sq: [number, number, number, number] = [-40, 10, 56, 106];
                const request: PlacementsRequest = { id: 1, key: `k${face}`, spec: spec(face), layer: 'cover', far, x0: sq[0], z0: sq[1], x1: sq[2], z1: sq[3] };
                const away = await placements(request, loader);
                const here = await onMain(face, 'cover', far, sq);
                expect(away.length).toBeGreaterThan(5);
                expect(JSON.parse(JSON.stringify(away))).toEqual(JSON.parse(JSON.stringify(here)));
            }
        }
    });

    it('keeps a plan it was sent and answers later questions from it', async () => {
        const first: PlacementsRequest = { id: 1, key: 'kept', spec: spec(2), layer: 'cover', far: false, x0: 0, z0: 0, x1: 48, z1: 48 };
        await placements(first, loader);
        const second = await placements({ id: 2, key: 'kept', layer: 'cover', far: false, x0: 48, z0: 0, x1: 96, z1: 48 }, loader);
        expect(second.length).toBeGreaterThan(0);
        await expect(placements({ id: 3, key: 'unknown', layer: 'cover', far: false, x0: 0, z0: 0, x1: 8, z1: 8 }, loader)).rejects.toThrow(/not known/);
    });

    it('is a script a worker can start from: valid, and answering on the message loop', () => {
        expect(PLAN_WORKER_SOURCE.length).toBeGreaterThan(1000);
        expect(() => new Function(PLAN_WORKER_SOURCE)).not.toThrow();
        expect(PLAN_WORKER_SOURCE).toContain('onmessage');
    });

    it('has no pool where there is no Worker, so the caller plans in place', () => {
        expect(createJobPool(PLAN_WORKER_SOURCE)).toBeNull();
    });
});
