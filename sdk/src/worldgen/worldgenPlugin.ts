// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldgenPlugin.ts
 * @brief   A generated world in the scene: a `WorldGen` names the game's rules, `WorldZone`s plan it, and what the rules place is
 *          published in chunks round the streaming sources.
 *
 * @details One plan (plan.ts) a WorldGen, read from the terrain's surface and the water, and laid over by the world's changes
 *          (diffs.ts) before anything is shown. Each of the rules' layers is a layer of procedural chunks (residency/chunks.ts), so
 *          it is made nearest first within the frame's budget, let go past its `drawDistance`, and made again with its old chunk kept
 *          until then when the ground or the water changes; a zone or a change touches only the chunks it reaches.
 *
 *            - Decoration is drawn merged: a mesh a chunk for each kind of plant or stone in it.
 *            - What a game interacts with is an entity of its own, carrying a `PlacedObject` with its placement id and kind, so the
 *              game can find it, act on it and record what it did (`diffs.remove(id)` when it is felled).
 *            - The ground is painted by the biomes, when the WorldGen says so.
 *
 *          A server without a renderer makes the plan and the interactive entities, and nothing that is only drawn.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, RuntimeOnly, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { Terrains, TerrainsRes } from '../terrain/terrainPlugin';
import { flattenModifier, type TerrainModifier } from '../terrain/source';
import { buildBillboardMesh, buildInstancedMesh, type Plant } from '../foliage/builder';
import { chunksOf, ProceduralChunksRes, type ChunkLayerStatus } from '../residency/chunks';
import { plantGrowthOf, prepareKinds, type GrownCell, type ReadyKinds } from '../foliage/plantGrowth';
import { Environment } from './fields';
import { expandPlants, type PlantSet } from './plants';
import { WorldPlan, type Placement } from './plan';
import { worldRules, worldRulesRevision, type PlacementLayer, type RecipeMember, type WorldRules } from './rules';
import { Zones, type ZoneDef } from './zones';
import { PlacementDiffs } from './diffs';
import { isRulesFile } from './rulesAsset';

/** The fields of the `WorldGen` component. @experimental */
export interface WorldGenData {
    /** The rules the world is laid out by, as the game registered them, and the version of them the world was made with. */
    rules: string;
    version: number;
    /** The world (a planet, a level) as the game names it, and its seed. */
    world: string;
    seed: number;
    /** Whether the biomes paint the terrain. */
    paintGround: boolean;
}

/**
 * A generated world: the rules it is laid out by. Presence is the opt-in; what the rules place is published as its children.
 *
 * @experimental
 */
export const WorldGen: ComponentDef<WorldGenData> = defineComponent<WorldGenData>('WorldGen', {
    rules: '', version: 1, world: '', seed: 1, paintGround: true,
}, {
    fields: {
        rules: { tooltip: 'The rules the world is laid out by: a .esworld file, or the id of rules the game registered with registerWorldRules.' },
        version: { min: 1, step: 1, tooltip: 'The version of the rules the world was made with. A version the rules no longer have fails the world rather than laying out another one.' },
        world: { tooltip: 'The world (a planet, a level) as the game names it.' },
        seed: { step: 1, tooltip: 'Another seed lays out another world by the same rules.' },
        paintGround: { tooltip: 'Whether the biomes paint the terrain.' },
    },
});

/** How a `WorldZone` is shaped. */
export const ZoneShapeKind = { Circle: 0, Box: 1 } as const;

/** The fields of the `WorldZone` component. @experimental */
export interface WorldZoneData {
    /** What the zone is for (home, road, landing, building, resource, view): the game's own words. */
    kind: string;
    shape: number;
    radius: number;
    sizeX: number;
    sizeZ: number;
    /** Over how many world units past its outline it fades out. */
    falloff: number;
    priority: number;
    /** The tags of what it keeps out, separated by commas; `*` keeps out everything. */
    excludes: string;
    /** A biome it holds over its area; empty holds none. */
    biome: string;
    /** Whether it levels the terrain under it to the ground's height at its centre. */
    flatten: boolean;
}

/**
 * An area of a generated world planned by hand: kept clear, held to a biome, or both. It follows its entity's position and its turn
 * about the vertical.
 *
 * @experimental
 */
export const WorldZone: ComponentDef<WorldZoneData> = defineComponent<WorldZoneData>('WorldZone', {
    kind: 'reserve', shape: ZoneShapeKind.Circle, radius: 10, sizeX: 20, sizeZ: 20, falloff: 4, priority: 0, excludes: '*', biome: '', flatten: false,
}, {
    fields: {
        kind: { tooltip: 'What the zone is for (home, road, landing, building, resource, view): the game\'s own words.' },
        shape: { enum: [{ label: 'Circle', value: ZoneShapeKind.Circle }, { label: 'Box', value: ZoneShapeKind.Box }] },
        radius: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Circle] }, tooltip: 'The circle\'s radius, in world units.' },
        sizeX: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Box] }, tooltip: 'The box\'s size along its own x.' },
        sizeZ: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Box] }, tooltip: 'The box\'s size along its own z.' },
        falloff: { min: 0, tooltip: 'Over how many world units past the outline the zone fades out: what it keeps out thins there.' },
        priority: { step: 1, tooltip: 'Where zones overlap, the higher priority holds the biome.' },
        excludes: { tooltip: 'The tags of what the zone keeps out, separated by commas (a layer, a recipe, its tags, decor, interactive); * keeps out everything; empty keeps nothing out.' },
        biome: { tooltip: 'A biome the zone holds over its area; empty holds none.' },
        flatten: { tooltip: 'Level the terrain under the zone to the ground\'s height at its centre, blending back over its falloff: a plot to build on.' },
    },
});

