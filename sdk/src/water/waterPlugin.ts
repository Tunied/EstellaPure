// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterPlugin.ts
 * @brief   A body of water: a component that says what it is, a mesh the plugin builds for it, and the surface it answers questions about.
 *
 * @details The `WaterBody` component names a form (an ocean, a lake) and the waves; this builds the geometry as a child entity, gives it a
 *          material instance of its own (the Water material with the waves, the body's space and its cell size written in), and keeps
 *          the instance in step with the component every frame, so editing a field moves the water at once.
 *
 *          The waves are the ones the Water shader draws: `waves.ts` is the same formula, and {@link Waters.sample} answers from it in the body's
 *          own frame, so a floating object, a camera under the surface and a splash all read the surface that is on the screen. The body's
 *          transform places and tilts it (waves follow its up), and an ocean's mesh follows the camera on a lattice its rings line up on,
 *          with the material's origin moved by as much so the waves stay put in the world.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource, Time } from '../ecs/resource';
import {
    defineComponent, Camera, MeshRenderer, Transform,
    type ComponentDef, type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { waveHeight, waveSlope, type WaveParams } from './waves';
import { buildOceanMesh, buildRectMesh, oceanSnap } from './waterMesh';

/** What a body of water is. River arrives with the spline it follows. */
export const WaterForm = { Ocean: 0, Lake: 1, River: 2 } as const;

/** The fields of the `WaterBody` component. @experimental */
export interface WaterBodyData {
    /** {@link WaterForm}. */
    form: number;
    /** A material on the Water shader. Empty uses the stock one. */
    material: number;
    /** A lake's extent along x and z, centred on its entity. An ocean has none: it follows the camera. */
    sizeX: number;
    sizeZ: number;
    /** The cell size of the finest ring, and (ocean) how many cells a ring has a side and how many rings there are. */
    cellSize: number;
    cells: number;
    rings: number;
    /** The waves: the height of the tallest, the length of the longest, a multiplier on their speed, and the heading in degrees. */
    waveHeight: number;
    waveLength: number;
    waveSpeed: number;
    waveDirection: number;
}

/**
 * A body of water. Presence is the opt-in; its geometry is a child, rebuilt when the shape changes.
 *
 * @experimental
 */
export const WaterBody: ComponentDef<WaterBodyData> = defineComponent<WaterBodyData>('WaterBody', {
    form: WaterForm.Lake, material: 0, sizeX: 100, sizeZ: 100, cellSize: 1, cells: 64, rings: 5,
    waveHeight: 0.3, waveLength: 14, waveSpeed: 1, waveDirection: 30,
}, {
    assetFields: [{ field: 'material', type: 'material' }],
    fields: {
        form: { enum: [{ label: 'Ocean', value: WaterForm.Ocean }, { label: 'Lake', value: WaterForm.Lake }], category: 'Shape', tooltip: 'An ocean is without edge and follows the camera; a lake is a rectangle of its own size.' },
        material: { category: 'Look', tooltip: 'A material on the Water shader. Empty uses the stock water.' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along x.' },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along z.' },
        cellSize: { min: 0.05, category: 'Detail', tooltip: 'The cell size of the finest ring. Waves shorter than six cells are not drawn as geometry there (the shading still shows them).' },
        cells: { min: 4, max: 256, step: 4, category: 'Detail', tooltip: 'Cells along a ring\'s side (an ocean).' },
        rings: { min: 1, max: 8, step: 1, category: 'Detail', tooltip: 'Rings of an ocean, each twice as coarse as the one inside it.' },
        waveHeight: { min: 0, max: 8, category: 'Waves', tooltip: 'The height of the tallest wave, in world units.' },
        waveLength: { min: 0.5, max: 300, category: 'Waves', tooltip: 'The length of the longest wave.' },
        waveSpeed: { min: 0, max: 4, category: 'Waves', tooltip: 'A multiplier on how fast the waves travel.' },
        waveDirection: { min: 0, max: 360, category: 'Waves', tooltip: 'The heading of the waves, in degrees.' },
    },
});

/** What {@link Waters.sample} answers. */
export interface WaterSample {
    /** The body's entity. */
    entity: Entity;
    /** How far the point is above the surface along the body's up (negative under it), in world units. */
    depth: number;
    /** The surface's normal at the point, in world space. */
    normal: [number, number, number];
    /** The world position of the surface above or below the point. */
    surface: [number, number, number];
    /** Whether the point is over the body's extent (an ocean has none, so it is always). */
    inside: boolean;
}

/** What the plugin knows about one body it has built. */
interface Built {
    signature: string;
    data: WaterBodyData;
    mesh: number;
    child: Entity;
    instance: number;
    epoch: number;
    pending: boolean;
}

/** Run-time access to the water: where its surface is at a point, for what floats on it or swims in it. */
export class Waters {
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ app_: App | null = null;

    /**
     * The surface of the body that holds `(x, y, z)`: how far above it the point is (negative under), the surface's normal and the point on
     * it straight above or below along the body's up. Null where there is no water. The body's position, rotation and uniform scale are taken
     * into account, and the waves are read at the instant of the frame.
     */
    sample(x: number, y: number, z: number): WaterSample | null {
        const world = this.app_?.world;
        if (!world) return null;
        const time = this.app_!.getResource(Time).elapsed;
        for (const [entity, built] of this.built_) {
            if (!world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const scale = t.worldScale.y || 1;
            const q = toLocal(t, x, y, z, scale);
            const d = built.data;
            const inside = d.form === WaterForm.Ocean || (Math.abs(q[0]) <= d.sizeX / 2 && Math.abs(q[2]) <= d.sizeZ / 2);
            if (!inside) continue;
            const params = paramsOf(d);
            const h = waveHeight(params, q[0], q[2], time);
            const [sx, sz] = waveSlope(params, q[0], q[2], time);
            const len = Math.hypot(sx, 1, sz);
            const normal = rotate(t.worldRotation, -sx / len, 1 / len, -sz / len);
            const onSurface = fromLocal(t, q[0], h, q[2], scale);
            return { entity, depth: (q[1] - h) * scale, normal, surface: onSurface, inside };
        }
        return null;
    }

    /** The world height of the surface above or below (x, z) for an untilted body, or null where there is none. */
    heightAt(x: number, z: number): number | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const entity of this.built_.keys()) {
            if (!world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            const s = t ? this.sample(x, t.worldPosition.y, z) : null;
            if (s) return s.surface[1];
        }
        return null;
    }
}

/** The resource the plugin installs. @experimental */
export const WatersRes = defineResource<Waters>(new Waters(), 'Waters');

function paramsOf(d: WaterBodyData): WaveParams {
    return { height: d.waveHeight, length: d.waveLength, speed: d.waveSpeed, direction: d.waveDirection };
}

type Quat = { x: number; y: number; z: number; w: number };

/** `v` turned by `q`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

function toLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const inv = { x: -t.worldRotation.x, y: -t.worldRotation.y, z: -t.worldRotation.z, w: t.worldRotation.w };
    const r = rotate(inv, x - t.worldPosition.x, y - t.worldPosition.y, z - t.worldPosition.z);
    return [r[0] / scale, r[1] / scale, r[2] / scale];
}

function fromLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const r = rotate(t.worldRotation, x * scale, y * scale, z * scale);
    return [r[0] + t.worldPosition.x, r[1] + t.worldPosition.y, r[2] + t.worldPosition.z];
}

/** What shapes the geometry: when it changes the child is rebuilt; the waves and the material are not part of it. */
function signatureOf(d: WaterBodyData): string {
    return JSON.stringify([d.form, d.sizeX, d.sizeZ, d.cellSize, d.cells, d.rings, d.material]);
}

export class WaterPlugin implements Plugin {
    name = 'water';

    /** The stock material every body without one of its own is an instance of, made once from the Water shader. */
    private stock_ = 0;
    private stockPending_ = false;

    build(app: App): void {
        const waters = new Waters();
        waters.app_ = app;
        app.insertResource(WatersRes, waters);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(Assets)) return;
            this.sweep(app, waters);
            const time = app.getResource(Time).elapsed;
            const eye = this.eye(app);
            for (const entity of app.world.getEntitiesWithComponents([WaterBody, Transform])) {
                const data = app.world.get(entity, WaterBody) as WaterBodyData;
                const signature = signatureOf(data);
                let built = waters.built_.get(entity);
                if (!built || built.signature !== signature) {
                    if (built) this.destroy(app, built);
                    built = { signature, data: { ...data }, mesh: 0, child: 0 as Entity, instance: 0, epoch: (built?.epoch ?? 0) + 1, pending: false };
                    waters.built_.set(entity, built);
                }
                built.data = { ...data };
                if (!built.child && !built.pending) void this.build_(app, entity, built);
                if (built.child && built.instance) this.update(app, entity, built, eye, time);
            }
        }, { name: 'WaterSystem' }));
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(WatersRes)) return;
        const waters = app.getResource(WatersRes);
        for (const built of waters.built_.values()) this.destroy(app, built);
        waters.built_.clear();
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** The world position of the active camera, or null where there is none (the editor's scene view has no entity). */
    private eye(app: App): [number, number, number] | null {
        for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
            const camera = app.world.get(entity, Camera) as CameraData;
            if (!camera.isActive) continue;
            const t = app.world.get(entity, Transform) as TransformData;
            return [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z];
        }
        return null;
    }

    /** The material every body without one is an instance of: the Water shader, compiled once. */
    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const assets = app.getResource(Assets);
        const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:water');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:water', blendMode: BlendMode.Normal,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, shader);
        return this.stock_;
    }

    private async build_(app: App, entity: Entity, built: Built): Promise<void> {
        built.pending = true;
        const epoch = built.epoch;
        try {
            const source = built.data.material || await this.stock(app);
            if (built.epoch !== epoch || !app.world.valid(entity)) return;
            const d = built.data;
            const assets = app.getResource(Assets);
            const mesh = assets.createMesh(d.form === WaterForm.Ocean
                ? buildOceanMesh(d.cells, d.rings, d.cellSize)
                : buildRectMesh(d.sizeX, d.sizeZ, d.cellSize));
            if (mesh === 0) { log.warn('water', 'the engine refused the water geometry'); return; }
            const instance = Material.createInstance(source);
            if (instance === 0) { assets.releaseBuiltMesh(mesh); log.warn('water', 'the water material could not be instanced'); return; }
            built.mesh = mesh;
            built.instance = instance;
            const child = app.world.spawn('Water');
            app.world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
            app.world.insert(child, MeshRenderer, {
                mesh, material: instance, lit: true, opaque: false, cullBackfaces: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
            app.world.setParent(child, entity);
            built.child = child;
        } catch (e) {
            log.error('water', 'building the water failed', e);
        } finally {
            built.pending = false;
        }
    }

    /** Writes the component into the instance, and moves an ocean's mesh to the camera. */
    private update(app: App, entity: Entity, built: Built, eye: [number, number, number] | null, time: number): void {
        const d = built.data;
        let ox = 0, oz = 0;
        if (d.form === WaterForm.Ocean && eye) {
            const t = app.world.get(entity, Transform) as TransformData;
            const q = toLocal(t, eye[0], eye[1], eye[2], t.worldScale.y || 1);
            const snap = oceanSnap(d.rings, d.cellSize);
            ox = Math.round(q[0] / snap) * snap;
            oz = Math.round(q[2] / snap) * snap;
        }
        const child = app.world.get(built.child, Transform) as TransformData;
        if (child.position.x !== ox || child.position.z !== oz) {
            app.world.insert(built.child, Transform, { ...child, position: { x: ox, y: 0, z: oz } });
        }
        const set = (name: string, value: number | { x: number; y: number }): void => { Material.setUniform(built.instance, name, value); };
        set('u_waveSpace', 1);
        set('u_origin', { x: ox, y: oz });
        set('u_cellSize', d.cellSize);
        set('u_waveHeight', d.waveHeight);
        set('u_waveLength', d.waveLength);
        set('u_waveSpeed', d.waveSpeed);
        set('u_waveDirection', d.waveDirection);
        void time;
    }

    private destroy(app: App, built: Built): void {
        built.epoch++;
        if (built.child && app.world.valid(built.child)) app.world.despawn(built.child);
        if (built.instance) Material.release(built.instance);
        if (built.mesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(built.mesh);
        built.child = 0 as Entity;
        built.instance = 0;
        built.mesh = 0;
    }

    /** Releases the geometry of a body whose entity is gone. */
    private sweep(app: App, waters: Waters): void {
        for (const [entity, built] of waters.built_) {
            if (app.world.valid(entity) && app.world.has(entity, WaterBody)) continue;
            this.destroy(app, built);
            waters.built_.delete(entity);
        }
    }
}

export const waterPlugin: Plugin = new WaterPlugin();
