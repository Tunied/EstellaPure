// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A world's plan: biomes, zones and layered groups, the same whatever is asked first, and ids that outlive rules added later.
 */
import { describe, expect, it } from 'vitest';
import { Environment } from '../src/worldgen/fields';
import { WorldPlan, type Placement } from '../src/worldgen/plan';
import type { WorldRules } from '../src/worldgen/rules';
import { Zones, zoneDistance } from '../src/worldgen/zones';
import { PlacementDiffs } from '../src/worldgen/diffs';
import { NoiseSource, type NoiseParams } from '../src/terrain/source';

const terrain: NoiseParams = { seed: 5, frequency: 3, octaves: 4, persistence: 0.5, ridged: 0.2, warp: 0, erosion: 0, sizeX: 800, height: 60,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
const ground = new NoiseSource(terrain);

const rules: WorldRules = {
    id: 'test:world', versions: [1],
    biomes: [
        { id: 'forest', conditions: [{ field: 'moisture', min: 0.5, blend: 0.1 }], transition: 30, paint: [1, 0, 0, 0],
            recipes: [{ recipe: 'grove', layer: 'groups', density: 0.8 }, { recipe: 'fern', layer: 'detail', density: 0.6 }] },
        { id: 'rocks', conditions: [{ field: 'moisture', max: 0.5, blend: 0.1 }], transition: 30, paint: [0, 0, 0, 1],
            recipes: [{ recipe: 'boulders', layer: 'groups', density: 0.5 }, { recipe: 'ore', layer: 'detail', density: 0.2 }] },
    ],
    recipes: [
        { id: 'grove', version: 1, tags: ['tree'], anchor: { id: 'oak', mesh: 1, footprint: 0.8, canopy: 4, minUp: 0.8 },
            members: [{ id: 'sapling', mesh: 2, count: [2, 4], ring: [3, 6], scale: [0.5, 0.8], footprint: 0.4, minUp: 0.8 },
                { id: 'stump', mesh: 3, chance: 0.4, ring: [2, 3], footprint: 0.5 }] },
        { id: 'boulders', version: 1, tags: ['rock'], anchor: { id: 'main', mesh: 4, footprint: 2 },
            members: [{ id: 'pebble', mesh: 5, count: [3, 6], ring: [2.5, 5], footprint: 0.3 }] },
        { id: 'fern', version: 1, anchor: { id: 'fern', mesh: 6, footprint: 0.3 } },
        { id: 'ore', version: 1, anchor: { id: 'copper', mesh: 7, footprint: 0.6, interactive: 'ore' } },
    ],
    layers: [
        { id: 'groups', spacing: 14, drawDistance: 200 },
        { id: 'detail', spacing: 3, drawDistance: 80 },
    ],
};

const plan = (r: WorldRules = rules, zones = new Zones()) => new WorldPlan(r, new Environment({
    seed: 9, ground: (x, z) => ({ y: ground.height(x, z), up: ground.normal(x, z)[1] }),
    waterDepth: (_x, _z, y) => 4 - y,
}), zones, 9, 'planet');

const ids = (ps: Placement[]) => ps.map((p) => p.id).sort();

describe('a world plan', () => {
    it('places the same things whatever order its chunks are asked in, each group by exactly one chunk', () => {
        const chunk = 64;
        const cells = [] as [number, number][];
        for (let cz = -2; cz < 2; cz++) for (let cx = -2; cx < 2; cx++) cells.push([cx, cz]);
        const run = (order: [number, number][]) => {
            const p = plan();
            const out: Placement[] = [];
            for (const [cx, cz] of order) out.push(...p.placementsIn(cx * chunk, cz * chunk, (cx + 1) * chunk, (cz + 1) * chunk));
            return out;
        };
        const forward = run(cells), backward = run([...cells].reverse());
        expect(ids(forward)).toEqual(ids(backward));
        expect(new Set(ids(forward)).size).toBe(forward.length);
        const whole = plan().placementsIn(-128, -128, 128, 128);
        expect(ids(whole)).toEqual(ids(forward));
        expect(forward.some((p) => p.layer === 'groups')).toBe(true);
        expect(forward.some((p) => p.layer === 'detail')).toBe(true);
    });

    it('never lets two footprints overlap, within a layer or across layers', () => {
        const all = plan().placementsIn(-100, -100, 100, 100);
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
            const a = all[i]!, b = all[j]!;
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.footprint + b.footprint - 1e-9);
        }
    });

    it('keeps the ids, places and choices of earlier layers when a later layer or recipe is added', () => {
        const more: WorldRules = {
            ...rules,
            recipes: [...rules.recipes, { id: 'flowers', version: 1, anchor: { id: 'daisy', mesh: 8, footprint: 0.2 } }],
            biomes: rules.biomes.map((b) => ({ ...b, recipes: [...b.recipes, { recipe: 'flowers', layer: 'flowers', density: 0.5 }] })),
            layers: [...rules.layers, { id: 'flowers', spacing: 2, drawDistance: 40 }],
        };
        const before = plan().placementsIn(-64, -64, 64, 64);
        const after = plan(more).placementsIn(-64, -64, 64, 64, ['groups', 'detail']);
        expect(after).toEqual(before);
    });

    it('keeps out what a zone excludes, thins it over the zone\'s edge, and leaves the rest of the world as it was', () => {
        const zones = new Zones();
        const open = plan(undefined, zones).placementsIn(-64, -64, 64, 64);
        zones.set({ id: 'home', kind: 'home', shape: { type: 'circle', x: 0, z: 0, radius: 20 }, falloff: 10, priority: 5, excludes: ['*'] });
        const homed = plan(undefined, zones).placementsIn(-64, -64, 64, 64);
        for (const p of homed) expect(zoneDistance({ type: 'circle', x: 0, z: 0, radius: 20 }, p.x, p.z)).toBeGreaterThan(-1e-9);
        // Far from the home every placement stands where it did, under its id.
        const far = (ps: Placement[]) => ids(ps.filter((p) => Math.hypot(p.x, p.z) > 60));
        expect(far(homed)).toEqual(far(open));
        expect(homed.length).toBeLessThan(open.length);
    });

    it('keeps only what a zone names out of it, and holds the biome a zone says', () => {
        const zones = new Zones();
        zones.set({ id: 'mine', kind: 'resource', shape: { type: 'rect', x: 0, z: 0, halfX: 30, halfZ: 30 }, falloff: 0, priority: 1,
            excludes: ['tree'], biome: 'rocks' });
        const p = plan(undefined, zones);
        expect(p.biomeAt(0, 0)).toBe('rocks');
        const inside = p.placementsIn(-30, -30, 30, 30).filter((q) => Math.abs(q.x) < 25 && Math.abs(q.z) < 25);
        expect(inside.every((q) => q.recipe !== 'grove')).toBe(true);
        expect(inside.some((q) => q.recipe === 'boulders' || q.recipe === 'ore')).toBe(true);
    });

    it('mixes biomes whose weights sum to one, and paints the ground by them', () => {
        const p = plan();
        let mixed = 0;
        for (let x = -400; x < 400; x += 7) {
            const w = p.biomeWeights(x, 13);
            if (w.length === 0) continue;
            expect(w.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 9);
            if (w.length > 1) mixed++;
            const paint = p.paint(x, 13, [0.25, 0.25, 0.25, 0.25]);
            expect(paint.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
        }
        expect(mixed).toBeGreaterThan(0);
    });

    it('says why nothing stands where it does not', () => {
        const p = plan();
        const stats = p.stats('detail', -50, -50, 50, 50);
        expect(stats.placed).toBeGreaterThan(0);
        expect(stats.occupied + stats.conflict + stats.density).toBeGreaterThan(0);
        const why = p.explain(10, 10);
        expect(why.biomes.length).toBeGreaterThan(0);
        expect(why.layers.map((l) => l.layer)).toEqual(['groups', 'detail']);
        expect(Number.isFinite(why.fields.moisture)).toBe(true);
    });
});