/** The fields of the `PlacedObject` component. @experimental */
export interface PlacedObjectData {
    /** The placement's id: what a save records when the game changes it. */
    id: string;
    /** What the game interacts with it as. */
    kind: string;
}

/**
 * Marks an entity a generated world placed for the game to interact with. Written by the engine; a scene does not author it.
 *
 * @experimental
 */
export const PlacedObject: ComponentDef<PlacedObjectData> = defineComponent<PlacedObjectData>('PlacedObject', { id: '', kind: '' });

/** Where a WorldGen stands: being made, ready, or failed (with why); and each of its layers' chunks. */
export interface WorldGenStatus {
    state: 'loading' | 'ready' | 'failed';
    reason?: string;
    layers: Record<string, ChunkLayerStatus>;
}

interface BuiltWorld {
    signature: string;
    data: WorldGenData;
    rules: WorldRules | null;
    plan: WorldPlan | null;
    /** The same plan with the sparser spacing the layers that have a `farSpacing` are planned at for their far versions; null when none has one. */
    farPlan: WorldPlan | null;
    failure: string | null;
    /** The terrain's and the water's revisions the plan was read from. */
    ground: string;
    /** The zones' revision the authored zones were last synced at. */
    authored: Set<string>;
    /** Zones that level their ground and wait for it to be known. */
    levelling: Set<string>;
    /** The rules' plants as kinds, and their parts once the assets are in hand (null while they are being loaded, or when the rules have no plants). */
    plants: PlantSet | null;
    plantsReady: ReadyKinds | null;
}

/** A chunk of a layer: what it places (its decoration merged by mesh, its interactive placements), and what it put in the world. */
interface PlacedChunk {
    /** A kind of decoration: its near mesh and, when it has one, its far cards; drawn near out to `lodDistance`, out to `drawDistance`. */
    decor: { mesh: number; material: number; data: MeshData; far: MeshData | null; origin: [number, number, number]; radius: number; lodDistance: number; drawDistance: number }[];
    objects: Placement[];
    /** The plants of the rules' `plants` in it, by kind, standing relative to `at` (the chunk's centre), and what grew them once published. */
    planted: Map<number, Plant[]> | null;
    at: [number, number, number];
    /** The chunk's side. */
    side: number;
    grown: GrownCell | null;
    /** Made for the far layer: only the far versions of its plants, which are shown from past what their kinds draw as themselves. */
    far: boolean;
    /** How many times thinner than the layer's own spacing the plants were planned (its `farSpacing` squared): the far version does not thin them again. */
    thinnedBy: number;
    entities: Entity[];
    meshes: number[];
}

/** The water, as worldgen asks it (the water module is optional: read by name, not imported). */
interface WaterQuery { depthAt(x: number, z: number, y: number): number | null; shoreAt?(x: number, z: number): number | null; revision_: number; baking: boolean }

function waterOf(app: App): WaterQuery | null {
    const w = (app as unknown as { getResourceByName?: (name: string) => unknown }).getResourceByName?.('Waters') as Partial<WaterQuery> | undefined;
    return w && typeof w.depthAt === 'function' ? w as WaterQuery : null;
}

const layerIdOf = (entity: Entity, layer: string): string => `worldgen:${entity}:${layer}`;
const zoneIdOf = (entity: Entity): string => `zone:${entity}`;

/** Run-time access to the generated worlds. */
export class WorldGens {
    /** @internal */ readonly built_ = new Map<Entity, BuiltWorld>();
    /** @internal */ app_: App | null = null;
    private readonly zones_ = new Map<string, Zones>();
    private readonly diffs_ = new Map<string, PlacementDiffs>();
    /** @internal The interactive entity of each placement id published now. */
    readonly objects_ = new Map<string, Entity>();

    /** The zones of a world (by its name), which a game adds to as it plans and builds. Shared by every WorldGen of that world. */
    zones(world = this.first_()?.data.world ?? ''): Zones {
        let z = this.zones_.get(world);
        if (!z) { z = new Zones(); this.zones_.set(world, z); }
        return z;
    }

    /** The changes made to a world (by its name), which a save stores and reads back. */
    diffs(world = this.first_()?.data.world ?? ''): PlacementDiffs {
        let d = this.diffs_.get(world);
        if (!d) { d = new PlacementDiffs(); this.diffs_.set(world, d); }
        return d;
    }

    /** A WorldGen's plan, or the first one's: what stands where, asked of anywhere, loaded or not. Null until it is made or if it failed. */
    plan(entity?: Entity): WorldPlan | null {
        return (entity !== undefined ? this.built_.get(entity) : this.first_())?.plan ?? null;
    }

