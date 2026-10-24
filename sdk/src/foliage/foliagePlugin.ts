// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    foliagePlugin.ts
 * @brief   Grass and trees across an area, drawn a cell at a time and swaying in the wind.
 *
 * @details The `Foliage` component says what grows where; this grows it. The entity stays as authored and the cells are its children,
 *          made when the scene runs (and in the editor's scene view) and made again when a field changes, so nothing is baked.
 *          Each cell is a MeshRenderer with a LODGroup (see builder.ts for what each level is), so culling and the choice of level are
 *          the engine's. If there is a Terrain, plants stand on it, avoid what is too steep and wait for it to be built.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { TerrainsRes } from '../terrain/terrainPlugin';
import { Material } from '../render/material';
import { currentWeather, currentWeatherDrive, WeatherDrive } from '../postprocess/weather';
import { isEditor, isPlayMode } from '../ecs/env';
import {
    buildBillboardMesh, buildGrassMesh, buildInstancedMesh, scatterCell,
    type Ground, type Plant,
} from './builder';

/** The fields of the `Foliage` component. @experimental */
export interface FoliageData {
    /** The plant to scatter. Empty grows grass, blades made here. */
    mesh: number;
    /** A material on the Foliage shader, which makes the wind. Empty draws the plants in their own colours, still. */
    material: number;
    /** The area, centred on the entity, and the side of the cells it is cut into. */
    sizeX: number;
    sizeZ: number;
    cellSize: number;
    /** Plants per cell. */
    count: number;
    seed: number;
    minScale: number;
    maxScale: number;
    /** The least a place may face up (0 to 1) and still grow something: lower lets plants onto slopes. */
    minUp: number;
    /** The band of heights, in world units, plants grow in. */
    heightMin: number;
    heightMax: number;
    /** Grass: how tall and how wide a blade is, at scale 1. */
    bladeHeight: number;
    bladeWidth: number;
    /** Distance past which a cell is drawn as its far version, and past which it is not drawn. */
    lodDistance: number;
    drawDistance: number;
    /** A tree's far version is two crossed cards showing this rectangle of its texture, as uv: left, bottom, right, top. */
    cardU0: number;
    cardV0: number;
    cardU1: number;
    cardV1: number;
    /** 1 draws a far tree's cards as tents (a conifer's outline) rather than rectangles. */
    cardTent: number;
}

/**
 * Plants across an area. Presence is the opt-in; its children are the cells that draw them.
 *
 * @experimental
 */
export const Foliage: ComponentDef<FoliageData> = defineComponent<FoliageData>('Foliage', {
    mesh: 0, material: 0,
    sizeX: 400, sizeZ: 400, cellSize: 40, count: 500, seed: 1,
    minScale: 0.8, maxScale: 1.25, minUp: 0.7, heightMin: -100000, heightMax: 100000,
    bladeHeight: 14, bladeWidth: 1.6, lodDistance: 140, drawDistance: 420,
    cardU0: 0, cardV0: 0, cardU1: 1, cardV1: 1, cardTent: 0,
}, {
    assetFields: [{ field: 'mesh', type: 'mesh' }, { field: 'material', type: 'material' }],
    fields: {
        mesh: { tooltip: 'The plant to scatter. Empty grows grass.', category: 'Plant' },
        material: { tooltip: 'A material on the Foliage shader, which makes the wind. Empty draws the plants still, in their own colours.', category: 'Plant' },
        sizeX: { min: 1, category: 'Area', tooltip: 'World size along x, centred on this entity.' },
        sizeZ: { min: 1, category: 'Area', tooltip: 'World size along z, centred on this entity.' },
        cellSize: { min: 4, category: 'Area', tooltip: 'Side of the cells the area is cut into. Each is one mesh, culled whole.' },
        count: { min: 0, step: 1, category: 'Area', tooltip: 'Plants per cell.' },
        seed: { step: 1, category: 'Area', tooltip: 'Another seed grows the same plants in other places.' },
        minScale: { min: 0.01, category: 'Plant' },
        maxScale: { min: 0.01, category: 'Plant' },
        minUp: { min: 0, max: 1, step: 0.01, category: 'Placement', tooltip: 'The least a place may face up and still grow something. Lower lets plants onto slopes.' },
        heightMin: { category: 'Placement', tooltip: 'The lowest world height plants grow at.' },
        heightMax: { category: 'Placement', tooltip: 'The highest world height plants grow at.' },
        bladeHeight: { min: 0.1, category: 'Grass', tooltip: 'Height of a blade at scale 1.' },
        bladeWidth: { min: 0.01, category: 'Grass', tooltip: 'Width of a blade at its base, at scale 1.' },
        lodDistance: { min: 1, category: 'Distance', tooltip: 'Past this a cell is drawn as its far version: fewer, broader blades, or a tree as crossed cards.' },
        drawDistance: { min: 1, category: 'Distance', tooltip: 'Past this a cell is not drawn.' },
        cardU0: { label: 'Card left', category: 'Far version', tooltip: 'The part of the plant\'s texture a far tree shows (left, bottom, right, top).' },
        cardV0: { label: 'Card bottom', category: 'Far version' },
        cardU1: { label: 'Card right', category: 'Far version' },
        cardV1: { label: 'Card top', category: 'Far version' },
        cardTent: { label: 'Card shape', category: 'Far version', enum: [{ label: 'Rectangle', value: 0 }, { label: 'Tent (conifer)', value: 1 }], tooltip: 'The outline of the cards a far tree is drawn as.' },
    },
});

interface BuiltFoliage {
    signature: string;
    data: FoliageData;
    cells: Entity[];
    handles: number[];
    queue: [number, number][];
    source: MeshData | null;
    loading: boolean;
    epoch: number;
    /** What the terrain was when this was grown. */
    terrainRevision: number;
}

const CELLS_PER_FRAME = 3;

/** Run-time facts about the foliage the plugin has grown. */
export class FoliageField {
    /** @internal */ readonly built_ = new Map<Entity, BuiltFoliage>();
    /** @internal The u_windStrength each material had before the weather's wind scaled it, to put back. */
    readonly authoredWind_ = new Map<number, number>();

    /** How many cells across every field are still waiting to be built. */
    get pending(): number {
        let n = 0;
        for (const b of this.built_.values()) n += b.queue.length + (b.loading ? 1 : 0);
        return n;
    }

    /** How many plants stand in the cells built so far, across every field. */
    get cellCount(): number {
        let n = 0;
        for (const b of this.built_.values()) n += b.cells.length;
        return n;
    }
}

/** The resource the plugin installs. @experimental */
export const FoliageRes = defineResource<FoliageField>(new FoliageField(), 'Foliage');

export class FoliagePlugin implements Plugin {
    name = 'foliage';

    build(app: App): void {
        const field = new FoliageField();
        app.insertResource(FoliageRes, field);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(Assets)) return;
            const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
            this.sweep(app, field);
            this.blow(app, field);
            // What stands on the ground waits for it: a plant placed before its terrain is read would stand on nothing.
            if (terrains?.loading) return;
            const revision = terrains?.revision_ ?? 0;
            for (const entity of app.world.getEntitiesWithComponents([Foliage, Transform])) {
                const data = app.world.get(entity, Foliage) as FoliageData;
                const signature = JSON.stringify(data);
                let built = field.built_.get(entity);
                if (!built || built.signature !== signature || built.terrainRevision !== revision) {
                    if (built) this.destroy(app, built);
                    built = {
                        signature, data: { ...data }, cells: [], handles: [], queue: [], source: null, loading: true,
                        epoch: (built?.epoch ?? 0) + 1, terrainRevision: revision,
                    };
                    field.built_.set(entity, built);
                    void this.start(app, entity, built);
                    continue;
                }
                if (built.loading) continue;
                for (let i = 0; i < CELLS_PER_FRAME && built.queue.length > 0; i++) {
                    const [cx, cz] = built.queue.shift()!;
                    this.buildCell(app, entity, built, cx, cz);
                }
            }
        }, { name: 'FoliageSystem' }));
    }

    /**
     * The weather's wind on the plants: each Foliage material's u_windStrength is its authored strength times the weather's `wind`, and is
     * put back when the weather is taken away or stops driving the wind. Only while the game runs, as the weather's lights are: in the
     * editor a material asset is left as authored, so previewing a storm never saves one.
     */
    private blow(app: App, field: FoliageField): void {
        const w = currentWeather();
        const playing = !isEditor() || isPlayMode();
        const wind = w && playing && (currentWeatherDrive() & WeatherDrive.Wind) ? w.wind : 1;
        const materials = new Set<number>();
        if (wind !== 1) {
            for (const entity of app.world.getEntitiesWithComponents([Foliage])) {
                const material = (app.world.get(entity, Foliage) as FoliageData).material;
                if (material) materials.add(material);
            }
        }
        for (const material of materials) {
            let authored = field.authoredWind_.get(material);
            if (authored === undefined) {
                const value = Material.getUniform(material, 'u_windStrength');
                if (typeof value !== 'number') continue;
                authored = value;
                field.authoredWind_.set(material, authored);
            }
            Material.setUniform(material, 'u_windStrength', authored * wind);
        }
        // What the weather no longer blows goes back to its own strength, once; the material is the author's again from then on.
        for (const [material, authored] of field.authoredWind_) {
            if (materials.has(material)) continue;
            Material.setUniform(material, 'u_windStrength', authored);
            field.authoredWind_.delete(material);
        }
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(FoliageRes)) return;
        const field = app.getResource(FoliageRes);
        for (const built of field.built_.values()) this.destroy(app, built);
        field.built_.clear();
    }

    /** Reads the plant's geometry, if it has one, then queues the cells. */
    private async start(app: App, entity: Entity, built: BuiltFoliage): Promise<void> {
        const epoch = built.epoch;
        const data = built.data;
        try {
            if (data.mesh) {
                const source = await app.getResource(Assets).readMeshData(data.mesh);
                if (built.epoch !== epoch) return;
                built.source = source;
                if (!source) log.warn('foliage', `the geometry of mesh ${data.mesh} cannot be read, so its plants are grass instead`);
            }
            if (!app.world.valid(entity)) return;
            const cells = this.cellsAcross(data);
            for (let cz = 0; cz < cells.z; cz++) for (let cx = 0; cx < cells.x; cx++) built.queue.push([cx, cz]);
        } catch (e) {
            log.error('foliage', 'growing the foliage failed', e);
        } finally {
            if (built.epoch === epoch) built.loading = false;
        }
    }

    private cellsAcross(data: FoliageData): { x: number; z: number } {
        const side = Math.max(1, data.cellSize);
        return { x: Math.min(200, Math.max(1, Math.ceil(data.sizeX / side))), z: Math.min(200, Math.max(1, Math.ceil(data.sizeZ / side))) };
    }

    private buildCell(app: App, parent: Entity, built: BuiltFoliage, cx: number, cz: number): void {
        const world = app.world;
        if (!world.valid(parent)) return;
        const data = built.data;
        const assets = app.getResource(Assets);
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const t = world.tryGet(parent, Transform) as TransformData | null;
        if (!t) return;
        const side = Math.max(1, data.cellSize);
        const cells = this.cellsAcross(data);
        // The cell's centre in the entity's own space, then in the world's (the ground is answered in the world's).
        const localX = -data.sizeX / 2 + (cx + 0.5) * (data.sizeX / cells.x);
        const localZ = -data.sizeZ / 2 + (cz + 0.5) * (data.sizeZ / cells.z);
        const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1;
        const worldX = t.worldPosition.x + localX * sx, worldZ = t.worldPosition.z + localZ * sz;
        const hasTerrain = !!terrains && terrains.built_.size > 0;
        const ground: Ground = (x, z) => {
            // With a terrain, a plant stands where there is ground and nowhere else; with none, the area is flat at the entity's height.
            if (!hasTerrain) return { y: t.worldPosition.y, up: 1 };
            const y = terrains!.heightAt(x, z);
            if (y === null) return null;
            const n = terrains!.normalAt(x, z);
            return { y, up: n ? n[1] : 1 };
        };
        const plants: Plant[] = scatterCell({
            centerX: worldX, centerZ: worldZ, size: Math.min(side, data.sizeX / cells.x), count: Math.floor(data.count), seed: data.seed,
            cellKey: cz * 1000 + cx, minScale: data.minScale, maxScale: data.maxScale, minUp: data.minUp,
            heightMin: data.heightMin, heightMax: data.heightMax,
        }, ground);
        if (plants.length === 0) return;
        // The cell stands at its centre, on the entity's own base height; the plants carry the ground's height relative to that.
        for (const p of plants) p.y -= t.worldPosition.y;

        const paint = data.material ? null : { base: [0.14, 0.3, 0.08] as [number, number, number], tip: [0.55, 0.72, 0.25] as [number, number, number] };
        const source = built.source;
        const meshes: MeshData[] = [];
        if (source) {
            meshes.push(buildInstancedMesh(source, plants, paint));
            const width = Math.max(source.aabbMax[0] - source.aabbMin[0], source.aabbMax[2] - source.aabbMin[2]);
            meshes.push(buildBillboardMesh(plants, width, source.aabbMax[1] - source.aabbMin[1],
                { u0: data.cardU0, v0: data.cardV0, u1: data.cardU1, v1: data.cardV1 }, paint, data.cardTent === 1));
        } else {
            const blade = { height: data.bladeHeight, width: data.bladeWidth, paint };
            meshes.push(buildGrassMesh(plants, { ...blade, segments: 3, thin: 1 }));
            meshes.push(buildGrassMesh(plants, { ...blade, segments: 1, thin: 3 }));
        }
        const handles: number[] = [];
        for (const mesh of meshes) {
            const handle = assets.createMesh(mesh);
            if (handle === 0) {
                log.warn('foliage', `the engine refused the geometry of cell ${cx},${cz}`);
                for (const h of handles) assets.releaseBuiltMesh(h);
                return;
            }
            handles.push(handle);
        }
        built.handles.push(...handles);

        const cell = world.spawn(`FoliageCell ${cx},${cz}`);
        world.insert(cell, Transform, { position: { x: localX, y: 0, z: localZ } });
        world.insert(cell, MeshRenderer, {
            mesh: handles[0]!, material: data.material, lit: true, opaque: true, cullBackfaces: false,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        const lodDef = getComponent('LODGroup');
        if (lodDef) {
            // The engine measures a cell by how much of the screen its bounding sphere covers: radius over distance, for a 60 degree view.
            const radius = Math.hypot(side, side) * 0.5;
            const sizeAt = (distance: number): number => radius / (Math.max(1, distance) * 0.577);
            world.insert(cell, lodDef, {
                lod1: handles[1] ?? 0, lod2: 0, lod3: 0,
                lod1Size: sizeAt(data.lodDistance), lod2Size: 0, lod3Size: 0, cullSize: sizeAt(data.drawDistance), hysteresis: 0.1, enabled: true,
            });
        }
        world.setParent(cell, parent);
        built.cells.push(cell);
    }

    private destroy(app: App, built: BuiltFoliage): void {
        built.epoch++;
        built.queue.length = 0;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const cell of built.cells) if (app.world.valid(cell)) app.world.despawn(cell);
        for (const handle of built.handles) assets?.releaseBuiltMesh(handle);
        built.cells.length = 0;
        built.handles.length = 0;
    }

    private sweep(app: App, field: FoliageField): void {
        for (const [entity, built] of field.built_) {
            if (app.world.valid(entity) && app.world.has(entity, Foliage)) continue;
            this.destroy(app, built);
            field.built_.delete(entity);
        }
    }
}

export const foliagePlugin: Plugin = new FoliagePlugin();
