// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    terrainPlugin.ts
 * @brief   Ground: a source of heights drawn as a CDLOD quadtree of one shared patch, its heights read from pages on the GPU.
 *
 * @details The `Terrain` component says what the ground is: an area (a heightmap, or noise worn by rain) or ground without end (noise
 *          read anywhere). Its source (source.ts) answers the CPU, and the GPU draws it in pages (pages.ts): each quadtree node
 *          (quadtree.ts) round the eye is the same small patch, placed and sized by its instance, whose vertices the Terrain shader
 *          lifts from the node's page and slides onto the coarser grid toward the end of their level's range, so neighbouring levels
 *          meet without a crack. The nodes are ordinary MeshRenderers of one mesh and one material, which the renderer draws as instanced
 *          runs; pages are made a few a frame, coarse first, and a node whose page is not ready is drawn by an ancestor's.
 *
 *          What is collided with and what `heightAt` answers is the surface (surface.ts): the finest level's triangles, the same
 *          wherever the eye is. Collision is built in tiles round what moves on the ground (a moving 3D body, a character) and handed
 *          to the physics world as collision geometry.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, Camera, MeshRenderer, Transform,
    type ComponentDef, type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { platformLoadImagePixels } from '../platform/base';
import { decodeImagePixels } from '../asset/imageDecode';
import { decodePngData } from '../asset/pngData';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { EditorView, editorViewEye } from '../camera/EditorView';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Color, Entity } from '../types';
import { erosionJob, heightfieldFromPixels, type Heightfield } from './heightfield';
import { FieldSource, type TerrainSource } from './source';
import { levelRange, nodeKey, parentOf, selectNodes, type QuadtreeParams, type TerrainNode } from './quadtree';
import { makePage, PageTable, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS, type PageImage, type Repaint } from './pages';
import { noiseProvider, ProviderSource, terrainProvider, terrainProvidersRevision, TerrainUnavailable, type TerrainProvider } from './provider';
import { buildPatchMesh } from './patch';
import { TerrainSurface, TILE_CELLS, type SurfaceTile } from './surface';
import { collisionGeometryOf } from '../runtime/collisionGeometry';
import { chunksOf, ProceduralChunksRes, type ChunkSource } from '../residency/chunks';
import { CharacterController3D, RigidBody3D, type RigidBody3DData } from '../physics3d/Physics3DComponents';

/** The engine's own provider of ground without end: seeded noise of the world's position. */
export const NOISE_PROVIDER = 'estella:noise';

/** How far the ground goes: an area of its own size, or for ever. */
export const TerrainExtent = { Area: 0, Infinite: 1 } as const;

/** The fields of the `Terrain` component. @experimental */
export interface TerrainData {
    /** {@link TerrainExtent}: an area `sizeX` by `sizeZ`, or ground that goes on for ever (from a provider, read anywhere). */
    extent: number;
    /**
     * Ground read from a provider (without end, or an area with no heightmap, a window on it where the area stands): the provider
     * (`estella:noise`, the engine's noise, or one a game registers with registerTerrainProvider), the world it belongs to as the game
     * names it, and the generator version that world was made with.
     */
    provider: string;
    world: string;
    generatorVersion: number;
    /** A heightmap image: red is the height (green, if it is not just grey, its low byte). Empty makes the ground from noise. */
    heightmap: number;
    /** An image whose four channels are the weights of the four layers; empty paints by height and slope. */
    splatmap: number;
    /** A material on the Terrain shader. Empty draws the layer colours onto the ground. */
    material: number;
    /** An area's size along x and z, centred on its entity; for ground without end, the span `frequency` hills are spread over. */
    sizeX: number;
    sizeZ: number;
    /** World height of the highest ground. */
    height: number;
    /** The finest cell of the ground's mesh, in world units: what it is drawn at near the eye. */
    cellSize: number;
    /** Above 1 the finest cells reach further out before the ground coarsens. */
    detail: number;
    /** How far ground without end is drawn. */
    drawDistance: number;
    /** Whether bodies collide with the ground; how far round each thing that moves on it the ground is built for collision; its layer and friction. */
    collision: boolean;
    collisionDistance: number;
    collisionLayer: number;
    friction: number;
    /** Noise ground: the seed, how many hills across, how many octaves, how rough, how ridged, and (an area's) how many samples. */
    seed: number;
    frequency: number;
    octaves: number;
    persistence: number;
    ridged: number;
    resolution: number;
    /** How far the noise is bent by noise of its own, 0 to 1: winding valleys and bent ridges instead of round hills. */
    warp: number;
    /** How much rain wears the ground, 0 to 4: an area is worn drop by drop (dirt where the water ran), ground without end by its noise. */
    erosion: number;
    /** Painting: how steep ground must be to turn to rock (0 flat, 1 sheer), and the heights, 0 to 1, where dirt and snow start. */
    rockSlope: number;
    dirtHeight: number;
    snowHeight: number;
    /** The four layers: grass, dirt, snow, rock. With no material these are the colours the ground is drawn in; a material has its own layers and tints. */
    layerColor0: Color;
    layerColor1: Color;
    layerColor2: Color;
    layerColor3: Color;
}

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 });

/**
 * The ground. Presence is the opt-in; its children are the quadtree's nodes, drawn as instances of one patch.
 *
 * @experimental
 */
