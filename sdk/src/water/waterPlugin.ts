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
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { TerrainsRes } from '../terrain/terrainPlugin';
import { BlendMode } from '../render/blend';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { waveHeight, waveSlope, type WaveParams } from './waves';
import { buildBoxMesh, buildOceanMesh, oceanSnap } from './waterMesh';
import { ShoreField, type Point2 } from './shore';
import { buildRiverMesh, currentShare } from './riverMesh';
import { Spline, type SplineData } from '../spline/splinePlugin';
import { SplineCurve } from '../spline/curve';
import { RippleField } from './ripples';
import { Quality } from '../render/qualityRuntime';
import { defaultQualityProfile, type QualityProfile } from '../render/quality';
import { isMiniGame } from '../platform';

/** What a body of water is. A river follows the `Spline` on its own entity. */
export const WaterForm = { Ocean: 0, Lake: 1, River: 2 } as const;

/** The fields of the `WaterBody` component. @experimental */
export interface WaterBodyData {
    /** {@link WaterForm}. */
    form: number;
    /** A material on the Water shader. Empty uses the stock one. */
    material: number;
    /** A lake's extent along x and z, centred on its entity, when it has no outline of its own. An ocean has none: it follows the camera. */
    sizeX: number;
    sizeZ: number;
    /** A lake's outline: three points or more round it on its own xz plane (x, y is x, z). Empty is the rectangle of `sizeX` by `sizeZ`. */
    boundary: Point2[];
    /** How far in from the edge, and how deep, the waves take to come to full height; 0 leaves them whole to the edge. */
    shoreWidth: number;
    /** The cell size of the finest ring, and (ocean) how many cells a ring has a side and how many rings there are. */
    cellSize: number;
    cells: number;
    rings: number;
    /** A river's current, in world units a second where the river is as wide as its widest; a narrower reach runs faster. */
    flowSpeed: number;
    /** The waves: the height of the tallest, the length of the longest, a multiplier on their speed, and the heading in degrees. */
    waveHeight: number;
    waveLength: number;
    waveSpeed: number;
    waveDirection: number;
    /** Cells along a side of the ripple grid; 0 keeps no ripples. The grid is a window of `rippleSize` that follows the camera. */
    ripples: number;
    rippleSize: number;
    /** How fast a ripple spreads (world units a second), how much of its height it loses a second, and how fast the foam it leaves fades a second. */
    rippleSpeed: number;
    rippleDamping: number;
    foamFade: number;
}

/**
 * A body of water. Presence is the opt-in; its geometry is a child, rebuilt when the shape changes.
 *
 * @experimental
 */
