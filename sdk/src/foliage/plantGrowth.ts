// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plantGrowth.ts
 * @brief   Growing plants a cell at a time inside the frame's budget: what `PlacedFoliage` and a generated world's plants share.
 *
 * @details A cell is an entity that stands at once, empty, and fills in over the frames after it: every kind in it and every part of that kind is
 *          one mesh (a batch of plants no bigger than a few milliseconds of work), made from the plants' own meshes with every channel kept (see
 *          buildPlacedMesh). Past the kind's distance a cheaper mesh stands in (a `LODGroup`), and past that its far version (a tree's crossed
 *          cards, merged a cell at a time) is shown where the eye is: the hierarchical level of detail. The pieces wait in one queue for the whole
 *          app and are made while the frame's budget lasts, nearest asked first; a cell let go first leaves its pieces unmade.
 *
 *          The thresholds are made from the sphere of each piece's own mesh, as the engine measures a renderer, and not from the cell's: a tree's crown
 *          and its trunk have spheres of their own, and a cell's radius would hand over, and cull, a third as far as the kind says.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    Camera, getComponent, MeshRenderer, RuntimeOnly, Transform,
    type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { Assets as AssetsApi } from '../asset/Assets';
import type { MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Entity } from '../types';
import { buildPlacedMesh, type Plant } from './builder';
import type { PlacedKind, PlacedPart } from './plantKind';

/** A part with what it needs in hand: its geometry read, its handles made. */
export interface ReadyPart { part: PlacedPart; source: MeshData; lod1: MeshData | null; material: number; texture: number }

/** Every kind's parts in hand, and the parts that stand for each far off. */
export interface ReadyKinds { kinds: ReadyPart[][]; far: ReadyPart[][] }

/** One grown cell: its entity (none where nothing stands), the meshes it owns so far, and whether it has been let go. */
export interface GrownCell { entity: Entity | null; handles: number[]; dead: boolean }

/** The most vertices one mesh of a cell takes: a piece of work of a few milliseconds, which a frame's budget can fit between others. */
const BATCH_VERTICES = 24000;

interface FarCell {
    /** Where the cell is, in the world's x and z. */
    x: number;
    z: number;
    owner: Entity;
    kinds: readonly PlacedKind[];
    children: { entity: Entity; kind: number; shown: boolean }[];
}

/** Reads the geometry and makes the handles of every part of every kind. */
export async function prepareKinds(assets: AssetsApi, kinds: readonly PlacedKind[]): Promise<ReadyKinds> {
    const ready = async (part: PlacedPart, withLod: boolean): Promise<ReadyPart | null> => {
        const source = await assets.readMeshData((await assets.load<{ handle: number }>('mesh', part.mesh)).handle);
        if (!source) { log.warn('foliage', `the geometry of ${part.mesh} cannot be read, so its plants are left out`); return null; }
        let lod1: MeshData | null = null;
        if (withLod && part.lod1Mesh) lod1 = await assets.readMeshData((await assets.load<{ handle: number }>('mesh', part.lod1Mesh)).handle);
        return {
            part, source, lod1,
            material: part.material ? (await assets.loadMaterial(part.material)).handle : 0,
            texture: part.texture ? (await assets.loadTexture(part.texture)).handle : 0,
        };
    };
    const out: ReadyKinds = { kinds: [], far: [] };
    for (const kind of kinds) {
        const parts: ReadyPart[] = [], far: ReadyPart[] = [];
        for (const part of kind.parts) { const r = await ready(part, true); if (r) parts.push(r); }
        for (const part of kind.far ?? []) { const r = await ready(part, false); if (r) far.push(r); }
        out.kinds.push(parts);
        out.far.push(far);
    }
    return out;
}

/** The growth of every plant in an app: the pieces waiting, and the far cells standing. */
export class PlantGrowth {
    /** The pieces not yet made, in the order they were asked. */
    readonly queue: { cell: GrownCell; run: () => void }[] = [];
    private readonly far_ = new Set<FarCell>();
    app_: App | null = null;

    /** How many meshes are still waiting to be made. */
    get pending(): number { return this.queue.length; }

    /** Pieces made so far, and the milliseconds spent making them: what the growth has cost, for a profile to read. */
    made = 0;
    spentMs = 0;