export const Terrain: ComponentDef<TerrainData> = defineComponent<TerrainData>('Terrain', {
    extent: TerrainExtent.Area, provider: NOISE_PROVIDER, world: '', generatorVersion: 1, heightmap: 0, splatmap: 0, material: 0,
    sizeX: 1000, sizeZ: 1000, height: 150, cellSize: 2, detail: 1, drawDistance: 4000,
    collision: true, collisionDistance: 64, collisionLayer: 0, friction: 0.6,
    seed: 1, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.35, resolution: 257, warp: 0, erosion: 0,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88,
    layerColor0: rgb(0.28, 0.46, 0.2), layerColor1: rgb(0.45, 0.36, 0.24), layerColor2: rgb(0.93, 0.95, 0.98), layerColor3: rgb(0.4, 0.38, 0.36),
}, {
    assetFields: [{ field: 'heightmap', type: 'texture' }, { field: 'splatmap', type: 'texture' }, { field: 'material', type: 'material' }],
    fields: {
        extent: { enum: [{ label: 'Area', value: TerrainExtent.Area }, { label: 'Infinite', value: TerrainExtent.Infinite }], category: 'Shape', tooltip: 'An area of its own size, from a heightmap or noise; or ground that goes on for ever, from noise read anywhere (the same seed is the same ground).' },
        provider: { category: 'Shape', tooltip: 'The generator the ground is made by, without end or (with no heightmap) in an area: estella:noise, or one the game registers. The same provider, world, seed and version are the same ground on every machine, and two areas side by side join.' },
        world: { category: 'Shape', tooltip: 'The world (a planet, a level) the ground belongs to, as the game names it; handed to the provider.' },
        generatorVersion: { min: 1, step: 1, category: 'Shape', tooltip: 'The generator version the world was made with. A version the provider no longer has fails the terrain rather than growing other ground under what was built.' },
        heightmap: { tooltip: 'A heightmap image: red is the height. Empty makes the ground from noise; a heightmap that cannot be read fails the terrain instead.', category: 'Shape', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        splatmap: { tooltip: 'An image whose red, green, blue and alpha are the weights of grass, dirt, snow and rock.', category: 'Layers', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        material: { tooltip: 'A material on the Terrain shader. Empty draws the layer colours onto the ground.', category: 'Layers' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'An area\'s size along x; for ground without end, the span its hills are spread over.' },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'An area\'s size along z.', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        height: { min: 0, category: 'Shape', tooltip: 'World height of the highest ground.' },
        cellSize: { min: 0.01, category: 'Detail', tooltip: 'The finest cell of the ground\'s mesh, in world units: what it is drawn at near the eye. Further off the cells double, level by level.' },
        detail: { min: 0.25, max: 8, step: 0.05, category: 'Detail', tooltip: 'Above 1 the finest cells reach further out before the ground coarsens.' },
        drawDistance: { min: 1, category: 'Detail', tooltip: 'How far ground without end is drawn.', shownWhen: { field: 'extent', values: [TerrainExtent.Infinite] } },
        collision: { category: 'Collision', tooltip: 'Whether 3D bodies and characters collide with the ground: the finest level\'s triangles, wherever the camera is.' },
        collisionDistance: { min: 1, category: 'Collision', tooltip: 'How far round each moving body and character the ground is built for collision, in world units.' },
        collisionLayer: { min: 0, max: 15, step: 1, category: 'Collision', advanced: true, tooltip: 'The collision layer the ground is in (0 to 15).' },
        friction: { min: 0, category: 'Collision', advanced: true, tooltip: 'How much the ground holds what slides on it.' },
        seed: { step: 1, category: 'Noise', tooltip: 'Another seed is another ground.' },
        frequency: { min: 0.1, max: 32, step: 0.1, category: 'Noise', tooltip: 'How many hills across the terrain (or across sizeX, for ground without end).' },
        octaves: { min: 1, max: 8, step: 1, category: 'Noise', tooltip: 'Layers of detail in the noise.' },
        persistence: { min: 0, max: 1, step: 0.01, category: 'Noise', tooltip: 'How much of its height each finer layer keeps. Lower is smoother.' },
        ridged: { min: 0, max: 1, step: 0.01, category: 'Noise', tooltip: '0 is rolling hills; 1 is sharp ridges.' },
        resolution: { min: 17, max: 2049, step: 1, category: 'Noise', tooltip: 'Samples along each side of an area\'s noise ground.', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        warp: { min: 0, max: 1, step: 0.01, category: 'Noise', tooltip: 'How far the noise is bent by noise of its own: winding valleys and bent ridges instead of round hills.' },
        erosion: { min: 0, max: 4, step: 0.05, category: 'Shape', tooltip: 'How much rain wears the ground: an area (a heightmap\'s too) drop by drop, with dirt where the water ran; ground without end by its noise. 0 leaves it as made.' },
        rockSlope: { min: 0, max: 1, step: 0.01, category: 'Layers', tooltip: 'How steep ground must be to turn to rock. 0 is flat, 1 is sheer.' },
        dirtHeight: { min: 0, max: 1, step: 0.01, category: 'Layers', tooltip: 'The height, as a share of the terrain, where grass gives way to dirt.' },
        snowHeight: { min: 0, max: 1, step: 0.01, category: 'Layers', tooltip: 'The height, as a share of the terrain, where snow begins.' },
        layerColor0: { label: 'Grass', category: 'Layers' },
        layerColor1: { label: 'Dirt', category: 'Layers' },
        layerColor2: { label: 'Snow', category: 'Layers' },
        layerColor3: { label: 'Rock', category: 'Layers' },
    },
});

const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a || 1e-6), 0), 1);
    return t * t * (3 - 2 * t);
};

