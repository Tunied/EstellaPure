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
import { erosionJob, heightfieldFromPixels, proceduralHeightfield } from './heightfield';
import { FieldSource, NoiseSource, type TerrainSource } from './source';
import { levelRange, nodeKey, parentOf, selectNodes, type QuadtreeParams, type TerrainNode } from './quadtree';
import { makePage, PageTable, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS } from './pages';
import { buildPatchMesh } from './patch';

/** How far the ground goes: an area of its own size, or for ever. */
export const TerrainExtent = { Area: 0, Infinite: 1 } as const;

/** The fields of the `Terrain` component. @experimental */
export interface TerrainData {
    /** {@link TerrainExtent}: an area `sizeX` by `sizeZ`, or ground that goes on for ever (noise read anywhere, the same for a seed). */
    extent: number;
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
    extent: TerrainExtent.Area, heightmap: 0, splatmap: 0, material: 0,
    sizeX: 1000, sizeZ: 1000, height: 150, cellSize: 2, detail: 1, drawDistance: 4000,
    seed: 1, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.35, resolution: 257, warp: 0, erosion: 0,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88,
    layerColor0: rgb(0.28, 0.46, 0.2), layerColor1: rgb(0.45, 0.36, 0.24), layerColor2: rgb(0.93, 0.95, 0.98), layerColor3: rgb(0.4, 0.38, 0.36),
}, {
    assetFields: [{ field: 'heightmap', type: 'texture' }, { field: 'splatmap', type: 'texture' }, { field: 'material', type: 'material' }],
    fields: {
        extent: { enum: [{ label: 'Area', value: TerrainExtent.Area }, { label: 'Infinite', value: TerrainExtent.Infinite }], category: 'Shape', tooltip: 'An area of its own size, from a heightmap or noise; or ground that goes on for ever, from noise read anywhere (the same seed is the same ground).' },
        heightmap: { tooltip: 'A heightmap image: red is the height. Empty makes the ground from noise.', category: 'Shape', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        splatmap: { tooltip: 'An image whose red, green, blue and alpha are the weights of grass, dirt, snow and rock.', category: 'Layers', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        material: { tooltip: 'A material on the Terrain shader. Empty draws the layer colours onto the ground.', category: 'Layers' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'An area\'s size along x; for ground without end, the span its hills are spread over.' },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'An area\'s size along z.', shownWhen: { field: 'extent', values: [TerrainExtent.Area] } },
        height: { min: 0, category: 'Shape', tooltip: 'World height of the highest ground.' },
        cellSize: { min: 0.01, category: 'Detail', tooltip: 'The finest cell of the ground\'s mesh, in world units: what it is drawn at near the eye. Further off the cells double, level by level.' },
        detail: { min: 0.25, max: 8, step: 0.05, category: 'Detail', tooltip: 'Above 1 the finest cells reach further out before the ground coarsens.' },
        drawDistance: { min: 1, category: 'Detail', tooltip: 'How far ground without end is drawn.', shownWhen: { field: 'extent', values: [TerrainExtent.Infinite] } },
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
/** How long a frame may spend making pages, in milliseconds; at least one is made a frame while any is wanted. */
const PAGE_BUDGET_MS = 5;

/** What the plugin knows about one terrain it has built. */
interface Built {
    signature: string;
    data: TerrainData;
    source: TerrainSource | null;
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
    pending: boolean;
}

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
            if (!built.source || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const h = built.source.height(x - t.worldPosition.x, z - t.worldPosition.z);
            if (h !== null) return t.worldPosition.y + h;
        }
        return null;
    }

    /** Where the ground faces at (x, z) (a unit normal), or null where no terrain is. */
    normalAt(x: number, z: number): [number, number, number] | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const [entity, built] of this.built_) {
            const source = built.source;
            if (!source || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const lx = x - t.worldPosition.x, lz = z - t.worldPosition.z;
            if (source instanceof FieldSource || source instanceof NoiseSource) {
                const n = source.normal(lx, lz);
                if (n) return n;
            }
        }
        return null;
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

/** What, changed, rebuilds the ground: everything but the colours and the detail, which are written each frame. */
function signatureOf(data: TerrainData): string {
    const { layerColor0: _a, layerColor1: _b, layerColor2: _c, layerColor3: _d, detail: _e, drawDistance: _f, ...shape } = data;
    return JSON.stringify(shape);
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
            if (!app.hasResource(Assets)) return;
            this.sweep(app, terrains);
            for (const entity of app.world.getEntitiesWithComponents([Terrain, Transform])) {
                const data = app.world.get(entity, Terrain) as TerrainData;
                const signature = signatureOf(data);
                let built = terrains.built_.get(entity);
                if (!built || built.signature !== signature) {
                    if (built) this.destroy(app, built);
                    built = {
                        signature, data: { ...data }, source: null, epoch: (built?.epoch ?? 0) + 1, loading: true, cancel: null,
                        table: new PageTable(ATLAS_SIZE), heights: 0, paint: 0, mesh: 0, instance: 0,
                        nodes: new Map(), spare: [], wanted: new Map(), pending: false,
                    };
                    terrains.built_.set(entity, built);
                    void this.load(app, entity, built);
                    continue;
                }
                built.data = { ...data };
                if (built.loading || !built.source) continue;
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
        for (const built of terrains.built_.values()) this.destroy(app, built);
        terrains.built_.clear();
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** Reads the images the terrain names (or makes its noise, and wears it), and makes its source. */
    private async load(app: App, entity: Entity, built: Built): Promise<void> {
        const epoch = built.epoch;
        const data = built.data;
        try {
            if (data.extent === TerrainExtent.Infinite) {
                built.source = new NoiseSource(data);
            } else {
                const height = await this.pixelsOf(app, data.heightmap);
                const splat = await this.pixelsOf(app, data.splatmap);
                if (built.epoch !== epoch || !app.world.valid(entity)) return;
                const made = height
                    ? heightfieldFromPixels(height.width, height.height, height.pixels)
                    : proceduralHeightfield({
                        resolution: Math.min(2049, Math.max(17, Math.floor(data.resolution))), seed: data.seed, frequency: data.frequency,
                        octaves: data.octaves, persistence: data.persistence, ridged: data.ridged, warp: data.warp,
                    });
                let field = made, flow: Float32Array | null = null;
                if (data.erosion > 0) {
                    // Rain over a big field is seconds of work: it is spread over frames, and shown while it runs.
                    const job = bakesOf(app).run('Eroding the terrain',
                        erosionJob(made, { amount: data.erosion, seed: data.seed, sizeX: data.sizeX, sizeZ: data.sizeZ, height: data.height }));
                    built.cancel = job.cancel;
                    const worn = await job.done;
                    built.cancel = null;
                    if (built.epoch !== epoch || !app.world.valid(entity)) return;
                    field = worn.field;
                    flow = worn.flow;
                }
                built.source = new FieldSource(field, data, splat, flow);
            }
            app.getResource(TerrainsRes).revision_++;
        } catch (e) {
            log.error('terrain', 'building the terrain failed', e);
        } finally {
            if (built.epoch === epoch) built.loading = false;
        }
    }

    private async pixelsOf(app: App, handle: number): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
        if (!handle) return null;
        const assets = app.getResource(Assets);
        const path = assets.pathForHandle('texture', handle);
        if (!path) { log.warn('terrain', `no source image is known for texture ${handle}; the terrain falls back to its noise`); return null; }
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
        this.makePages(app, built, source, tree, eyeAt);

        const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
        set('u_heightRange', { x: source.minHeight, y: Math.max(source.maxHeight - source.minHeight, 1e-6) });
        set('u_lodRange0', tree.range0);
        set('u_terrainOrigin', { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z, w: 0 });
        const b = source.bounds;
        set('u_terrainBounds', b ? { x: b[0], y: b[1], z: b[2], w: b[3] } : { x: -1e9, y: -1e9, z: 1e9, w: 1e9 });
        if (!built.data.material) {
            const d = built.data;
            for (const [i, c] of [d.layerColor0, d.layerColor1, d.layerColor2, d.layerColor3].entries()) set(`u_tint${i}`, { x: c.r, y: c.g, z: c.b, w: c.a });
        }
        this.place(app, entity, built, drawn);
    }

    /** Makes the wanted pages, coarse and near first, for as long as the frame can spare. */
    private makePages(app: App, built: Built, source: TerrainSource, tree: QuadtreeParams, eye: [number, number, number]): void {
        const bakes = bakesOf(app);
        if (built.wanted.size === 0) { bakes.mark(built, 'Building the terrain', 1); return; }
        const order = [...built.wanted.values()].sort((a, b) => b.level - a.level
            || Math.hypot(a.x0 + a.size / 2 - eye[0], a.z0 + a.size / 2 - eye[2]) - Math.hypot(b.x0 + b.size / 2 - eye[0], b.z0 + b.size / 2 - eye[2]));
        const until = performance.now() + PAGE_BUDGET_MS;
        let made = 0;
        for (const node of order) {
            const key = nodeKey(node.level, node.ix, node.iz);
            const image = makePage(source, node.x0, node.z0, node.size);
            const page = built.table.claim(key, image.min, image.max);
            if (!page) break;
            const [ox, oy] = built.table.origin(page.slot);
            updateTextureSubregion(app.wasmModule, built.heights, ox, oy, PAGE_SIDE, PAGE_SIDE, image.heights);
            updateTextureSubregion(app.wasmModule, built.paint, ox, oy, PAGE_SIDE, PAGE_SIDE, image.paint);
            built.wanted.delete(key);
            made++;
            if (performance.now() >= until) break;
        }
        bakes.mark(built, 'Building the terrain', made === 0 ? 0 : 1 - built.wanted.size / (built.wanted.size + made));
        void tree;
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
            this.destroy(app, built);
            terrains.built_.delete(entity);
            terrains.revision_++;
        }
    }
}

export const terrainPlugin: Plugin = new TerrainPlugin();