    /**
     * Grows `cell`, whose entity the caller has made and stands at the cell's centre: the plants of each kind in `byKind` (relative to that centre),
     * as pieces of work. `side` is the cell's side, for where the far version is shown from.
     */
    growCell(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>): void {
        const world = app.world, entity = cell.entity;
        if (entity === null) return;
        const assets = app.getResource(Assets);
        const lodDef = getComponent('LODGroup');
        const sphereOf = (m: MeshData): number => 0.5 * Math.hypot(m.aabbMax[0] - m.aabbMin[0], m.aabbMax[1] - m.aabbMin[1], m.aabbMax[2] - m.aabbMin[2]);
        const sizeAt = (radius: number, distance: number): number => radius / (Math.max(1, distance) * 0.577);
        const made = (mesh: MeshData): number => {
            const handle = assets.createMesh(mesh);
            if (handle === 0) throw new Error('the engine refused the geometry of a cell of plants');
            cell.handles.push(handle);
            return handle;
        };
        for (const [kindIndex, plants] of byKind) {
            const kind = kinds[kindIndex], parts = ready.kinds[kindIndex];
            if (!kind || !parts) continue;
            parts.forEach((r, j) => {
                const per = Math.max(1, Math.floor(BATCH_VERTICES / Math.max(1, r.source.vertexCount)));
                for (let from = 0; from < plants.length; from += per) {
                    const batch = plants.slice(from, from + per);
                    this.queue.push({ cell, run: () => {
                        if (!world.valid(entity)) return;
                        try {
                            const near = buildPlacedMesh(r.source, batch);
                            const e = world.spawn(`${kindIndex}:${j}`);
                            world.insert(e, RuntimeOnly);
                            world.insert(e, Transform, {});
                            world.insert(e, MeshRenderer, {
                                mesh: made(near), material: r.material, texture: r.texture, lit: true, opaque: r.part.opaque !== false, cullBackfaces: false,
                                color: { r: r.part.tint[0], g: r.part.tint[1], b: r.part.tint[2], a: r.part.tint[3] },
                            } as Partial<MeshRendererData>);
                            if (lodDef) {
                                const coarse = r.lod1 ? buildPlacedMesh(r.lod1, batch) : null;
                                const far = coarse ? made(coarse) : 0;
                                // The engine's bounds for the group are the union of its levels, so the sphere is the union's.
                                const radius = sphereOf(coarse ? {
                                    ...near,
                                    aabbMin: near.aabbMin.map((v, i) => Math.min(v, coarse.aabbMin[i]!)) as [number, number, number],
                                    aabbMax: near.aabbMax.map((v, i) => Math.max(v, coarse.aabbMax[i]!)) as [number, number, number],
                                } : near);
                                world.insert(e, lodDef, {
                                    lod1: far, lod2: 0, lod3: 0, lod1Size: far ? sizeAt(radius, kind.lodDistance) : 0, lod2Size: 0, lod3Size: 0,
                                    cullSize: sizeAt(radius, kind.drawDistance + radius), hysteresis: 0.1, enabled: true,
                                });
                            }
                            world.setParent(e, entity);
                        } catch (error) {
                            log.error('foliage', 'growing a piece of a cell of plants failed', error);
                        }
                    } });
                }
            });
        }
    }

    /**
     * Grows the far version of `cell`: each kind with one, its plants as one mesh a far part, hidden until the eye is far enough (`kind.drawDistance`
     * to `kind.farDistance` from the cell's centre, at world x and z `at`). Cheap enough (a tree is two cards) to be made at once.
     */
    growFar(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>, at: { x: number; z: number }): void {
        const world = app.world, entity = cell.entity;
        if (entity === null) return;
        const assets = app.getResource(Assets);
        const children: FarCell['children'] = [];
        for (const [kindIndex, plants] of byKind) {
            const parts = ready.far[kindIndex];
            if (!parts || parts.length === 0) continue;
            for (const r of parts) {
                const handle = assets.createMesh(buildPlacedMesh(r.source, plants));
                if (handle === 0) continue;
                cell.handles.push(handle);
                const e = world.spawn(`far ${kindIndex}`);
                world.insert(e, RuntimeOnly);
                world.insert(e, Transform, {});
                world.insert(e, MeshRenderer, {
                    mesh: handle, material: r.material, texture: r.texture, lit: true, opaque: r.part.opaque !== false, cullBackfaces: false, enabled: false,
                    color: { r: r.part.tint[0], g: r.part.tint[1], b: r.part.tint[2], a: r.part.tint[3] },
                } as Partial<MeshRendererData>);
                world.setParent(e, entity);
                children.push({ entity: e, kind: kindIndex, shown: false });
            }
        }
        if (children.length > 0) this.far_.add({ x: at.x, z: at.z, owner: entity, kinds, children });
    }

    /** Lets a cell go: what it made is despawned and given back, and what it had not yet made is left unmade. */
    release(app: App, cell: GrownCell): void {
        cell.dead = true;
        for (const f of this.far_) if (f.owner === cell.entity) this.far_.delete(f);
        if (cell.entity !== null && app.world.valid(cell.entity)) app.world.despawn(cell.entity);
        const assets = app.getResource(Assets);
        for (const handle of cell.handles) assets.releaseBuiltMesh(handle);
        cell.handles.length = 0;
    }

    /** Shows a far part where the eye is past what its kind draws as itself, and hides it nearer and further. */
    private showFar(app: App): void {
        if (this.far_.size === 0) return;
        const world = app.world;
        let eye: { x: number; z: number } | null = null;
        for (const e of world.getEntitiesWithComponents([Camera, Transform])) {
            if (!(world.get(e, Camera) as CameraData).isActive) continue;
            const w = (world.get(e, Transform) as TransformData).worldPosition;
            eye = { x: w.x, z: w.z };
            break;
        }
        if (!eye) return;
        for (const cell of this.far_) {
            const d = Math.hypot(cell.x - eye.x, cell.z - eye.z);
            for (const child of cell.children) {
                const kind = cell.kinds[child.kind];
                if (!kind) continue;
                const show = d > kind.drawDistance && d < kind.farDistance;
                if (show === child.shown || !world.valid(child.entity)) continue;
                child.shown = show;
                world.insert(child.entity, MeshRenderer, { ...(world.get(child.entity, MeshRenderer) as MeshRendererData), enabled: show });
            }
        }
    }

    /** One frame of it: the far versions shown where they should be, and the queue worked through while the frame's budget lasts, one piece at least. */
    step(app: App): void {
        this.showFar(app);
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