/** The weights of grass, dirt, snow and rock at a point of ground, by how high (0 to 1 of the terrain) and how steep it is. */
export function paintWeights(h: number, ny: number, t: Pick<TerrainData, 'rockSlope' | 'dirtHeight' | 'snowHeight'>): [number, number, number, number] {
    const rock = smooth(t.rockSlope - 0.08, t.rockSlope + 0.08, 1 - ny);
    const snow = smooth(t.snowHeight - 0.06, t.snowHeight + 0.06, h) * (1 - rock * 0.85);
    const dirt = smooth(t.dirtHeight - 0.15, t.dirtHeight + 0.15, h) * (1 - snow) * (1 - rock);
    const grass = (1 - rock) * (1 - snow) * (1 - dirt);
    const sum = grass + dirt + snow + rock || 1;
    return [grass / sum, dirt / sum, snow / sum, rock / sum];
}

/** The side of the atlases the pages are kept in, in texels: 900 pages of 67 by 67. */
const ATLAS_SIZE = 2048;
/** The chunk layer a terrain's collision is, and the key of one tile's piece of collision geometry. */
const collisionLayerOf = (entity: Entity): string => `terrain-collision:${entity}`;
const tileKey = (entity: Entity, tx: number, tz: number): string => `terrain:${entity}:${tx}:${tz}`;

/** Pages asked at once of a provider that answers later. */
const PAGES_IN_FLIGHT = 16;

/** What the plugin knows about one terrain it has built. */
interface Built {
    signature: string;
    data: TerrainData;
    source: TerrainSource | null;
    /** The triangles of the finest level, which queries and collision read. */
    surface: TerrainSurface | null;
    /** Bumped on every rebuild so an answer that arrives for an older one is thrown away. */
    epoch: number;
    loading: boolean;
    /** The erosion in hand, to stop if the terrain is rebuilt. */
    cancel: (() => void) | null;
    table: PageTable;
    heights: number;
    paint: number;
    mesh: number;
    instance: number;
    /** The nodes drawn now, by key, and spare ones to place again. */
    nodes: Map<string, Entity>;
    spare: Entity[];
    /** Pages wanted and not made yet, by key. */
    wanted: Map<string, TerrainNode>;
    /** Pages asked of a provider that answers later, by key: the frame's budget is not spent waiting for them. */
    asked: Set<string>;
    pending: boolean;
    /** Why the ground could not be made, once it could not: nothing is drawn or answered for it. */
    failure: string | null;
}

/** Where a terrain's ground stands: still being made, ready, or failed (with why). */
export interface TerrainStatus { state: 'loading' | 'ready' | 'failed'; reason?: string }

/** Run-time access to the ground: how high it is anywhere, for putting things on it. */
export class Terrains {
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ app_: App | null = null;

    /**
     * The world height of the ground at (x, z), or null where no terrain is. The terrain's own position is taken into account; its
     * rotation and scale are not (a terrain is laid flat at its own size).
     */
    heightAt(x: number, z: number): number | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const [entity, built] of this.built_) {
            if (!built.surface || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const h = built.surface.height(x - t.worldPosition.x, z - t.worldPosition.z);
            if (h !== null) return t.worldPosition.y + h;
        }
        return null;
    }

    /** Where the ground faces at (x, z) (a unit normal), or null where no terrain is. */
    normalAt(x: number, z: number): [number, number, number] | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const [entity, built] of this.built_) {
            const surface = built.surface;
            if (!surface || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const n = surface.normal(x - t.worldPosition.x, z - t.worldPosition.z);
            if (n) return n;
        }
        return null;
    }

    /**
     * Whether the ground at (x, z) is known: false while a terrain that covers it is still being made, or its provider has not answered
     * there yet; true where it is known, and where no terrain is (there is no ground to wait for).
     */
    groundKnownAt(x: number, z: number): boolean {
        const world = this.app_?.world;
        if (!world) return true;
        for (const [entity, built] of this.built_) {
            if (built.failure || !world.valid(entity)) continue;
            if (built.loading || !built.surface) return false;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const lx = x - t.worldPosition.x, lz = z - t.worldPosition.z;
            if (built.surface.covers(lx, lz)) return built.surface.height(lx, lz) !== null;
        }
        return true;
    }

    /** Whether the ground under (x, z) is built for collision: what a game waits on before it drops something there. */
    collisionReadyAt(x: number, z: number): boolean {
        const app = this.app_;
        if (!app?.hasResource(ProceduralChunksRes)) return false;
        const chunks = app.getResource(ProceduralChunksRes);
        for (const [entity, built] of this.built_) {
            const t = app.world.valid(entity) ? app.world.tryGet(entity, Transform) as TransformData | null : null;
            if (!t || !built.surface?.covers(x - t.worldPosition.x, z - t.worldPosition.z)) continue;
            const state = chunks.stateAt(collisionLayerOf(entity), x, z);
            return state === 'ready' || state === 'stale';
        }
        return false;
    }

    /** Where a terrain's ground stands. A failed one draws and answers nothing, and says why. */
    status(entity: Entity): TerrainStatus | null {
        const built = this.built_.get(entity);
        if (!built) return null;
        if (built.failure) return { state: 'failed', reason: built.failure };
        return { state: built.loading || !built.source ? 'loading' : 'ready' };
    }

    /** @internal What has the last word on the ground's paint, in world space (a world's biomes), if anything does. */
    paint_: Repaint | null = null;

    /**
     * Gives the ground's paint to `paint` (or back to the terrains, with null): at each sample, in world space, it is handed the paint
     * the terrain made and returns the paint to draw. The pages already made are made again.
     */
    setPaint(paint: Repaint | null): void {
        if (paint === this.paint_) return;
        this.paint_ = paint;
        this.repaint();
    }

    /** Makes every page again, for a paint that changed what it answers. */
    repaint(): void {
        for (const built of this.built_.values()) built.table.clear();
    }

    /** @internal Bumped whenever a terrain's ground changes, so what stands on it knows to stand again. */
    revision_ = 0;

    /** Whether any terrain is still reading its images or wearing its ground: its heights are not known yet. */
    get loading(): boolean {
        for (const b of this.built_.values()) if (b.loading) return true;
        return false;
    }

    /** How many pages every terrain still wants made for what is in view. */
    get pending(): number {
        let n = 0;
        for (const b of this.built_.values()) n += b.wanted.size + (b.loading ? 1 : 0);
        return n;
    }
}