    /** The interactive entity standing for placement `id`, or null where its chunk is not published or the placement is removed. */
    objectOf(id: string): Entity | null {
        return this.objects_.get(id) ?? null;
    }

    status(entity: Entity): WorldGenStatus | null {
        const built = this.built_.get(entity);
        if (!built) return null;
        const layers: Record<string, ChunkLayerStatus> = {};
        const chunks = this.app_?.hasResource(ProceduralChunksRes) ? this.app_.getResource(ProceduralChunksRes) : null;
        for (const l of built.rules?.layers ?? []) {
            const s = chunks?.status(layerIdOf(entity, l.id));
            if (s) layers[l.id] = s;
        }
        if (built.failure) return { state: 'failed', reason: built.failure, layers };
        return { state: built.plan ? 'ready' : 'loading', layers };
    }

    private first_(): BuiltWorld | undefined {
        return this.built_.values().next().value;
    }
}

/** The resource the plugin installs. @experimental */
export const WorldGenRes = defineResource<WorldGens>(new WorldGens(), 'WorldGens');

/**
 * Runs an asset load again when it fails, a few times and a little later each time. Reading a project's files is slowest while the project is still being
 * opened (the asset database is scanned and cooked against it), and a load that waited out its timeout then is not a world that cannot be shown.
 */
async function retried<T>(load: () => Promise<T>, attempts = 5): Promise<T> {
    for (let n = 1; ; n++) {
        try { return await load(); } catch (error) {
            if (n >= attempts) throw error;
            log.warn('worldgen', `loading the world's assets failed (${error instanceof Error ? error.message : String(error)}); trying again`);
            await new Promise<void>((resolve) => setTimeout(resolve, 2000 * n));
        }
    }
}

export class WorldGenPlugin implements Plugin {
    name = 'worldgen';

    /** Stops listening for edited rules files. */
    private watching_: (() => void) | null = null;

    /** Each mesh's geometry, read once, for drawing it merged. */
    private readonly meshData_ = new Map<number, MeshData | null | Promise<MeshData | null>>();

