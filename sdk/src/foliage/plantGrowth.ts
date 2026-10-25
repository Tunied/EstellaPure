// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plantGrowth.ts
 * @brief   Growing plants a cell at a time inside the frame's budget: what `PlacedFoliage` and a generated world's plants share.
 *
 * @details A cell is an entity that stands at once, empty, and fills in over the frames after it. Every kind in it and every part of that kind is
 *          ONE entity holding where each plant stands (`MeshInstances`), drawing the part's mesh, which every cell shares: the geometry exists
 *          once however many plants there are, a plant costs sixty-four bytes, and the engine culls each plant against the view and picks its
 *          mesh by its distance (the part's cheaper mesh past the kind's `lodDistance`, nothing past `drawDistance`). The far version (a tree's
 *          crossed cards) is the same, a set of its own that begins where the kind ends: the hierarchical level of detail, with nothing on this
 *          side choosing between the two. Draws that share a mesh and a material are one draw in the engine, so a forest of cells is a few.
 *          The pieces wait in one queue for the whole app and are made while the frame's budget lasts, nearest asked first; a cell let go
 *          first leaves its pieces unmade.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { getComponent, MeshRenderer, RuntimeOnly, Transform, type MeshRendererData } from '../ecs/component';
import { engineApi } from '../ecs/bridge/engineApi';
import type { CppRegistry } from '../wasm';
import { withScratch } from '../wasm/wasmScratch';
import { Assets } from '../asset/AssetPlugin';
import type { Assets as AssetsApi } from '../asset/Assets';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Entity } from '../types';
import { buildPlacements, PLACEMENT_FLOATS, softenNormals, thinPlants, type Plant } from './builder';
import type { PlacedKind, PlacedPart } from './plantKind';

/** A part with what it needs in hand: the handles of its meshes (shared by every cell) and of its material and texture. */
export interface ReadyPart { part: PlacedPart; mesh: number; lod1: number; material: number; texture: number }

/** Every kind's parts in hand, and the parts that stand for each far off; `owned` are the meshes made here, which `releaseKinds` gives back. */
export interface ReadyKinds { kinds: ReadyPart[][]; far: ReadyPart[][]; owned: number[] }

/** One grown cell: its entity (none where nothing stands), what it owns so far, and whether it has been let go. */
export interface GrownCell { entity: Entity | null; handles: number[]; dead: boolean }

/**
 * Loads the meshes, materials and textures of every part of every kind, once. A part whose normals are turned toward up (`soft`) is a mesh of its own,
 * made here, and a part whose geometry cannot be read is left out.
 */
export async function prepareKinds(assets: AssetsApi, kinds: readonly PlacedKind[]): Promise<ReadyKinds> {
    const owned: number[] = [];
    const handleOf = async (path: string, soft: number): Promise<number> => {
        const loaded = (await assets.load<{ handle: number }>('mesh', path)).handle;
        if (!soft) return loaded;
        const source = await assets.readMeshData(loaded);
        const made = source ? assets.createMesh(softenNormals(source, soft)) : 0;
        if (made === 0) return loaded;
        owned.push(made);
        return made;
    };
    const ready = async (part: PlacedPart, withLod: boolean): Promise<ReadyPart | null> => {
        let mesh = 0;
        try { mesh = await handleOf(part.mesh, part.soft ?? 0); } catch { mesh = 0; }
        if (mesh === 0) { log.warn('foliage', `the geometry of ${part.mesh} cannot be read, so its plants are left out`); return null; }
        let lod1 = 0;
        if (withLod && part.lod1Mesh) { try { lod1 = await handleOf(part.lod1Mesh, part.soft ?? 0); } catch { lod1 = 0; } }
        return {
            part, mesh, lod1,
            material: part.material ? (await assets.loadMaterial(part.material)).handle : 0,
            texture: part.texture ? (await assets.loadTexture(part.texture)).handle : 0,
        };
    };
    const out: ReadyKinds = { kinds: [], far: [], owned };
    for (const kind of kinds) {
        const parts: ReadyPart[] = [], far: ReadyPart[] = [];
        for (const part of kind.parts) { const r = await ready(part, true); if (r) parts.push(r); }
        for (const part of kind.far ?? []) { const r = await ready(part, false); if (r) far.push(r); }
        out.kinds.push(parts);
        out.far.push(far);
    }
    return out;
}

/** Gives back the meshes `prepareKinds` made; the ones it only loaded stay with the asset system. */
export function releaseKinds(assets: AssetsApi, ready: ReadyKinds): void {
    for (const handle of ready.owned) assets.releaseBuiltMesh(handle);
    ready.owned.length = 0;
}

/** The growth of every plant in an app: the pieces waiting. */
export class PlantGrowth {
    /** The pieces not yet made, in the order they were asked. */
    readonly queue: { cell: GrownCell; run: () => void }[] = [];
    app_: App | null = null;

    /** How many pieces are still waiting to be made. */
    get pending(): number { return this.queue.length; }

    /** Pieces made so far, and the milliseconds spent making them: what the growth has cost, for a profile to read. */
    made = 0;
    spentMs = 0;