/** The resource the plugin installs. @experimental */
export const TerrainsRes = defineResource<Terrains>(new Terrains(), 'Terrains');

/** What, changed, rebuilds the ground: everything but the colours, the detail and the collision, which are read each frame. */
function signatureOf(data: TerrainData, at: { x: number; z: number }): string {
    const { layerColor0: _a, layerColor1: _b, layerColor2: _c, layerColor3: _d, detail: _e, drawDistance: _f,
        collision: _g, collisionDistance: _h, collisionLayer: _i, friction: _j, ...shape } = data;
    // Ground read from a provider is the world's where the terrain stands: moved, it is read again; and a game's own provider is read
    // again when one is registered under its name.
    const fromProvider = data.extent === TerrainExtent.Infinite || !data.heightmap;
    const where = fromProvider ? `@${at.x},${at.z}` : '';
    const late = fromProvider && data.provider !== NOISE_PROVIDER ? `#${terrainProvidersRevision()}` : '';
    return `${JSON.stringify(shape)}${where}${late}`;
}

/** The provider a terrain names, or why it cannot have it. */
function providerOf(data: TerrainData): TerrainProvider {
    const provider = data.provider === NOISE_PROVIDER ? noiseProvider(() => data) : terrainProvider(data.provider);
    if (!provider) throw new TerrainUnavailable(`no terrain provider ${data.provider} is registered`);
    return provider;
}

/** The ground's paint by height (over the provider's range) and slope, for a provider that does not paint. */
function paintBy(provider: TerrainProvider, data: TerrainData): (h: number, ny: number) => [number, number, number, number] {
    const [lo, hi] = provider.range(data.seed, data.generatorVersion);
    return (h, ny) => paintWeights((h - lo) / Math.max(hi - lo, 1e-6), ny, data);
}

/** An area's window on its provider's ground: `resolution` samples along its longer side, over the provider's range. */
async function windowOf(provider: TerrainProvider, data: TerrainData, cx: number, cz: number, range: [number, number]): Promise<Heightfield> {
    const res = Math.min(2049, Math.max(17, Math.floor(data.resolution)));
    const spacing = Math.max(data.sizeX, data.sizeZ) / (res - 1);
    const nx = Math.max(2, Math.round(data.sizeX / spacing) + 1), nz = Math.max(2, Math.round(data.sizeZ / spacing) + 1);
    const count = Math.max(nx, nz);
    const got = await provider.sample({
        world: data.world, seed: data.seed, version: data.generatorVersion, x0: cx - data.sizeX / 2, z0: cz - data.sizeZ / 2, spacing, count,
    });
    const span = Math.max(range[1] - range[0], 1e-6);
    const out = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = (got.heights[j * count + i]! - range[0]) / span;
    return { width: nx, height: nz, data: out };
}

/** Where what collides with the ground is: every moving 3D body and every character. */
function movers(app: App): ChunkSource[] {
    const world = app.world;
    world.ensureTransformsComposed();
    const out: ChunkSource[] = [];
    for (const e of world.getEntitiesWithComponents([RigidBody3D, Transform])) {
        const body = world.get(e, RigidBody3D) as RigidBody3DData;
        if (!body.enabled || body.bodyType === 0) continue;
        const p = (world.get(e, Transform) as TransformData).worldPosition;
        out.push({ x: p.x, z: p.z });
    }
    for (const e of world.getEntitiesWithComponents([CharacterController3D, Transform])) {
        const p = (world.get(e, Transform) as TransformData).worldPosition;
        out.push({ x: p.x, z: p.z });
    }
    return out;
}