    build(app: App): void {
        const gens = new WorldGens();
        gens.app_ = app;
        app.insertResource(WorldGenRes, gens);
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            this.sweep(app, gens);
            for (const entity of app.world.getEntitiesWithComponents([WorldGen, Transform])) {
                const data = app.world.get(entity, WorldGen) as WorldGenData;
                const signature = `${JSON.stringify(data)}#${worldRulesRevision()}`;
                let built = gens.built_.get(entity);
                if (!built || built.signature !== signature) {
                    built = this.make(app, gens, entity, data, built);
                    gens.built_.set(entity, built);
                }
                this.syncZones(app, gens, entity, built);
                this.publish(app, gens, entity, built);
            }
        }, { name: 'WorldGenSystem' }));
    }

    cleanup(app?: App): void {
        this.watching_?.();
        this.watching_ = null;
        if (!app?.hasResource(WorldGenRes)) return;
        const gens = app.getResource(WorldGenRes);
        for (const entity of [...gens.built_.keys()]) this.drop(app, gens, entity);
    }

    /** A WorldGen's rules and plan, or why it has none. */
    private make(app: App, gens: WorldGens, entity: Entity, data: WorldGenData, had: BuiltWorld | undefined): BuiltWorld {
        const built: BuiltWorld = { signature: `${JSON.stringify(data)}#${worldRulesRevision()}`, data: { ...data }, rules: null, plan: null, farPlan: null, failure: null, ground: '', authored: had?.authored ?? new Set(), levelling: new Set(), plants: null, plantsReady: null };
        // Rules in a project file are read first, then made like rules registered by code.
        if (isRulesFile(data.rules)) {
            if (!app.hasResource(Assets)) {
                built.failure = `the world rules file ${data.rules} cannot be read without an asset system: register its rules in code instead`;
                log.error('worldgen', built.failure);
                return built;
            }
            const assets = app.getResource(Assets);
            // A rules file edited and saved is read again, and the world laid out by it again (its old chunks kept until then).
            if (!this.watching_) {
                this.watching_ = assets.onInvalidate(({ ref }) => {
                    const changed = assets.resolveLoadPath(ref);
                    for (const b of gens.built_.values()) if (isRulesFile(b.data.rules) && assets.resolveLoadPath(b.data.rules) === changed) b.signature = '';
                });
            }
            void assets.load<WorldRules>('world-rules', data.rules).then((rules) => {
                if (gens.built_.get(entity) !== built) return;
                this.adopt(app, gens, entity, built, rules, had);
            }, (e: unknown) => {
                if (gens.built_.get(entity) !== built) return;
                built.failure = `the world rules file ${data.rules} could not be read: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
            return built;
        }
        const rules = worldRules(data.rules);
        if (!rules) {
            built.failure = `no world rules ${data.rules || '(none named)'} are registered`;
            log.error('worldgen', `the world ${data.world} cannot be laid out: ${built.failure}`);
            for (const l of had?.rules?.layers ?? []) chunksOf(app).remove(layerIdOf(entity, l.id));
            return built;
        }
        this.adopt(app, gens, entity, built, rules, had);
        return built;
    }

    /** Takes a WorldGen's rules, once they are known: checks the version, and makes the plan (loading what the recipes name first). */
    private adopt(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, rules: WorldRules, had: BuiltWorld | undefined): void {
        const data = built.data;
        if (!rules.versions.includes(data.version)) built.failure = `the world rules ${rules.id} have no version ${data.version} (they have ${rules.versions.join(', ')})`;
        else built.rules = rules;
        if (built.failure) {
            log.error('worldgen', `the world ${data.world} cannot be laid out: ${built.failure}`);
            // A world that cannot be laid out shows nothing of the one before it.
            for (const l of had?.rules?.layers ?? []) { chunksOf(app).remove(layerIdOf(entity, l.id)); chunksOf(app).remove(layerIdOf(entity, `${l.id}:far`)); }
            return;
        }
        // Layers the new rules no longer have are let go; the ones they keep keep their chunks until they are made again.
        for (const l of had?.rules?.layers ?? []) if (!rules.layers.some((n) => n.id === l.id)) { chunksOf(app).remove(layerIdOf(entity, l.id)); chunksOf(app).remove(layerIdOf(entity, `${l.id}:far`)); }
        // The plants the recipes name: as kinds, and their parts read once there is a renderer to grow them with. A chunk waits for them.
        if (rules.plants && Object.keys(rules.plants).length > 0 && app.hasResource(Assets)) {
            const set = expandPlants(rules.plants);
            built.plants = set;
            void retried(() => prepareKinds(app.getResource(Assets), set.kinds)).then((ready) => {
                if (gens.built_.get(entity) === built) built.plantsReady = ready;
            }, (e: unknown) => {
                built.failure = `the plants' assets could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
        }
        // Recipes name their meshes and materials by path: with a renderer they are loaded first, and the plan is made with them.
        const refs = assetRefsOf(rules);
        if (refs.length > 0 && app.hasResource(Assets)) {
            void retried(() => this.resolve(app, rules, refs)).then((resolved) => {
                if (gens.built_.get(entity) !== built) return;
                built.rules = resolved;
                this.plan(app, gens, entity, built, resolved);
            }, (e: unknown) => {
                built.failure = `the recipes' assets could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
            return;
        }
        this.plan(app, gens, entity, built, rules);
    }

    /** Loads the meshes and materials `refs` name, and gives back the rules with each path replaced by its handle. */
    private async resolve(app: App, rules: WorldRules, refs: { kind: 'mesh' | 'material'; ref: string }[]): Promise<WorldRules> {
        const assets = app.getResource(Assets);
        const handles = new Map<string, number>();
        await Promise.all(refs.map(async ({ kind, ref }) => {
            const handle = kind === 'mesh' ? (await assets.load<{ handle: number }>('mesh', ref)).handle : (await assets.loadMaterial(ref)).handle;
            handles.set(`${kind}:${ref}`, handle);
        }));
        const member = (m: RecipeMember): RecipeMember => ({
            ...m,
            mesh: typeof m.mesh === 'string' ? handles.get(`mesh:${m.mesh}`) ?? 0 : m.mesh,
            material: typeof m.material === 'string' ? handles.get(`material:${m.material}`) ?? 0 : m.material,
        });
        return { ...rules, recipes: rules.recipes.map((r) => ({ ...r, anchor: member(r.anchor), members: r.members?.map(member) })) };
    }

    /** Makes a WorldGen's plan from its rules, and what keeps it current. */
    private plan(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, rules: WorldRules): void {
        const data = built.data;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const zones = gens.zones(data.world);
        // The terrain's paint is a field for each of its layers, `paint.grass` for a layer file grass.esterrainlayer: how much of the ground there is that.
        const paintFields: Record<string, (x: number, z: number) => number> = {};
        if (terrains) terrains.layerNames().forEach((name, i) => { paintFields[`paint.${name}`] = (x, z) => terrains.paintAt(x, z)?.[i] ?? 0; });
        const env = new Environment({
            seed: data.seed, noise: rules.noise, fields: { ...paintFields, ...rules.fields },
            ground: (x, z) => {
                if (terrains && terrains.built_.size > 0) {
                    const y = terrains.heightAt(x, z);
                    if (y === null) return null;
                    const n = terrains.normalAt(x, z) ?? [0, 1, 0];
                    return { y, up: n[1], normal: n };
                }
                // No terrain: the world is flat at the WorldGen's own height.
                const t = app.world.tryGet(entity, Transform) as TransformData | null;
                return { y: t?.worldPosition.y ?? 0, up: 1, normal: [0, 1, 0] };
            },
            waterDepth: (x, z, y) => waterOf(app)?.depthAt(x, z, y) ?? null,
            shoreDistance: (x, z) => waterOf(app)?.shoreAt?.(x, z) ?? null,
            overrides: (x, z) => {
                const out: { field: string; value: number; weight: number }[] = [];
                for (const { zone, weight } of zones.at(x, z)) for (const [field, value] of Object.entries(zone.fields ?? {})) out.push({ field, value, weight });
                return out;
            },
        });
        built.plan = new WorldPlan(rules, env, zones, data.seed, data.world);
        const plan = built.plan;
        const sparse = rules.layers.some((l) => (l.farSpacing ?? 1) > 1);
        built.farPlan = sparse
            ? new WorldPlan({ ...rules, layers: rules.layers.map((l) => (l.farSpacing ?? 1) > 1 ? { ...l, spacing: l.spacing * l.farSpacing! } : l) }, env, zones, data.seed, data.world)
            : null;
        // A zone that changes, or a placement a player changes, makes again only the chunks it reaches.
        zones.onChange = (bounds, zone) => {
            plan.invalidate();
            built.farPlan?.invalidate();
            const chunks = chunksOf(app);
            for (const l of rules.layers) {
                // A group kept out lets a neighbour it had beaten stand, which may beat its own: a few cells round are made again.
                const reach = l.spacing * 3;
                chunks.invalidate(layerIdOf(entity, l.id), bounds[0] - reach, bounds[1] - reach, bounds[2] + reach, bounds[3] + reach);
            }
            // A zone that holds a biome or sets a field changes the ground's paint under it.
            if (terrains && data.paintGround && (zone.biome || zone.fields)) terrains.repaint();
            // One that levels its ground lays a modifier on the terrain, and takes it off when it goes or stops levelling.
            if (terrains) {
                const now = zones.get(zone.id);
                if (now?.flatten !== undefined) this.level(terrains, built, now);
                else {
                    built.levelling.delete(zone.id);
                    if (terrains.modifiers_.has(`zone:${zone.id}`)) terrains.deleteModifier(`zone:${zone.id}`);
                }
            }
        };
        gens.diffs(data.world).onChange = (id) => {
            const at = this.anchorOf(plan, id);
            if (at) chunksOf(app).invalidate(layerIdOf(entity, at.layer), at.x, at.z, at.x, at.z);
        };
        if (terrains) terrains.setPaint(data.paintGround ? this.painter(plan) : null);
        // Zones that were there before the plan was made level their ground now.
        if (terrains) for (const zone of zones.all()) if (zone.flatten !== undefined) this.level(terrains, built, zone);
    }

    /** Levels a zone's ground, or (the ground under its centre not known yet) keeps it to level once it is. */
    private level(terrains: Terrains, built: BuiltWorld, zone: ZoneDef): void {
        const modifier = levelling(terrains, zone);
        if (modifier) { terrains.setModifier(modifier); built.levelling.delete(zone.id); } else built.levelling.add(zone.id);
    }

    /** The ground's paint by a plan's biomes. */
    private painter(plan: WorldPlan) {
        return (x: number, z: number, _h: number, _ny: number, w: readonly number[]) => plan.paint(x, z, w);
    }

    /** Where the group of placement `id` is anchored, from the layer and grid cell its id names. */
    private anchorOf(plan: WorldPlan, id: string): { layer: string; x: number; z: number } | null {
        const m = /^(.+)@\d+:(-?\d+),(-?\d+)\//.exec(id);
        if (!m) return null;
        const li = plan.layerIndex(m[1]!);
        if (li < 0) return null;
        const g = plan.group(li, Number(m[2]), Number(m[3]));
        return typeof g === 'string' ? null : { layer: m[1]!, x: g.x, z: g.z };
    }

    /** Puts the authored `WorldZone`s into their world's zones. */
    private syncZones(app: App, gens: WorldGens, _entity: Entity, built: BuiltWorld): void {
        const zones = gens.zones(built.data.world);
        const seen = new Set<string>();
        for (const e of app.world.getEntitiesWithComponents([WorldZone, Transform])) {
            const z = app.world.get(e, WorldZone) as WorldZoneData;
            const t = app.world.get(e, Transform) as TransformData;
            const p = t.worldPosition, q = t.worldRotation;
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            const def: ZoneDef = {
                id: zoneIdOf(e), kind: z.kind, falloff: z.falloff, priority: z.priority,
                shape: z.shape === ZoneShapeKind.Box
                    ? { type: 'rect', x: p.x, z: p.z, halfX: z.sizeX / 2, halfZ: z.sizeZ / 2, yaw: -yaw }
                    : { type: 'circle', x: p.x, z: p.z, radius: z.radius },
                excludes: z.excludes.split(',').map((s) => s.trim()).filter(Boolean),
                ...(z.biome ? { biome: z.biome } : {}),
                ...(z.flatten ? { flatten: 'ground' as const } : {}),
            };
            zones.set(def);
            seen.add(def.id);
        }
        for (const id of built.authored) if (!seen.has(id)) zones.delete(id);
        built.authored = seen;
    }

    /** Hands each of the rules' layers to the chunks, made from the plan. */
    private publish(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld): void {
        const plan = built.plan, rules = built.rules;
        if (!plan || !rules) return;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const water = waterOf(app);
        // What the plan read the ground and the water from: when either changes everything is read again.
        const ground = `${terrains?.revision_ ?? 0}:${water?.revision_ ?? 0}`;
        if (ground !== built.ground) { plan.invalidate(); built.farPlan?.invalidate(); built.ground = ground; }
        const waiting = !!terrains?.loading || !!water?.baking;
        if (terrains) {
            for (const id of [...built.levelling]) {
                const zone = gens.zones(built.data.world).get(id);
                if (zone?.flatten !== undefined) this.level(terrains, built, zone); else built.levelling.delete(id);
            }
        }
        const diffs = gens.diffs(built.data.world);
        const rendering = app.hasResource(Assets);
        const chunks = chunksOf(app);
        // A world on a terrain of an area ends where the terrain does: its chunks are counted over that, and not over a radius of empty world.
        const bounds = terrains?.areaBounds() ?? null;
        for (const layer of rules.layers) {
            const size = layer.chunkSize ?? 64;
            const extent: [number, number, number, number] | null = bounds
                ? [Math.floor(bounds[0] / size), Math.floor(bounds[1] / size), Math.ceil(bounds[2] / size), Math.ceil(bounds[3] / size)] : null;
            chunks.set<PlacedChunk>(layerIdOf(entity, layer.id), {
                label: 'Laying out the world',
                originX: 0, originZ: 0, sizeX: size, sizeZ: size, extent,
                loadRadius: layer.drawDistance, unloadRadius: layer.drawDistance + size,
                generation: `${built.signature}:${ground}`,
                make: (cx, cz) => {
                    const x0 = cx * size, z0 = cz * size;
                    if (waiting || (terrains && ![[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]].every(([x, z]) => terrains.groundKnownAt(x!, z!)))) return null;
                    // The plants' parts are read before any chunk: a chunk made without them would leave the plants out until it is made again.
                    if (rendering && built.plants && !built.plantsReady) return null;
                    return this.chunk(app, plan, diffs, layer, x0, z0, size, rendering, built.plants);
                },
                publish: (_cx, _cz, value) => this.place(app, gens, entity, value),
                release: (_cx, _cz, value) => this.unplace(app, gens, value),
            });
            // The plants' far versions are a layer of their own, wanted as far as the furthest of them goes: they are cheap, so the whole world stands at once,
            // where the plants themselves are only grown near the eye. They are shown from past what their kinds draw as themselves.
            const farId = layerIdOf(entity, `${layer.id}:far`);
            if (!rendering || !built.plants || built.plants.reach <= layer.drawDistance) { chunks.remove(farId); continue; }
            // A far cell is as many chunks wide as the shortest span a far version is shown over allows: the far versions are one draw a kind a cell, and a ring
            // of ground cover a few chunks wide would otherwise be thousands of them.
            const farSide = Math.min(Math.max(Math.floor(built.plants.span / size), 1), 2);
            const fsize = size * farSide;
            const fextent: [number, number, number, number] | null = bounds
                ? [Math.floor(bounds[0] / fsize), Math.floor(bounds[1] / fsize), Math.ceil(bounds[2] / fsize), Math.ceil(bounds[3] / fsize)] : null;
            chunks.set<PlacedChunk>(farId, {
                label: 'Laying out the far plants',
                originX: 0, originZ: 0, sizeX: fsize, sizeZ: fsize, extent: fextent,
                loadRadius: built.plants.reach, unloadRadius: built.plants.reach + fsize,
                generation: `${built.signature}:${ground}`,
                make: (cx, cz) => {
                    const x0 = cx * fsize, z0 = cz * fsize;
                    if (waiting || (terrains && ![[x0, z0], [x0 + fsize, z0], [x0, z0 + fsize], [x0 + fsize, z0 + fsize]].every(([x, z]) => terrains.groundKnownAt(x!, z!)))) return null;
                    if (!built.plantsReady) return null;
                    const sparse = (layer.farSpacing ?? 1) > 1 && built.farPlan;
                    return this.chunk(app, sparse ? built.farPlan! : plan, diffs, layer, x0, z0, fsize, rendering, built.plants, true, sparse ? layer.farSpacing! ** 2 : 1);
                },
                publish: (_cx, _cz, value) => this.place(app, gens, entity, value),
                release: (_cx, _cz, value) => this.unplace(app, gens, value),
            });
        }
    }

    /** What one chunk of a layer places: its decoration merged by mesh, and its interactive placements, with the changes laid over. */
    private chunk(app: App, plan: WorldPlan, diffs: PlacementDiffs, layer: PlacementLayer, x0: number, z0: number, size: number,
                  rendering: boolean, plants: PlantSet | null, far = false, thinnedBy = 1): PlacedChunk | Promise<PlacedChunk> {
        const placements: Placement[] = [];
        for (const p of plan.placementsIn(x0, z0, x0 + size, z0 + size, [layer.id])) {
            if (diffs.isRemoved(p.id)) continue;
            const c = diffs.changeOf(p.id);
            placements.push(c ? { ...p, ...c } : p);
        }
        const objects = far ? [] : placements.filter((p) => p.interactive !== null);
        const decor = rendering && !far ? placements.filter((p) => p.interactive === null && p.mesh) : [];
        const meshes = [...new Set(decor.map((p) => p.mesh))];
        const finish = (): PlacedChunk => {
            const out: PlacedChunk = { decor: [], objects, planted: null, at: [x0 + size / 2, 0, z0 + size / 2], side: size, grown: null, far, thinnedBy, entities: [], meshes: [] };
            // The plants: each at its kind (its colouring there), relative to the chunk's centre, sunk by what its kind says.
            if (plants && rendering) {
                const by = new Map<number, Plant[]>();
                for (const p of placements) {
                    if (p.interactive !== null || p.plant === null) continue;
                    const k = plants.kindAt(p.plant, p.x, p.z);
                    if (k < 0) continue;
                    let list = by.get(k);
                    if (!list) by.set(k, list = []);
                    list.push({ x: p.x - out.at[0], y: p.y - plants.sinkOf(p.plant), z: p.z - out.at[2], yaw: p.yaw, scale: p.scale * plants.unitOf(p.plant), phase: 0, shade: 1,
                        ...(p.attach === 'align' ? { up: p.normal } : {}) });
                }
                if (by.size > 0) out.planted = by;
            }
            const byKind = new Map<string, Placement[]>();
            for (const p of decor) {
                const k = `${p.mesh}:${p.material}`;
                let list = byKind.get(k);
                if (!list) byKind.set(k, list = []);
                list.push(p);
            }
            const origin: [number, number, number] = [x0 + size / 2, 0, z0 + size / 2];
            for (const list of byKind.values()) {
                const source = this.meshData_.get(list[0]!.mesh);
                if (!source || source instanceof Promise) continue;
                const plants: Plant[] = list.map((p, i) => ({
                    x: p.x - origin[0], y: p.y, z: p.z - origin[2], yaw: p.yaw, scale: p.scale, phase: (i * 0.618) % 1, shade: 1,
                    ...(p.attach === 'align' ? { up: p.normal } : {}),
                }));
                const far = list[0]!.far;
                const width = Math.max(source.aabbMax[0] - source.aabbMin[0], source.aabbMax[2] - source.aabbMin[2]);
                out.decor.push({
                    mesh: list[0]!.mesh, material: list[0]!.material, data: buildInstancedMesh(source, plants), origin,
                    far: far ? buildBillboardMesh(plants, width, source.aabbMax[1] - source.aabbMin[1], far, undefined, far.tent === true) : null,
                    radius: Math.SQRT2 * size / 2, lodDistance: layer.lodDistance ?? layer.drawDistance, drawDistance: layer.drawDistance,
                });
            }
            return out;
        };
        const missing = meshes.filter((m) => !this.meshData_.has(m) || this.meshData_.get(m) instanceof Promise);
        if (missing.length === 0) return finish();
        const assets = app.getResource(Assets);
        return Promise.all(missing.map((m) => {
            let got = this.meshData_.get(m);
            if (got === undefined) {
                const read = assets.readMeshData(m).catch(() => null).then((d) => {
                    if (!d) log.warn('worldgen', `the geometry of mesh ${m} cannot be read, so what it draws is left out`);
                    this.meshData_.set(m, d);
                    return d;
                });
                this.meshData_.set(m, read);
                got = read;
            }
            return got;
        })).then(finish);
    }

    /** Puts a chunk in the world: a mesh a kind of decoration, an entity an interactive placement. */
    private place(app: App, gens: WorldGens, parent: Entity, chunk: PlacedChunk): void {
        const world = app.world;
        if (!world.valid(parent)) return;
        const base = (world.get(parent, Transform) as TransformData).worldPosition;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        const built = gens.built_.get(parent);
        if (chunk.planted && built?.plants && built.plantsReady) {
            // The plants of the chunk: its entity stands at once, and they grow in it over the frames, as a placed foliage's do.
            const e = world.spawn('WorldGenPlants');
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, { position: { x: chunk.at[0] - base.x, y: -base.y, z: chunk.at[2] - base.z } });
            world.setParent(e, parent);
            chunk.entities.push(e);
            chunk.grown = { entity: e, handles: [], dead: false };
            const growth = plantGrowthOf(app);
            if (chunk.far) growth.growFar(app, chunk.grown, built.plants.kinds, built.plantsReady, chunk.planted, { x: chunk.at[0], z: chunk.at[2], half: chunk.side / 2 }, chunk.thinnedBy);
            else growth.growCell(app, chunk.grown, built.plants.kinds, built.plantsReady, chunk.planted);
        }
        for (const d of chunk.decor) {
            const handle = assets?.createMesh(d.data) ?? 0;
            if (!handle) continue;
            chunk.meshes.push(handle);
            const farHandle = d.far ? assets?.createMesh(d.far) ?? 0 : 0;
            if (farHandle) chunk.meshes.push(farHandle);
            const e = world.spawn('WorldGenDecor');
            // Made again from the rules whenever its chunk is: a scene or a save never holds it.
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, { position: { x: d.origin[0] - base.x, y: -base.y, z: d.origin[2] - base.z } });
            world.insert(e, MeshRenderer, {
                mesh: handle, material: d.material, lit: true, opaque: true, cullBackfaces: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
            const lodDef = getComponent('LODGroup');
            if (lodDef) {
                // Measured as the engine measures it, by the share of the screen the chunk's sphere covers, for a 60 degree view.
                const sizeAt = (distance: number): number => d.radius / (Math.max(1, distance) * 0.577);
                world.insert(e, lodDef, {
                    lod1: farHandle, lod2: 0, lod3: 0, lod1Size: farHandle ? sizeAt(d.lodDistance) : 0, lod2Size: 0, lod3Size: 0,
                    cullSize: sizeAt(d.drawDistance + d.radius), hysteresis: 0.1, enabled: true,
                });
            }
            world.setParent(e, parent);
            chunk.entities.push(e);
        }
        for (const p of chunk.objects) {
            const e = world.spawn(`${p.interactive} ${p.id}`);
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, {
                position: { x: p.x - base.x, y: p.y - base.y, z: p.z - base.z },
                rotation: orientation(p),
                scale: { x: p.scale, y: p.scale, z: p.scale },
            });
            if (assets && p.mesh) {
                world.insert(e, MeshRenderer, {
                    mesh: p.mesh, material: p.material, lit: true, opaque: true, color: { r: 1, g: 1, b: 1, a: 1 },
                } as Partial<MeshRendererData>);
            }
            world.insert(e, PlacedObject, { id: p.id, kind: p.interactive! });
            world.setParent(e, parent);
            chunk.entities.push(e);
            gens.objects_.set(p.id, e);
        }
    }

    private unplace(app: App, gens: WorldGens, chunk: PlacedChunk): void {
        if (chunk.grown) { plantGrowthOf(app).release(app, chunk.grown); chunk.grown = null; }
        const mine = new Set(chunk.entities);
        for (const p of chunk.objects) if (mine.has(gens.objects_.get(p.id)!)) gens.objects_.delete(p.id);
        for (const e of chunk.entities) if (app.world.valid(e)) app.world.despawn(e);
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const h of chunk.meshes) assets?.releaseBuiltMesh(h);
        chunk.entities.length = 0;
        chunk.meshes.length = 0;
    }

    private drop(app: App, gens: WorldGens, entity: Entity): void {
        const built = gens.built_.get(entity);
        if (app.hasResource(ProceduralChunksRes)) {
            for (const l of built?.rules?.layers ?? []) { app.getResource(ProceduralChunksRes).remove(layerIdOf(entity, l.id)); app.getResource(ProceduralChunksRes).remove(layerIdOf(entity, `${l.id}:far`)); }
        }
        if (built && app.hasResource(TerrainsRes)) app.getResource(TerrainsRes).setPaint(null);
        gens.built_.delete(entity);
    }

    private sweep(app: App, gens: WorldGens): void {
        for (const entity of [...gens.built_.keys()]) {
            if (app.world.valid(entity) && app.world.has(entity, WorldGen)) continue;
            this.drop(app, gens, entity);
        }
    }
}

/** The modifier a levelling zone lays on the terrain: its outline, to its height or the ground's at its centre, over its falloff. */
function levelling(terrains: Terrains, zone: ZoneDef): TerrainModifier | null {
    const s = zone.shape;
    const height = zone.flatten === 'ground' ? terrains.heightBeneathAt(s.x, s.z) : zone.flatten!;
    return height === null || height === undefined ? null : flattenModifier(`zone:${zone.id}`, s, height, zone.falloff);
}

/** The meshes and materials a rule set's recipes name by path. */
function assetRefsOf(rules: WorldRules): { kind: 'mesh' | 'material'; ref: string }[] {
    const seen = new Map<string, { kind: 'mesh' | 'material'; ref: string }>();
    for (const r of rules.recipes) for (const m of [r.anchor, ...(r.members ?? [])]) {
        if (typeof m.mesh === 'string' && m.mesh) seen.set(`mesh:${m.mesh}`, { kind: 'mesh', ref: m.mesh });
        if (typeof m.material === 'string' && m.material) seen.set(`material:${m.material}`, { kind: 'material', ref: m.material });
    }
    return [...seen.values()];
}

/** A placement's turn: about the vertical, and leaning with the ground when it is aligned. */
function orientation(p: Placement): { x: number; y: number; z: number; w: number } {
    const half = p.yaw / 2;
    const yawQ = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    if (p.attach !== 'align') return yawQ;
    // The turn that takes up to the normal, after the yaw.
    const [nx, ny, nz] = p.normal;
    const ax = nz, az = -nx, s = Math.hypot(ax, az);
    if (s < 1e-6) return yawQ;
    const angle = Math.acos(Math.min(Math.max(ny, -1), 1)) / 2;
    const tilt = { x: (ax / s) * Math.sin(angle), y: 0, z: (az / s) * Math.sin(angle), w: Math.cos(angle) };
    return {
        x: tilt.w * yawQ.x + tilt.x * yawQ.w + tilt.y * yawQ.z - tilt.z * yawQ.y,
        y: tilt.w * yawQ.y - tilt.x * yawQ.z + tilt.y * yawQ.w + tilt.z * yawQ.x,
        z: tilt.w * yawQ.z + tilt.x * yawQ.y - tilt.y * yawQ.x + tilt.z * yawQ.w,
        w: tilt.w * yawQ.w - tilt.x * yawQ.x - tilt.y * yawQ.y - tilt.z * yawQ.z,
    };
}

export const worldGenPlugin: Plugin = new WorldGenPlugin();