export const WaterBody: ComponentDef<WaterBodyData> = defineComponent<WaterBodyData>('WaterBody', {
    form: WaterForm.Lake, material: 0, sizeX: 100, sizeZ: 100, boundary: [] as Point2[], shoreWidth: 3, cellSize: 1, cells: 64, rings: 5, flowSpeed: 2,
    waveHeight: 0.3, waveLength: 14, waveSpeed: 1, waveDirection: 30,
    ripples: 0, rippleSize: 64, rippleSpeed: 6, rippleDamping: 0.8, foamFade: 0.4,
}, {
    assetFields: [{ field: 'material', type: 'material' }],
    fields: {
        form: { enum: [{ label: 'Ocean', value: WaterForm.Ocean }, { label: 'Lake', value: WaterForm.Lake }, { label: 'River', value: WaterForm.River }], category: 'Shape', tooltip: 'An ocean is without edge and follows the camera; a lake is a rectangle or an outline of its own; a river follows the Spline on the same entity.' },
        flowSpeed: { min: 0, max: 50, category: 'Waves', tooltip: 'A river\'s current, in world units a second where it is as wide as its widest. A narrower reach runs faster.', shownWhen: { field: 'form', values: [WaterForm.River] } },
        material: { category: 'Look', tooltip: 'A material on the Water shader. Empty uses the stock water.' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along x.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along z.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        boundary: { category: 'Shape', tooltip: 'The outline of a lake: points round it on its own xz plane. Empty is the rectangle of its size.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        shoreWidth: { min: 0, category: 'Shape', tooltip: 'How far in from the edge, and how deep, the waves take to come to full height. 0 leaves them whole to the edge.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        cellSize: { min: 0.05, category: 'Detail', tooltip: 'The cell size of the finest ring. Waves shorter than six cells are not drawn as geometry there (the shading still shows them).' },
        cells: { min: 4, max: 256, step: 4, category: 'Detail', tooltip: 'Cells along a ring\'s side (an ocean).', shownWhen: { field: 'form', values: [WaterForm.Ocean] } },
        rings: { min: 1, max: 8, step: 1, category: 'Detail', tooltip: 'Rings of an ocean, each twice as coarse as the one inside it.', shownWhen: { field: 'form', values: [WaterForm.Ocean] } },
        waveHeight: { min: 0, max: 8, category: 'Waves', tooltip: 'The height of the tallest wave, in world units.' },
        waveLength: { min: 0.5, max: 300, category: 'Waves', tooltip: 'The length of the longest wave.' },
        waveSpeed: { min: 0, max: 4, category: 'Waves', tooltip: 'A multiplier on how fast the waves travel.' },
        waveDirection: { min: 0, max: 360, category: 'Waves', tooltip: 'The heading of the waves, in degrees.' },
        ripples: { min: 0, max: 256, step: 8, category: 'Ripples', tooltip: 'Cells along a side of the grid that keeps what disturbs the water: bodies moving in it, and what a script disturbs. 0 keeps none.' },
        rippleSize: { min: 4, category: 'Ripples', tooltip: 'The side of the window the ripples are kept in, in world units. It follows the camera.' },
        rippleSpeed: { min: 0.1, max: 40, category: 'Ripples', tooltip: 'How fast a ripple spreads, in world units a second.' },
        rippleDamping: { min: 0, max: 10, category: 'Ripples', tooltip: 'How much of its height a ripple loses each second.' },
        foamFade: { min: 0, max: 10, category: 'Ripples', tooltip: 'How fast the foam a disturbance leaves fades, a second.' },
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
    /** How the water moves there, in world units a second (a river's current; still water is zero). */
    flow: [number, number, number];
    /** The world position of the surface above or below the point. */
    surface: [number, number, number];
    /** Whether the point is over the body's extent (an ocean has none, so it is always). */
    inside: boolean;
}

/** What the quality level lets water spend: waves summed, the ripple grid's side, whether waves lift the geometry, the mirror from below, the sun's light through it. */
export interface WaterQuality {
    waves: number;
    rippleCells: number;
    displacement: boolean;
    mirror: boolean;
    caustics: boolean;
}

/** Everything on: a project with no quality policy, off a minigame. */
export const FULL_WATER: WaterQuality = { waves: 4, rippleCells: 256, displacement: true, mirror: true, caustics: true };

/**
 * What water is allowed: the active quality profile when the project has a quality policy running; else the low profile on a minigame, which has the least to spend and
 * gets the lite water (flat geometry, no mirror, no web of light) without anyone asking; else everything.
 */
export function waterQualityOf(profile: Readonly<QualityProfile> | null, miniGame: boolean): WaterQuality {
    const p = profile ?? (miniGame ? defaultQualityProfile('low') : null);
    if (!p) return FULL_WATER;
    return { waves: p.waterWaves, rippleCells: p.waterRippleCells, displacement: p.waterDisplacement, mirror: p.waterMirror, caustics: p.waterCaustics };
}

/** What the plugin knows about one body it has built. */
interface Built {
    signature: string;
    data: WaterBodyData;
    mesh: number;
    /** A lake's baked shore, and the texture the shader reads it from. */
    field: ShoreField | null;
    /** A river's curve, the width it is drawn at its widest, and the shoreless texture it does not have. */
    curve: SplineCurve | null;
    widest: number;
    shoreTexture: number;
    /** The ripples this body keeps, where `ripples` asks for them, and the texture the shader reads them from. */
    ripples: RippleField | null;
    rippleTexture: number;
    rippleBytes: Uint8Array | null;
    child: Entity;
    instance: number;
    epoch: number;
    pending: boolean;
}

/** Run-time access to the water: where its surface is at a point, for what floats on it or swims in it. */
export class Waters {
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ app_: App | null = null;
    /** What the quality level allows now; the plugin refreshes it each frame, and what is drawn and what is answered both follow it. */
    quality: WaterQuality = FULL_WATER;

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
            const field = built.field;
            if (d.form === WaterForm.River) {
                const curve = built.curve;
                if (!curve) continue;
                const near = curve.nearest(q[0], q[2]);
                const half = curve.width(near.s) / 2;
                if (near.distance > half) continue;
                // A river's surface is the curve's own height and its normal is up; what moves is the water.
                const level = curve.position(near.s)[1];
                const tangent = curve.tangent(near.s);
                const run = Math.hypot(tangent[0], tangent[2]) || 1;
                const speed = d.flowSpeed * currentShare(half * 2, built.widest) * 2;
                const flow = rotate(t.worldRotation, (tangent[0] / run) * speed * scale, 0, (tangent[2] / run) * speed * scale);
                const normal = rotate(t.worldRotation, 0, 1, 0);
                return { entity, depth: (q[1] - level) * scale, normal, flow, surface: fromLocal(t, q[0], level, q[2], scale), inside: true };
            }
            const inside = d.form === WaterForm.Ocean || (field ? field.inside(q[0], q[2]) : false);
            if (!inside) continue;
            const params = { ...paramsOf(d), count: this.quality.waves };
            // The waves a lake keeps toward its shore are the ones its mesh was built with.
            const damp = field ? field.damp(q[0], q[2]) : 1;
            // The lite water is flat: its waves are in the shading, so the height code reads is the rest plane's.
            const h = (this.quality.displacement ? waveHeight(params, q[0], q[2], time) * damp : 0) + (built.ripples ? built.ripples.heightAt(q[0], q[2]) : 0);
            const [rx, rz] = waveSlope(params, q[0], q[2], time);
            const sx = rx * damp, sz = rz * damp;
            const len = Math.hypot(sx, 1, sz);
            const normal = rotate(t.worldRotation, -sx / len, 1 / len, -sz / len);
            const onSurface = fromLocal(t, q[0], h, q[2], scale);
            return { entity, depth: (q[1] - h) * scale, normal, flow: [0, 0, 0], surface: onSurface, inside };
        }
        return null;
    }

    /**
     * Disturbs the water at the world point (x, y, z): a bump of `strength` world units (negative is a dip) over `radius`, which spreads as a ring and leaves foam.
     * Goes to the body that holds the point, and does nothing where there is none or where the body keeps no ripples.
     */
    disturb(x: number, y: number, z: number, radius: number, strength: number): boolean {
        const world = this.app_?.world;
        if (!world) return false;
        for (const [entity, built] of this.built_) {
            if (!world.valid(entity) || !built.ripples) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const scale = t.worldScale.y || 1;
            const q = toLocal(t, x, y, z, scale);
            const inside = built.data.form === WaterForm.Ocean || (built.field ? built.field.inside(q[0], q[2]) : false)
                || (built.curve ? built.curve.nearest(q[0], q[2]).distance <= built.curve.width(built.curve.nearest(q[0], q[2]).s) / 2 : false);
            if (!inside) continue;
            built.ripples.disturb(q[0], q[2], radius / scale, strength / scale);
            return true;
        }
        return false;
    }

    /** The height the ripples add to the surface at the world point, for a body that keeps them; 0 elsewhere. */
    rippleAt(x: number, y: number, z: number): number {
        const world = this.app_?.world;
        if (!world) return 0;
        for (const [entity, built] of this.built_) {
            if (!world.valid(entity) || !built.ripples) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const scale = t.worldScale.y || 1;
            const q = toLocal(t, x, y, z, scale);
            const h = built.ripples.heightAt(q[0], q[2]);
            if (h !== 0) return h * scale;
        }
        return 0;
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

/** The outline of a lake: its own boundary when it has three points or more, else the rectangle of its size. */
function outlineOf(d: WaterBodyData): Point2[] {
    if (d.boundary.length >= 3) return d.boundary.map((p) => ({ x: p.x, y: p.y }));
    const hx = d.sizeX / 2, hz = d.sizeZ / 2;
    return [{ x: -hx, y: -hz }, { x: hx, y: -hz }, { x: hx, y: hz }, { x: -hx, y: hz }];
}

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
function signatureOf(d: WaterBodyData, ground: string, spline: SplineData | null): string {
    return JSON.stringify([d.form, d.sizeX, d.sizeZ, d.boundary, d.shoreWidth, d.cellSize, d.cells, d.rings, d.material, ground, d.form === WaterForm.River ? spline : null]);
}

export class WaterPlugin implements Plugin {
    name = 'water';

    /** The stock material every body without one of its own is an instance of, made once from the Water shader. */
    private stock_ = 0;
    private stockPending_ = false;

    /** The resource this plugin installed, for the parts of it that read the quality level. */
    private waters_: Waters = new Waters();

    build(app: App): void {
        const waters = new Waters();
        this.waters_ = waters;
        waters.app_ = app;
        app.insertResource(WatersRes, waters);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            this.sweep(app, waters);
            const policy = app.hasResource(Quality) ? app.getResource(Quality) : null;
            waters.quality = waterQualityOf(policy && policy.enabled ? policy.profile : null, isMiniGame());
            // What a body IS (its outline and shore, its curve) needs no renderer: it is built here whether or not anything is drawn, so a
            // server or a test that never draws can still ask the surface where it is. What is DRAWN waits for the asset layer.
            const rendering = app.hasResource(Assets);
            const time = app.getResource(Time).elapsed;
            const eye = rendering ? this.eye(app) : null;
            for (const entity of app.world.getEntitiesWithComponents([WaterBody, Transform])) {
                const data = app.world.get(entity, WaterBody) as WaterBodyData;
                const spline = data.form === WaterForm.River ? app.world.tryGet(entity, Spline) as SplineData | null : null;
                const signature = signatureOf(data, this.groundKey(app, entity, data), spline);
                let built = waters.built_.get(entity);
                if (!built || built.signature !== signature) {
                    if (built) this.destroy(app, built);
                    built = { signature, data: { ...data }, mesh: 0, field: null, curve: null, widest: 0, shoreTexture: 0, ripples: null, rippleTexture: 0, rippleBytes: null, child: 0 as Entity, instance: 0, epoch: (built?.epoch ?? 0) + 1, pending: false };
                    waters.built_.set(entity, built);
                    this.surface(app, entity, built);
                }
                built.data = { ...data };
                this.ripple(app, entity, built, eye ?? this.eye(app), app.getResource(Time).delta);
                if (!rendering) continue;
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
            let mesh: number;
            if (d.form === WaterForm.Ocean) {
                mesh = assets.createMesh(buildOceanMesh(d.cells, d.rings, d.cellSize));
            } else if (d.form === WaterForm.River) {
                // A river: the curve of the Spline on its entity, laid as a ribbon.
                if (!built.curve) return;
                const across = Math.min(64, Math.max(2, Math.ceil(built.widest / Math.max(d.cellSize, 0.05))));
                mesh = assets.createMesh(buildRiverMesh(built.curve, d.cellSize, across));
            } else {
                // A lake: cut to its outline, calmer toward its shore.
                const field = built.field;
                if (!field) return;
                mesh = assets.createMesh(buildBoxMesh(field.minX, field.minZ, field.minX + field.sizeX, field.minZ + field.sizeZ, d.cellSize, {
                    damp: (x, z) => field.damp(x, z),
                    keep: (x, z, cell) => field.distance(x, z) > -cell,
                }));
            }
            if (mesh === 0) { log.warn('water', 'the engine refused the water geometry'); return; }
            const instance = Material.createInstance(source);
            if (instance === 0) { assets.releaseBuiltMesh(mesh); log.warn('water', 'the water material could not be instanced'); return; }
            built.mesh = mesh;
            built.instance = instance;
            if (built.field) this.uploadShore(app, built);
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

    /** What a body is, apart from how it is drawn: a lake's outline with its shore and depth, a river's curve with its widest reach. */
    private surface(app: App, entity: Entity, built: Built): void {
        const d = built.data;
        built.field = null;
        built.curve = null;
        built.widest = 0;
        if (d.form === WaterForm.River) {
            const spline = app.world.tryGet(entity, Spline) as SplineData | null;
            if (!spline || spline.points.length < 2) { log.warn('water', 'a river needs a Spline of two points or more on its entity'); return; }
            built.curve = new SplineCurve(spline.points, spline.closed);
            for (let i = 0; i <= 64; i++) built.widest = Math.max(built.widest, built.curve.width((i / 64) * built.curve.length));
        } else if (d.form === WaterForm.Lake) {
            const poly = outlineOf(d);
            const reach = Math.max(...poly.map((p) => Math.abs(p.x)), ...poly.map((p) => Math.abs(p.y)));
            const res = Math.min(256, Math.max(32, Math.ceil((reach * 2) / Math.max(d.cellSize * 0.5, 0.05))));
            built.field = new ShoreField(poly, res, d.shoreWidth, this.groundUnder(app, entity));
        }
    }

    /** Gives the shader a lake's shore: the baked field as a texture, and where over the lake it lies. */
    private uploadShore(app: App, built: Built): void {
        const field = built.field!;
        // The encoding spans a few shore widths either side of the edge; a shore of none still needs a span for the foam.
        const range = Math.max(built.data.shoreWidth * 4, 16);
        const pixels = field.encode(range);
        built.shoreTexture = createTextureFromPixels(app.wasmModule, { width: field.res, height: field.res, pixels }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp' });
        Material.setUniform(built.instance, 'u_shoreMap', Material.tex(built.shoreTexture));
        Material.setUniform(built.instance, 'u_shoreOn', 1);
        Material.setUniform(built.instance, 'u_shoreOrigin', { x: field.minX, y: field.minZ });
        Material.setUniform(built.instance, 'u_shoreSize', { x: field.sizeX, y: field.sizeZ });
        Material.setUniform(built.instance, 'u_shoreRange', range);
    }

    /** The height of the ground under a body's plane, in the body's own space, where a terrain is and the body is level; else nothing is known. */
    private groundUnder(app: App, entity: Entity): ((x: number, z: number) => number | null) | undefined {
        if (!app.hasResource(TerrainsRes)) return undefined;
        const terrains = app.getResource(TerrainsRes);
        const t = app.world.tryGet(entity, Transform) as TransformData | null;
        if (!t || terrains.built_.size === 0) return undefined;
        const level = Math.abs(t.worldRotation.x) < 1e-4 && Math.abs(t.worldRotation.z) < 1e-4;
        if (!level) return undefined;
        const scale = t.worldScale.y || 1;
        const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1;
        return (x, z) => {
            const g = terrains.heightAt(t.worldPosition.x + x * sx, t.worldPosition.z + z * sz);
            return g === null ? null : (g - t.worldPosition.y) / scale;
        };
    }

    /** What the ground under a body adds to whether it must be rebuilt: the terrain's revision, and where the body stands over it. */
    private groundKey(app: App, entity: Entity, data: WaterBodyData): string {
        if (data.form === WaterForm.Ocean || !app.hasResource(TerrainsRes)) return '';
        const terrains = app.getResource(TerrainsRes);
        if (terrains.built_.size === 0) return '';
        const t = app.world.tryGet(entity, Transform) as TransformData | null;
        return t ? `${terrains.revision_}:${t.worldPosition.x}:${t.worldPosition.y}:${t.worldPosition.z}:${t.worldScale.x}:${t.worldScale.y}:${t.worldScale.z}` : '';
    }

    /**
     * Keeps a body's ripples: makes the grid when `ripples` asks for one, moves its window to the camera, steps it, and (where drawn) puts it where the shader reads it.
     * It runs headless too, so the surface a test or a server asks about has them.
     */
    private ripple(app: App, entity: Entity, built: Built, eye: [number, number, number] | null, dt: number): void {
        const d = built.data;
        if (d.ripples <= 0 || this.waters_.quality.rippleCells <= 0) { this.dropRipples(built); return; }
        // The level holds the grid to its own side; a body that asks for more gets the level's.
        const n = Math.max(8, Math.floor(Math.min(d.ripples, this.waters_.quality.rippleCells))), size = Math.max(d.rippleSize, 1e-3);
        if (!built.ripples || built.ripples.n !== n || built.ripples.size !== size) {
            this.dropRipples(built);
            built.ripples = new RippleField(n, size);
            // Until a camera says otherwise a body keeps its window over its middle.
            built.ripples.recenter(built.field ? built.field.minX + built.field.sizeX / 2 : 0, built.field ? built.field.minZ + built.field.sizeZ / 2 : 0);
        }
        const field = built.ripples;
        const t = app.world.tryGet(entity, Transform) as TransformData | null;
        if (t && eye) {
            const q = toLocal(t, eye[0], eye[1], eye[2], t.worldScale.y || 1);
            field.recenter(q[0], q[2]);
        }
        field.step(Math.min(Math.max(dt, 0), 0.1), d.rippleSpeed, d.rippleDamping, d.foamFade);
        if (!built.instance || !app.hasResource(Assets)) return;
        const range = this.rippleRange(d);
        field.limit = range;
        const bytes = field.encode(range, built.rippleBytes ?? undefined);
        built.rippleBytes = bytes;
        if (!built.rippleTexture) {
            built.rippleTexture = createTextureFromPixels(app.wasmModule, { width: n, height: n, pixels: bytes }, TextureContent.Retained, false,
                { filterMode: 'linear', wrapMode: 'clamp' });
            const handle = built.rippleTexture;
            provideTextureContent(handle, () => {
                if (built.rippleTexture !== handle || !built.rippleBytes) return false;
                updateTextureSubregion(app.wasmModule, handle, 0, 0, n, n, built.rippleBytes);
                return true;
            });
            Material.setUniform(built.instance, 'u_rippleMap', Material.tex(handle));
        } else {
            updateTextureSubregion(app.wasmModule, built.rippleTexture, 0, 0, n, n, bytes);
        }
        const set = (name: string, value: number | { x: number; y: number }): void => { Material.setUniform(built.instance, name, value); };
        set('u_rippleOn', 1);
        set('u_rippleOrigin', { x: field.originX, y: field.originZ });
        set('u_rippleSize', field.size);
        set('u_rippleTexel', 1 / n);
        set('u_rippleRange', range);
    }

    /** The height the grid holds and its encoding spans either side of rest: twice the waves' height, or a fiftieth of the window where the water is calm. */
    private rippleRange(d: WaterBodyData): number {
        return Math.max(d.waveHeight * 2, d.rippleSize * 0.02);
    }

    private dropRipples(built: Built): void {
        if (built.rippleTexture) {
            withdrawTextureContent(built.rippleTexture);
            getResourceManager()?.releaseTexture(built.rippleTexture);
        }
        built.rippleTexture = 0;
        built.rippleBytes = null;
        built.ripples = null;
        if (built.instance) Material.setUniform(built.instance, 'u_rippleOn', 0);
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
        const q = this.waters_.quality;
        set('u_waveCount', q.waves);
        set('u_mirror', q.mirror ? 1 : 0);
        set('u_causticOn', q.caustics ? 1 : 0);
        set('u_waveSpace', 1);
        set('u_origin', { x: ox, y: oz });
        set('u_cellSize', d.cellSize);
        set('u_flowSpeed', d.form === WaterForm.River ? d.flowSpeed : 0);
        set('u_geoWaves', d.form === WaterForm.River || !q.displacement ? 0 : 1);
        set('u_waveHeight', d.waveHeight);
        set('u_waveLength', d.waveLength);
        set('u_waveSpeed', d.waveSpeed);
        set('u_waveDirection', d.waveDirection);
        void time;
    }

    private destroy(app: App, built: Built): void {
        built.epoch++;
        if (built.child && app.world.valid(built.child)) app.world.despawn(built.child);
        this.dropRipples(built);
        if (built.instance) Material.release(built.instance);
        if (built.shoreTexture) getResourceManager()?.releaseTexture(built.shoreTexture);
        built.shoreTexture = 0;
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