    /**
     * Makes one entity under `parent` that draws `part`'s mesh at every place in `plants`, relative to `parent`. `from` and `to` are the distances
     * from the eye between which a plant is drawn (0 for no limit); `lod` is the distance past which the part's cheaper mesh stands in, and `shadow` the one past which it casts no shadow.
     */
    private place(app: App, parent: Entity, name: string, part: ReadyPart, plants: readonly Plant[], lod: number, from: number, to: number, shadow = 0): void {
        const world = app.world;
        const e = world.spawn(name);
        world.insert(e, RuntimeOnly);
        world.insert(e, Transform, {});
        world.insert(e, MeshRenderer, {
            mesh: part.mesh, material: part.material, texture: part.texture, lit: true, opaque: part.part.opaque !== false, cullBackfaces: false,
            castShadows: part.part.castShadows !== false,
            color: { r: part.part.tint[0], g: part.part.tint[1], b: part.part.tint[2], a: part.part.tint[3] },
        } as Partial<MeshRendererData>);
        const placements = getComponent('MeshInstances');
        if (placements) world.insert(e, placements, { lod1Mesh: part.lod1, lodDistance: part.lod1 ? lod : 0, minDistance: from, drawDistance: to, shadowDistance: shadow });
        world.setParent(e, parent);
        const api = engineApi(app);
        const set = api?.meshInstances_set;
        if (!set || !api._malloc || !api._free || !api.HEAPU8 || plants.length === 0) return;
        const data = buildPlacements(plants);
        const registry = world.getCppRegistry() as CppRegistry;
        withScratch({ _malloc: api._malloc, _free: api._free }, (alloc) => {
            const ptr = alloc(data.byteLength);
            // Read after the allocation: it may have grown the memory, which replaces the buffer.
            new Float32Array(api.HEAPU8!.buffer, ptr, data.length).set(data);
            set(registry, e, ptr, data.length / PLACEMENT_FLOATS);
        });
    }

    /**
     * Grows `cell`, whose entity the caller has made and stands at the cell's centre: the plants of each kind in `byKind` (relative to that centre),
     * a piece of work a kind's part.
     */
    growCell(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>): void {
        const world = app.world, entity = cell.entity;
        if (entity === null) return;
        for (const [kindIndex, plants] of byKind) {
            const kind = kinds[kindIndex], parts = ready.kinds[kindIndex];
            if (!kind || !parts) continue;
            parts.forEach((r, j) => {
                this.queue.push({ cell, run: () => {
                    if (!world.valid(entity)) return;
                    try {
                        this.place(app, entity, `${kindIndex}:${j}`, r, plants, kind.lodDistance, 0, kind.drawDistance, kind.lodDistance > 0 ? kind.lodDistance * 2 : 0);
                    } catch (error) {
                        log.error('foliage', 'growing a piece of a cell of plants failed', error);
                    }
                } });
            });
        }
    }

    /**
     * Grows the far version of `cell`: each kind with one, its plants (thinned to the kind's `farKeep`) as a set of the far part's, drawn from
     * where the kind stops (`drawDistance`) out to `farDistance` from the eye. Cheap enough (a tree is two cards) to be made at once.
     */
    growFar(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>, _at?: { x: number; z: number; half?: number }): void {
        const entity = cell.entity;
        if (entity === null) return;
        for (const [kindIndex, plants] of byKind) {
            const parts = ready.far[kindIndex], kind = kinds[kindIndex];
            if (!kind || !parts || parts.length === 0) continue;
            const kept = thinPlants(plants, kind.farKeep ?? 1);
            for (const r of parts) this.place(app, entity, `far ${kindIndex}`, r, kept, 0, kind.drawDistance, kind.farDistance);
        }
    }

    /** Lets a cell go: what it made is despawned, and what it had not yet made is left unmade. */
    release(app: App, cell: GrownCell): void {
        cell.dead = true;
        if (cell.entity !== null && app.world.valid(cell.entity)) app.world.despawn(cell.entity);
        cell.handles.length = 0;
    }

    /** One frame of it: the far versions shown where they should be, and the queue worked through while the frame's budget lasts, one piece at least. */
    step(app: App): void {
        const bakes = bakesOf(app);
        let first = true;
        while (this.queue.length > 0 && (first || bakes.hasTime())) {
            first = false;
            const piece = this.queue.shift()!;
            if (piece.cell.dead) continue;
            const t0 = performance.now();
            piece.run();
            this.spentMs += performance.now() - t0;
            this.made++;
        }
        bakes.mark(this, 'Growing the plants', this.queue.length === 0 ? 1 : 0.5);
    }
}

/** The resource every plant's growth shares. @experimental */
export const PlantGrowthRes = defineResource<PlantGrowth>(new PlantGrowth(), 'PlantGrowth');

/** The App's plant growth, installed (with the system that steps it) on first use. */
export function plantGrowthOf(app: App): PlantGrowth {
    if (!app.hasResource(PlantGrowthRes)) {
        const growth = new PlantGrowth();
        growth.app_ = app;
        app.insertResource(PlantGrowthRes, growth);
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { if (app.hasResource(Assets)) growth.step(app); }, { name: 'PlantGrowthSystem' }));
    }
    return app.getResource(PlantGrowthRes);
}