describe('placement diffs', () => {
    it('round-trip through a save, and say which placements changed', () => {
        const diffs = new PlacementDiffs();
        const told: string[] = [];
        diffs.onChange = (id) => told.push(id);
        diffs.remove('groups@1:3,4/grove@1/oak.0');
        diffs.change('detail@1:9,9/ore@1/copper.0', { yaw: 1 });
        const saved = JSON.parse(JSON.stringify(diffs.toJSON()));
        const back = new PlacementDiffs();
        back.load(saved);
        expect(back.isRemoved('groups@1:3,4/grove@1/oak.0')).toBe(true);
        expect(back.changeOf('detail@1:9,9/ore@1/copper.0')).toEqual({ yaw: 1 });
        expect(told).toEqual(['groups@1:3,4/grove@1/oak.0', 'detail@1:9,9/ore@1/copper.0']);
    });
});

describe('the environment', () => {
    it('reads how far a place is from the water, and none where no water is known', () => {
        const env = new Environment({ seed: 1, ground: () => ({ y: 0, up: 1 }), shoreDistance: (x) => (x > 0 ? x : null) });
        expect(env.sample(12, 0).shoreDistance).toBe(12);
        expect(env.sample(-5, 0).shoreDistance).toBe(Infinity);
    });
});

describe('plants in a plan', () => {
    const plantRules: WorldRules = {
        id: 'test:plants', versions: [1],
        biomes: [{ id: 'meadow', conditions: [], recipes: [{ recipe: 'tuft', layer: 'cover', density: 1 }] }],
        recipes: [{ id: 'tuft', version: 1, anchor: { id: 'tuft', plant: 'grass', footprint: 0.2 }, members: [{ id: 'more', plant: 'grass', count: [2, 3], ring: [1, 2], footprint: 0.2 }] }],
        layers: [{ id: 'cover', spacing: 8, drawDistance: 100 }],
    };
    const flat = new Environment({ seed: 1, ground: () => ({ y: 3, up: 1 }) });

    it('carries the name of the plant a member is, and no mesh', () => {
        const plan = new WorldPlan(plantRules, flat, new Zones(), 1, 'w');
        const placements = plan.placementsIn(0, 0, 64, 64);
        expect(placements.length).toBeGreaterThan(8);
        for (const p of placements) { expect(p.plant).toBe('grass'); expect(p.mesh).toBe(0); }
    });

    it('works out a field only when a rule reads it', () => {
        let read = 0;
        const env = new Environment({
            seed: 1, ground: () => ({ y: 0, up: 1 }),
            fields: { costly: () => { read++; return 1; }, unused: () => { read += 1000; return 0; } },
        });
        const at = env.sample(5, 5);
        expect(read).toBe(0);
        expect(at.costly).toBe(1);
        expect(at.costly).toBe(1);
        expect(read).toBe(1);
        expect(at.height).toBe(0);
    });
});

