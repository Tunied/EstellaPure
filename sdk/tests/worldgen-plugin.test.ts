// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A generated world in a running app with no renderer (a server): interactive placements are entities with stable ids, a
 *        player's change outlives its chunk, zones keep their ground clear, and unknown rules fail loudly.
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { WorldStreamingSource } from '../src/residency/components';
import {
    PlacedObject, WorldGen, WorldGenPlugin, WorldGenRes, WorldZone, ZoneShapeKind, type PlacedObjectData,
} from '../src/worldgen/worldgenPlugin';
import { registerWorldRules, type WorldRules } from '../src/worldgen/rules';
import type { Entity } from '../src/types';
import { Terrain, TerrainExtent, TerrainPlugin, TerrainsRes } from '../src/terrain/terrainPlugin';

const rules: WorldRules = {
    id: 'test:ores', versions: [1],
    biomes: [{ id: 'plain', conditions: [], recipes: [{ recipe: 'ore', layer: 'ores', density: 0.7 }] }],
    recipes: [{ id: 'ore', version: 1, anchor: { id: 'copper', mesh: 0, footprint: 1, interactive: 'ore' } }],
    layers: [{ id: 'ores', spacing: 10, drawDistance: 60, chunkSize: 32 }],
};
registerWorldRules(rules);

const boot = () => {
    setDefaultContext(new AppContext());
    setEditorMode(false);
    setPlayMode(false);
    const app = App.new();
    const module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    app.addPlugin(new WorldGenPlugin());
    return app;
};
// The mock engine composes no transforms: an entity without a parent is given its world pose as well.
const placed = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });
const tick = async (app: App, n = 1) => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
const objects = (app: App) => app.world.getEntitiesWithComponents([PlacedObject]).map((e) => (app.world.get(e, PlacedObject) as PlacedObjectData).id);

const world = (app: App, data: Record<string, unknown> = {}): { gen: Entity; source: Entity } => {
    const gen = app.world.spawn();
    app.world.insert(gen, Transform, placed(0, 0, 0));
    app.world.insert(gen, WorldGen, { ...WorldGen._default, rules: 'test:ores', world: 'planet', seed: 3, ...data });
    const source = app.world.spawn();
    app.world.insert(source, Transform, placed(0, 0, 0));
    app.world.insert(source, WorldStreamingSource, { ...WorldStreamingSource._default });
    return { gen, source };
};

describe('a generated world with no renderer', () => {
    it('stands its interactive placements as entities with the plan\'s ids, round the source and no further', async () => {
        const app = boot();
        const { gen } = world(app);
        await tick(app, 30);
        const gens = app.getResource(WorldGenRes);
        expect(gens.status(gen)!.state).toBe('ready');
        const ids = objects(app);
        expect(ids.length).toBeGreaterThan(5);
        expect(new Set(ids).size).toBe(ids.length);
        const plan = gens.plan(gen)!;
        const near = plan.placementsIn(-30, -30, 30, 30).map((p) => p.id);
        for (const id of near) expect(ids).toContain(id);
        for (const id of ids) expect(gens.objectOf(id)).not.toBeNull();
    });

    it('keeps a felled placement felled when its chunk is let go and made again, and forgets nothing else', async () => {
        const app = boot();
        const { source } = world(app);
        await tick(app, 30);
        const gens = app.getResource(WorldGenRes);
        const before = objects(app);
        const felled = before[0]!;
        gens.diffs('planet').remove(felled);
        await tick(app, 5);
        expect(objects(app)).not.toContain(felled);
        expect(objects(app).length).toBe(before.length - 1);
        // Walk away until it is let go, and come back.
        app.world.insert(source, Transform, placed(5000, 0, 0));
        await tick(app, 30);
        expect(objects(app)).not.toContain(before[1]);
        app.world.insert(source, Transform, placed(0, 0, 0));
        await tick(app, 30);
        expect(objects(app).sort()).toEqual(before.filter((id) => id !== felled).sort());
        // And from a save read back into a fresh world.
        const saved = JSON.parse(JSON.stringify(gens.diffs('planet').toJSON()));
        const again = boot();
        world(again);
        again.getResource(WorldGenRes).diffs('planet').load(saved);
        await tick(again, 30);
        expect(objects(again).sort()).toEqual(objects(app).sort());
    });

    it('keeps a zone clear of what it excludes, and only the chunks it reaches change', async () => {
        const app = boot();
        world(app);
        await tick(app, 30);
        const plan = app.getResource(WorldGenRes).plan()!;
        const before = objects(app);
        const home = app.world.spawn();
        app.world.insert(home, Transform, placed(0, 0, 0));
        app.world.insert(home, WorldZone, { ...WorldZone._default, kind: 'home', shape: ZoneShapeKind.Circle, radius: 12, falloff: 0, excludes: '*' });
        await tick(app, 10);
        const after = objects(app);
        expect(after.length).toBeLessThan(before.length);
        for (const id of after) {
            const p = plan.placementsIn(-100, -100, 100, 100).find((q) => q.id === id)!;
            expect(Math.hypot(p.x, p.z)).toBeGreaterThan(12);
        }
        // What stood well away from the home stands there still, under the same id.
        const far = (ids: string[]) => ids.filter((id) => { const p = plan.placementsIn(-100, -100, 100, 100).find((q) => q.id === id); return p && Math.hypot(p.x, p.z) > 50; });
        expect(far(after).sort()).toEqual(far(before).sort());
    });

    it('fails, and places nothing, for rules it does not know or a version they do not have', async () => {
        const app = boot();
        const { gen } = world(app, { rules: 'test:nowhere' });
        const old = world(app, { version: 7 }).gen;
        await tick(app, 10);
        const gens = app.getResource(WorldGenRes);
        expect(gens.status(gen)).toMatchObject({ state: 'failed' });
        expect(gens.status(old)!.reason).toMatch(/version 7/);
        expect(objects(app)).toHaveLength(0);
    });
});

describe('a zone that levels its ground', () => {
    it('lays the terrain flat under it at the height the ground had at its centre, and gives it back when it goes', async () => {
        const app = boot();
        app.addPlugin(new TerrainPlugin());
        const ground = app.world.spawn();
        app.world.insert(ground, Transform, placed(0, 0, 0));
        app.world.insert(ground, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, height: 80, sizeX: 600 });
        world(app);
        const plot = app.world.spawn();
        app.world.insert(plot, Transform, placed(30, 0, -20));
        app.world.insert(plot, WorldZone, { ...WorldZone._default, kind: 'building', shape: ZoneShapeKind.Box, sizeX: 30, sizeZ: 20, falloff: 10, flatten: true });
        await tick(app, 20);
        const terrains = app.getResource(TerrainsRes);
        const level = terrains.heightBeneathAt(30, -20)!;
        for (const [x, z] of [[30, -20], [20, -15], [44, -27]] as const) expect(terrains.heightAt(x, z)).toBeCloseTo(level, 6);
        app.world.despawn(plot);
        await tick(app, 5);
        // On a lattice node the surface is the ground's own sample.
        expect(terrains.heightAt(20, -16)).toBeCloseTo(terrains.heightBeneathAt(20, -16)!, 9);
    });
});