export class TerrainPlugin implements Plugin {
    name = 'terrain';

    /** The stock material a terrain with none of its own is an instance of. */
    private stock_ = 0;

    build(app: App): void {
        const terrains = new Terrains();
        terrains.app_ = app;
        app.insertResource(TerrainsRes, terrains);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            // What the ground IS needs no renderer: a server or a test without one still makes the source and answers from it.
            const rendering = app.hasResource(Assets);
            this.sweep(app, terrains);
            for (const entity of app.world.getEntitiesWithComponents([Terrain, Transform])) {
                const data = app.world.get(entity, Terrain) as TerrainData;
                const signature = signatureOf(data, (app.world.get(entity, Transform) as TransformData).worldPosition);
                let built = terrains.built_.get(entity);
                if (!built || built.signature !== signature) {
                    if (built) this.destroy(app, built);
                    built = {
                        signature, data: { ...data }, source: null, surface: null, epoch: (built?.epoch ?? 0) + 1, loading: true, cancel: null,
                        table: new PageTable(ATLAS_SIZE), heights: 0, paint: 0, mesh: 0, instance: 0,
                        nodes: new Map(), spare: [], wanted: new Map(), asked: new Set(), pending: false, failure: null,
                    };
                    terrains.built_.set(entity, built);
                    void this.load(app, entity, built);
                    continue;
                }
                built.data = { ...data };
                this.collide(app, entity, built);
                if (built.loading || !built.source || !rendering) continue;
                if (!built.instance) {
                    if (!built.pending) void this.prepare(app, built);
                    continue;
                }
                this.draw(app, entity, built);
            }
        }, { name: 'TerrainSystem' }));
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(TerrainsRes)) return;
        const terrains = app.getResource(TerrainsRes);
        for (const [entity, built] of terrains.built_) {
            if (app.hasResource(ProceduralChunksRes)) app.getResource(ProceduralChunksRes).remove(collisionLayerOf(entity));
            this.destroy(app, built);
        }
        terrains.built_.clear();
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** Reads the images the terrain names (or makes its noise, and wears it), and makes its source. */
    private async load(app: App, entity: Entity, built: Built): Promise<void> {
        const epoch = built.epoch;
        const data = built.data;
        try {
            const t = app.world.get(entity, Transform) as TransformData;
            if (data.extent === TerrainExtent.Infinite) {
                const provider = providerOf(data);
                built.source = new ProviderSource(provider, data.world, data.seed, data.generatorVersion, t.worldPosition.x, t.worldPosition.z,
                    Math.max(data.cellSize, 1e-3), paintBy(provider, data));
            } else {
                // A heightmap named and not read is a failure: a world built on that ground must not quietly get other ground.
                const height = await this.pixelsOf(app, data.heightmap);
                if (data.heightmap && !height) throw new TerrainUnavailable(`the heightmap (texture ${data.heightmap}) could not be read`);
                const splat = await this.pixelsOf(app, data.splatmap);
                if (built.epoch !== epoch || !app.world.valid(entity)) return;
                // Without a heightmap an area is a window on its provider's ground, read where it stands in the world: two areas side by
                // side are one ground, and the area is the same ground the provider gives without end.
                let range: [number, number] = [0, data.height];
                let made: Heightfield;
                if (height) {
                    made = heightfieldFromPixels(height.width, height.height, height.pixels);
                } else {
                    const provider = providerOf({ ...data, erosion: 0 });
                    const checked = new ProviderSource(provider, data.world, data.seed, data.generatorVersion, 0, 0, 1, paintBy(provider, data));
                    range = [checked.minHeight, checked.maxHeight];
                    made = await windowOf(provider, data, t.worldPosition.x, t.worldPosition.z, range);
                    if (built.epoch !== epoch || !app.world.valid(entity)) return;
                }
                let field = made, flow: Float32Array | null = null;
                if (data.erosion > 0) {
                    // Rain over a big field is seconds of work: it is spread over frames, and shown while it runs.
                    const job = bakesOf(app).run('Eroding the terrain',
                        erosionJob(made, { amount: data.erosion, seed: data.seed, sizeX: data.sizeX, sizeZ: data.sizeZ, height: range[1] - range[0] }));
                    built.cancel = job.cancel;
                    const worn = await job.done;
                    built.cancel = null;
                    if (built.epoch !== epoch || !app.world.valid(entity)) return;
                    field = worn.field;
                    flow = worn.flow;
                }
                built.source = new FieldSource(field, data, splat, flow, range);
            }
            built.surface = new TerrainSurface(built.source, Math.max(data.cellSize, 1e-3));
            app.getResource(TerrainsRes).revision_++;
        } catch (e) {
            if (built.epoch === epoch) built.failure = e instanceof Error ? e.message : String(e);
            log.error('terrain', 'building the terrain failed', e);
        } finally {
            if (built.epoch === epoch) built.loading = false;
        }
    }

    private async pixelsOf(app: App, handle: number): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
        if (!handle || !app.hasResource(Assets)) return null;
        const assets = app.getResource(Assets);
        const path = assets.pathForHandle('texture', handle);
        if (!path) { log.warn('terrain', `no source image is known for texture ${handle}`); return null; }
        try {
            // The bytes the asset layer would load, decoded unmodified (no premultiply, no colour conversion): a height is data.
            if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
                const bytes = new Uint8Array(await assets.fetchBinary(path));
                return await decodePngData(bytes) ?? await decodeImagePixels(new Blob([bytes]));
            }
            const image = await platformLoadImagePixels(assets.resolveLoadPath(path));
            return { width: image.width, height: image.height, pixels: image.pixels };
        } catch (e) {
            log.warn('terrain', `reading ${path} failed`, e);
            return null;
        }
    }

    /** The stock material: the Terrain shader, compiled once. */
    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const source = await app.getResource(Assets).load<MaterialShaderSource>('material-shader', 'builtin:terrain');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:terrain', blendMode: BlendMode.None,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, shader);
        return this.stock_;
    }

    /** Makes what the ground is drawn with: the patch, the atlases and an instance of its material. */
    private async prepare(app: App, built: Built): Promise<void> {
        built.pending = true;
        const epoch = built.epoch;
        try {
            const material = built.data.material || await this.stock(app);
            if (built.epoch !== epoch) return;
            const assets = app.getResource(Assets);
            built.mesh = assets.createMesh(buildPatchMesh(PATCH_CELLS));
            const blank = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
            const params = { filterMode: 'linear', wrapMode: 'clamp', srgb: false } as const;
            built.heights = createTextureFromPixels(app.wasmModule, { width: ATLAS_SIZE, height: ATLAS_SIZE, pixels: blank }, TextureContent.Transient, false, params);
            built.paint = createTextureFromPixels(app.wasmModule, { width: ATLAS_SIZE, height: ATLAS_SIZE, pixels: blank }, TextureContent.Transient, false, params);
            // A device that lost the atlases has lost every page in them: they are made again as they are wanted.
            for (const handle of [built.heights, built.paint]) {
                provideTextureContent(handle, () => { built.table.clear(); return true; });
            }
            built.instance = Material.createInstance(material);
            if (!built.mesh || !built.heights || !built.paint || !built.instance) {
                log.warn('terrain', 'the engine refused the terrain\'s mesh, atlases or material');
                return;
            }
            const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
            set('u_heightPages', Material.tex(built.heights));
            set('u_paintPages', Material.tex(built.paint));
            set('u_terrainPages', 1);
            set('u_atlasTexels', ATLAS_SIZE);
            set('u_pageTexels', PAGE_TEXELS);
            set('u_patchCells', PATCH_CELLS);
        } catch (e) {
            log.error('terrain', 'preparing the terrain failed', e);
        } finally {
            built.pending = false;
        }
    }

    /**
     * The terrain's collision as a layer of procedural chunks: a tile within `collisionDistance` of every moving 3D body and character,
     * made when one comes near, let go when none is, and made again (the old tile kept till then) when the ground changes.
     */
    private collide(app: App, entity: Entity, built: Built): void {
        const id = collisionLayerOf(entity);
        const d = built.data;
        if (!d.collision || built.failure) {
            if (app.hasResource(ProceduralChunksRes)) app.getResource(ProceduralChunksRes).remove(id);
            return;
        }
        const chunks = chunksOf(app);
        const at = (app.world.get(entity, Transform) as TransformData).worldPosition;
        const cell = Math.max(d.cellSize, 1e-3), span = TILE_CELLS * cell;
        const bounds = built.source?.bounds ?? (d.extent === TerrainExtent.Area ? [-d.sizeX / 2, -d.sizeZ / 2, d.sizeX / 2, d.sizeZ / 2] : null);
        const geometry = collisionGeometryOf(app);
        chunks.set<{ key: string; tile: SurfaceTile }>(id, {
            label: 'Building the ground\'s collision',
            originX: at.x, originZ: at.z, sizeX: span, sizeZ: span,
            extent: bounds && [Math.floor(bounds[0] / span), Math.floor(bounds[1] / span), Math.ceil(bounds[2] / span), Math.ceil(bounds[3] / span)],
            loadRadius: Math.max(d.collisionDistance, 0),
            unloadRadius: Math.max(d.collisionDistance, 0) + span,
            // The ground (rebuilt under a new epoch), where it stands, and the layer and friction its tiles were made with.
            generation: `${built.epoch}:${at.x}:${at.y}:${at.z}:${d.collisionLayer}:${d.friction}`,
            sources: () => movers(app),
            make: (tx, tz) => {
                // The ground is not known yet (still loading, or a provider still answering): asked again next frame.
                const tile = built.surface?.tile(tx, tz);
                return tile ? { key: tileKey(entity, tx, tz), tile } : null;
            },
            publish: (_tx, _tz, { key, tile }) => {
                geometry.set(key, {
                    owner: entity, origin: [at.x + tile.x0, at.y, at.z + tile.z0], positions: tile.positions, indices: tile.indices,
                    friction: d.friction, restitution: 0, layer: d.collisionLayer,
                });
            },
            release: (_tx, _tz, { key }) => geometry.delete(key),
        });
    }

    /** Where the eye is, in the terrain's space: the active camera, or the editor's own eye while it looks at the scene in 3D. */
    private eye(app: App, t: TransformData): [number, number, number] | null {
        if (app.hasResource(EditorView)) {
            const view = app.getResource(EditorView);
            if (view.active && view.perspective) {
                const e = editorViewEye(view);
                return [e.x - t.worldPosition.x, e.y - t.worldPosition.y, e.z - t.worldPosition.z];
            }
        }
        for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
            if (!(app.world.get(entity, Camera) as CameraData).isActive) continue;
            const c = app.world.get(entity, Transform) as TransformData;
            return [c.worldPosition.x - t.worldPosition.x, c.worldPosition.y - t.worldPosition.y, c.worldPosition.z - t.worldPosition.z];
        }
        return null;
    }

    /** The quadtree's cut for this terrain: leaf nodes a patch of the finest cells, ranges doubling, enough levels to cover it. */
    private treeOf(built: Built, source: TerrainSource): QuadtreeParams {
        const d = built.data;
        const leafSize = PATCH_CELLS * Math.max(d.cellSize, 1e-3);
        const range0 = leafSize * 2.5 * Math.max(d.detail, 0.25);
        const reach = source.bounds ? Math.max(source.bounds[2] - source.bounds[0], source.bounds[3] - source.bounds[1]) : Math.max(d.drawDistance, leafSize);
        let levels = 1;
        while (levels < 16 && (source.bounds ? leafSize * 2 ** (levels - 1) < reach : levelRange({ range0 }, levels - 1) < reach)) levels++;
        return { leafSize, levels, range0, bounds: source.bounds, minHeight: source.minHeight, maxHeight: source.maxHeight };
    }

    /** Chooses the nodes for the eye, makes the pages they want within the budget, and places the nodes. */
    private draw(app: App, entity: Entity, built: Built): void {
        const source = built.source!;
        const t = app.world.get(entity, Transform) as TransformData;
        const eye = this.eye(app, t);
        const tree = this.treeOf(built, source);
        const eyeAt = eye ?? [0, source.maxHeight, 0];
        const chosen = selectNodes(tree, eyeAt[0], eyeAt[1], eyeAt[2]);
        const table = built.table;
        table.tick();

        // Each node is drawn by its own page, or by its nearest ancestor that has one; a node under an ancestor drawn instead is not.
        built.wanted.clear();
        const drawn = new Map<string, TerrainNode>();
        const covered = new Set<string>();
        for (const node of chosen) {
            let n: TerrainNode | null = node;
            const own = nodeKey(node.level, node.ix, node.iz);
            if (!table.get(own)) built.wanted.set(own, node);
            while (n && !table.get(nodeKey(n.level, n.ix, n.iz))) {
                n = n.level + 1 < tree.levels ? parentOf(n, tree.leafSize) : null;
                if (n && !table.get(nodeKey(n.level, n.ix, n.iz))) built.wanted.set(nodeKey(n.level, n.ix, n.iz), n);
            }
            if (!n) continue;
            const key = nodeKey(n.level, n.ix, n.iz);
            if (n !== node) covered.add(key);
            drawn.set(key, n);
        }
        for (const [key, n] of drawn) {
            // A node whose ancestor is drawn in its place is left out: the ancestor covers it.
            for (let up = n; up.level + 1 < tree.levels;) {
                up = parentOf(up, tree.leafSize);
                if (covered.has(nodeKey(up.level, up.ix, up.iz))) { drawn.delete(key); break; }
            }
        }
        this.makePages(app, built, source, eyeAt, t.worldPosition);

        const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
        set('u_heightRange', { x: source.minHeight, y: Math.max(source.maxHeight - source.minHeight, 1e-6) });
        set('u_lodRange0', tree.range0);
        set('u_terrainOrigin', { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z, w: 0 });
        // Not the pass's camera: a shadow is drawn from the light, and its ground must be the one the eye sees.
        set('u_terrainEye', { x: eyeAt[0] + t.worldPosition.x, y: eyeAt[1] + t.worldPosition.y, z: eyeAt[2] + t.worldPosition.z, w: 1 });
        const b = source.bounds;
        set('u_terrainBounds', b ? { x: b[0], y: b[1], z: b[2], w: b[3] } : { x: -1e9, y: -1e9, z: 1e9, w: 1e9 });
        if (!built.data.material) {
            const d = built.data;
            for (const [i, c] of [d.layerColor0, d.layerColor1, d.layerColor2, d.layerColor3].entries()) set(`u_tint${i}`, { x: c.r, y: c.g, z: c.b, w: c.a });
        }
        this.place(app, entity, built, drawn);
    }

    /** Makes the wanted pages, coarse and near first, for as long as the frame can spare. */
    private makePages(app: App, built: Built, source: TerrainSource, eye: [number, number, number], at: { x: number; y: number; z: number }): void {
        const paint = app.getResource(TerrainsRes).paint_;
        const repaint: Repaint | undefined = paint ? (x, z, h, ny, w) => paint(x + at.x, z + at.z, h + at.y, ny, w) : undefined;
        const bakes = bakesOf(app);
        if (built.wanted.size === 0) { bakes.mark(built, 'Building the terrain', 1); return; }
        const order = [...built.wanted.values()].sort((a, b) => b.level - a.level
            || Math.hypot(a.x0 + a.size / 2 - eye[0], a.z0 + a.size / 2 - eye[2]) - Math.hypot(b.x0 + b.size / 2 - eye[0], b.z0 + b.size / 2 - eye[2]));
        let made = 0;
        const store = (key: string, image: PageImage): boolean => {
            const page = built.table.claim(key, image.min, image.max);
            if (!page) return false;
            const [ox, oy] = built.table.origin(page.slot);
            updateTextureSubregion(app.wasmModule, built.heights, ox, oy, PAGE_SIDE, PAGE_SIDE, image.heights);
            updateTextureSubregion(app.wasmModule, built.paint, ox, oy, PAGE_SIDE, PAGE_SIDE, image.paint);
            return true;
        };
        const epoch = built.epoch;
        for (const node of order) {
            const key = nodeKey(node.level, node.ix, node.iz);
            if (built.asked.has(key)) continue;
            if (source.region && built.asked.size >= PAGES_IN_FLIGHT) break;
            const image = makePage(source, node.x0, node.z0, node.size, repaint);
            if (image instanceof Promise) {
                // A provider answering later: its page is stored when it lands, if the terrain is still the one that asked.
                built.asked.add(key);
                void image.then((img) => {
                    built.asked.delete(key);
                    if (built.epoch === epoch && built.heights) store(key, img);
                }, (e) => {
                    built.asked.delete(key);
                    log.warn('terrain', `the provider failed a page (${key})`, e);
                });
                continue;
            }
            if (!store(key, image)) break;
            built.wanted.delete(key);
            made++;
            // The frame's one budget, shared with the bakes and the chunks of the world; at least one page a frame.
            if (!bakes.hasTime()) break;
        }
        bakes.mark(built, 'Building the terrain', made === 0 ? 0 : 1 - built.wanted.size / (built.wanted.size + made));
    }

    /** Puts a node entity on each node drawn (reusing the ones it had), and takes the rest away. */
    private place(app: App, entity: Entity, built: Built, drawn: Map<string, TerrainNode>): void {
        const world = app.world;
        for (const [key, e] of built.nodes) {
            if (drawn.has(key)) continue;
            built.nodes.delete(key);
            if (!world.valid(e)) continue;
            const mr = world.get(e, MeshRenderer) as MeshRendererData;
            if (mr.enabled) world.insert(e, MeshRenderer, { ...mr, enabled: false });
            built.spare.push(e);
        }
        for (const [key, n] of drawn) {
            const page = built.table.get(key)!;
            built.table.touch(key);
            let e = built.nodes.get(key);
            if (e === undefined || !world.valid(e)) {
                e = built.spare.pop();
                if (e === undefined || !world.valid(e)) {
                    e = world.spawn('TerrainNode');
                    world.insert(e, Transform, {});
                    world.setParent(e, entity);
                }
                built.nodes.set(key, e);
            }
            const [ox, oy] = built.table.origin(page.slot);
            // The tint names the page and the level (see the Terrain shader's hook): every channel above zero, as the hook divides by it.
            const color = { r: (ox + 0.5) / ATLAS_SIZE, g: (oy + 0.5) / ATLAS_SIZE, b: (n.level + 1) / 64, a: 1 };
            const position = { x: n.x0, y: page.min, z: n.z0 };
            const scale = { x: n.size, y: Math.max(page.max - page.min, 1e-3), z: n.size };
            const t = world.get(e, Transform) as TransformData;
            if (t.position.x !== position.x || t.position.y !== position.y || t.position.z !== position.z || t.scale.x !== scale.x || t.scale.y !== scale.y) {
                world.insert(e, Transform, { ...t, position, scale });
            }
            const mr = world.tryGet(e, MeshRenderer) as MeshRendererData | null;
            if (!mr || !mr.enabled || mr.color.r !== color.r || mr.color.g !== color.g || mr.color.b !== color.b || mr.material !== built.instance) {
                world.insert(e, MeshRenderer, {
                    ...(mr ?? {}), mesh: built.mesh, material: built.instance, lit: true, opaque: true, cullBackfaces: true, color, enabled: true,
                } as Partial<MeshRendererData>);
            }
        }
    }

    private destroy(app: App, built: Built): void {
        built.epoch++;
        built.cancel?.();
        built.cancel = null;
        bakesOf(app).clear(built);
        for (const e of [...built.nodes.values(), ...built.spare]) if (app.world.valid(e)) app.world.despawn(e);
        built.nodes.clear();
        built.spare.length = 0;
        built.wanted.clear();
        const rm = getResourceManager();
        for (const handle of [built.heights, built.paint]) {
            if (!handle) continue;
            withdrawTextureContent(handle);
            rm?.releaseTexture(handle);
        }
        built.heights = built.paint = 0;
        if (built.instance) Material.release(built.instance);
        built.instance = 0;
        if (built.mesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(built.mesh);
        built.mesh = 0;
        built.source = null;
    }

    /** Releases the nodes of a terrain whose entity is gone. */
    private sweep(app: App, terrains: Terrains): void {
        for (const [entity, built] of terrains.built_) {
            if (app.world.valid(entity) && app.world.has(entity, Terrain)) continue;
            chunksOf(app).remove(collisionLayerOf(entity));
            this.destroy(app, built);
            terrains.built_.delete(entity);
            terrains.revision_++;
        }
    }
}

export const terrainPlugin: Plugin = new TerrainPlugin();
