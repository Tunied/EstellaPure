// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    terrainPlugin.ts
 * @brief   Ground: a heightmap (or noise) cut into chunks that draw themselves at the detail their size on screen deserves.
 *
 * @details The `Terrain` component says what the ground is; this builds it. The entity stays as authored and
 *          the chunks are its children, spawned here and rebuilt whenever the component changes, so there is
 *          nothing to bake and nothing to keep in step: edit a field and the ground follows.
 *
 *          Each chunk is an ordinary MeshRenderer with an ordinary LODGroup (see mesh.ts for how a chunk and
 *          its coarser levels are made), so culling, shadows, picking and the level-of-detail choice are the
 *          engine's and need to know nothing about terrain. The chunks are built a few a frame, so a large
 *          terrain appears over a moment instead of stalling one.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import { platformLoadImagePixels } from '../platform/base';
import { decodeImagePixels } from '../asset/imageDecode';
import { log } from '../util/logger';
import type { Color, Entity } from '../types';
import {
    heightfieldFromPixels, proceduralHeightfield, sampleHeight, terrainNormal, type Heightfield,
} from './heightfield';
import { buildChunkMesh, chunkCenter, lodCount, type TerrainPaint, type TerrainShape } from './mesh';

/** The fields of the `Terrain` component. @experimental */
export interface TerrainData {
    /** A heightmap image: red is the height (green, if it is not just grey, its low byte). Empty makes the ground from noise. */
    heightmap: number;
    /** An image whose four channels are the weights of the four layers; empty paints by height and slope. */
    splatmap: number;
    /** A material on the Terrain shader. Empty draws the layer colours straight onto the ground. */
    material: number;
    /** World size along x and z; the terrain is centred on its entity. */
    sizeX: number;
    sizeZ: number;
    /** World height of the highest ground. */
    height: number;
    /** Chunks along each side. */
    chunks: number;
    /** Cells along a chunk's side at its finest level. */
    chunkCells: number;
    /** How many levels of detail each chunk has, 1 to 4. */
    lodLevels: number;
    /** Above 1, chunks keep their finer levels out to a greater distance. */
    detail: number;
    /** Noise ground: the seed, how many hills across, how many octaves, how rough, how ridged, and how many samples. */
    seed: number;
    frequency: number;
    octaves: number;
    persistence: number;
    ridged: number;
    resolution: number;
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
 * The ground. Presence is the opt-in; its children are drawn at the detail their size on screen deserves.
 *
 * @experimental
 */
export const Terrain: ComponentDef<TerrainData> = defineComponent<TerrainData>('Terrain', {
    heightmap: 0, splatmap: 0, material: 0,
    sizeX: 1000, sizeZ: 1000, height: 150,
    chunks: 8, chunkCells: 32, lodLevels: 4, detail: 1,
    seed: 1, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.35, resolution: 257,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88,
    layerColor0: rgb(0.28, 0.46, 0.2), layerColor1: rgb(0.45, 0.36, 0.24), layerColor2: rgb(0.93, 0.95, 0.98), layerColor3: rgb(0.4, 0.38, 0.36),
}, {
    assetFields: [{ field: 'heightmap', type: 'texture' }, { field: 'splatmap', type: 'texture' }, { field: 'material', type: 'material' }],
    fields: {
        heightmap: { tooltip: 'A heightmap image: red is the height. Empty makes the ground from noise.', category: 'Shape' },
        splatmap: { tooltip: 'An image whose red, green, blue and alpha are the weights of grass, dirt, snow and rock.', category: 'Layers' },
        material: { tooltip: 'A material on the Terrain shader. Empty draws the layer colours onto the ground.', category: 'Layers' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'World size along x.' },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'World size along z.' },
        height: { min: 0, category: 'Shape', tooltip: 'World height of the highest ground.' },
        chunks: { min: 1, max: 64, step: 1, category: 'Detail', tooltip: 'Chunks along each side; each is drawn and culled on its own.' },
        chunkCells: { min: 2, max: 128, step: 1, category: 'Detail', tooltip: 'Cells along a chunk side at its finest level. A power of two keeps the levels clean.' },
        lodLevels: { min: 1, max: 4, step: 1, category: 'Detail', tooltip: 'Levels of detail per chunk, each half as fine as the one before.' },
        detail: { min: 0.1, max: 8, step: 0.1, category: 'Detail', tooltip: 'Above 1 the finer levels are kept out to a greater distance.' },
        seed: { step: 1, category: 'Noise', tooltip: 'Another seed is another ground.' },
        frequency: { min: 0.1, max: 32, step: 0.1, category: 'Noise', tooltip: 'How many hills across the terrain.' },
        octaves: { min: 1, max: 8, step: 1, category: 'Noise', tooltip: 'Layers of detail in the noise.' },
        persistence: { min: 0, max: 1, step: 0.01, category: 'Noise', tooltip: 'How much of its height each finer layer keeps. Lower is smoother.' },
        ridged: { min: 0, max: 1, step: 0.01, category: 'Noise', tooltip: '0 is rolling hills; 1 is sharp ridges.' },
        resolution: { min: 17, max: 2049, step: 1, category: 'Noise', tooltip: 'Samples along each side of the noise ground.' },
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

/** The weights of grass, dirt, snow and rock at a point of ground, by how high and how steep it is. */
export function paintWeights(h: number, ny: number, t: Pick<TerrainData, 'rockSlope' | 'dirtHeight' | 'snowHeight'>): [number, number, number, number] {
    const rock = smooth(t.rockSlope - 0.08, t.rockSlope + 0.08, 1 - ny);
    const snow = smooth(t.snowHeight - 0.06, t.snowHeight + 0.06, h) * (1 - rock * 0.85);
    const dirt = smooth(t.dirtHeight - 0.15, t.dirtHeight + 0.15, h) * (1 - snow) * (1 - rock);
    const grass = (1 - rock) * (1 - snow) * (1 - dirt);
    const sum = grass + dirt + snow + rock || 1;
    return [grass / sum, dirt / sum, snow / sum, rock / sum];
}

/** What the plugin knows about one terrain it has built. */
interface Built {
    signature: string;
    field: Heightfield | null;
    data: TerrainData;
    handles: number[];
    chunks: Entity[];
    queue: [number, number][];
    splat: { width: number; height: number; pixels: Uint8Array } | null;
    materialHandle: number;
    /** Bumped on every rebuild so an answer that arrives for an older one is thrown away. */
    epoch: number;
    loading: boolean;
}

/** Chunks built per frame: enough that a terrain appears quickly, few enough that no frame is a stall. */
const CHUNKS_PER_FRAME = 4;

/** Run-time access to the ground: how high it is anywhere, for putting things on it. */
export class Terrains {
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ app_: App | null = null;

    /**
     * The world height of the ground at (x, z), or null where no terrain is. The terrain's own position and
     * uniform scale are taken into account; a rotation about y is not.
     */
    heightAt(x: number, z: number): number | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const [entity, built] of this.built_) {
            if (!built.field || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1, sy = t.worldScale.y || 1;
            const u = (x - t.worldPosition.x) / (built.data.sizeX * sx) + 0.5;
            const v = (z - t.worldPosition.z) / (built.data.sizeZ * sz) + 0.5;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;
            return t.worldPosition.y + sampleHeight(built.field, u, v) * built.data.height * sy;
        }
        return null;
    }

    /** Where the ground faces at (x, z) (a unit normal), or null where no terrain is. */
    normalAt(x: number, z: number): [number, number, number] | null {
        const world = this.app_?.world;
        if (!world) return null;
        for (const [entity, built] of this.built_) {
            if (!built.field || !world.valid(entity)) continue;
            const t = world.tryGet(entity, Transform) as TransformData | null;
            if (!t) continue;
            const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1, sy = t.worldScale.y || 1;
            const u = (x - t.worldPosition.x) / (built.data.sizeX * sx) + 0.5;
            const v = (z - t.worldPosition.z) / (built.data.sizeZ * sz) + 0.5;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;
            return terrainNormal(built.field, u, v, built.data.sizeX * sx, built.data.sizeZ * sz, built.data.height * sy);
        }
        return null;
    }

    /** @internal Bumped whenever a terrain's ground changes, so what stands on it knows to stand again. */
    revision_ = 0;

    /** Whether any terrain is still reading its images: its ground is not known yet. */
    get loading(): boolean {
        for (const b of this.built_.values()) if (b.loading) return true;
        return false;
    }

    /** How many chunks across every terrain are still waiting to be built. */
    get pending(): number {
        let n = 0;
        for (const b of this.built_.values()) n += b.queue.length + (b.loading ? 1 : 0);
        return n;
    }
}

/** The resource the plugin installs. @experimental */
export const TerrainsRes = defineResource<Terrains>(new Terrains(), 'Terrains');

function signatureOf(data: TerrainData): string {
    return JSON.stringify(data);
}

function shapeOf(data: TerrainData): TerrainShape {
    return {
        sizeX: Math.max(1, data.sizeX), sizeZ: Math.max(1, data.sizeZ), height: Math.max(0, data.height),
        chunks: Math.min(64, Math.max(1, Math.floor(data.chunks))), chunkCells: Math.min(128, Math.max(2, Math.floor(data.chunkCells))),
    };
}

export class TerrainPlugin implements Plugin {
    name = 'terrain';

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
                        signature, field: null, data: { ...data }, handles: [], chunks: [], queue: [], splat: null,
                        materialHandle: data.material, epoch: (built?.epoch ?? 0) + 1, loading: true,
                    };
                    terrains.built_.set(entity, built);
                    void this.load(app, entity, built);
                    continue;
                }
                if (built.loading) continue;
                for (let i = 0; i < CHUNKS_PER_FRAME && built.queue.length > 0; i++) {
                    const [cx, cz] = built.queue.shift()!;
                    this.buildChunk(app, entity, built, cx, cz);
                }
            }
        }, { name: 'TerrainSystem' }));
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(TerrainsRes)) return;
        const terrains = app.getResource(TerrainsRes);
        for (const built of terrains.built_.values()) this.destroy(app, built);
        terrains.built_.clear();
    }

    /** Reads the images the terrain names (or makes the noise), then queues its chunks. */
    private async load(app: App, entity: Entity, built: Built): Promise<void> {
        const epoch = built.epoch;
        const assets = app.getResource(Assets);
        const data = built.data;
        const pixelsOf = async (handle: number): Promise<{ width: number; height: number; pixels: Uint8Array } | null> => {
            if (!handle) return null;
            const path = assets.pathForHandle('texture', handle);
            if (!path) { log.warn('terrain', `no source image is known for texture ${handle}; the terrain falls back to its noise`); return null; }
            try {
                // The bytes the asset layer would load, decoded unmodified (no premultiply, no colour conversion): a height is data.
                if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
                    return await decodeImagePixels(new Blob([await assets.fetchBinary(path)]));
                }
                const image = await platformLoadImagePixels(assets.resolveLoadPath(path));
                return { width: image.width, height: image.height, pixels: image.pixels };
            } catch (e) {
                log.warn('terrain', `reading ${path} failed`, e);
                return null;
            }
        };
        try {
            const height = await pixelsOf(data.heightmap);
            const splat = await pixelsOf(data.splatmap);
            if (built.epoch !== epoch || !app.world.valid(entity)) return;
            built.field = height
                ? heightfieldFromPixels(height.width, height.height, height.pixels)
                : proceduralHeightfield({
                    resolution: Math.min(2049, Math.max(17, Math.floor(data.resolution))), seed: data.seed, frequency: data.frequency,
                    octaves: data.octaves, persistence: data.persistence, ridged: data.ridged,
                });
            built.splat = splat;
            app.getResource(TerrainsRes).revision_++;
            const shape = shapeOf(data);
            for (let cz = 0; cz < shape.chunks; cz++) for (let cx = 0; cx < shape.chunks; cx++) built.queue.push([cx, cz]);
        } catch (e) {
            log.error('terrain', 'building the terrain failed', e);
        } finally {
            if (built.epoch === epoch) built.loading = false;
        }
    }

    private paintFor(built: Built): TerrainPaint {
        const data = built.data;
        const colors = [data.layerColor0, data.layerColor1, data.layerColor2, data.layerColor3];
        const splat = built.splat;
        const textured = built.materialHandle !== 0;
        return (u, v, h, ny) => {
            let w = paintWeights(h, ny, data);
            if (splat) {
                const x = Math.min(splat.width - 1, Math.max(0, Math.round(u * (splat.width - 1))));
                const y = Math.min(splat.height - 1, Math.max(0, Math.round(v * (splat.height - 1))));
                const at = (y * splat.width + x) * 4;
                const s: [number, number, number, number] = [splat.pixels[at]! / 255, splat.pixels[at + 1]! / 255, splat.pixels[at + 2]! / 255, splat.pixels[at + 3]! / 255];
                const sum = s[0] + s[1] + s[2] + s[3];
                if (sum > 0.001) w = [s[0] / sum, s[1] / sum, s[2] / sum, s[3] / sum];
            }
            // A material reads the weights; with none the colours are mixed here and the ground is drawn in them.
            if (textured) return w;
            return [
                w[0] * colors[0]!.r + w[1] * colors[1]!.r + w[2] * colors[2]!.r + w[3] * colors[3]!.r,
                w[0] * colors[0]!.g + w[1] * colors[1]!.g + w[2] * colors[2]!.g + w[3] * colors[3]!.g,
                w[0] * colors[0]!.b + w[1] * colors[1]!.b + w[2] * colors[2]!.b + w[3] * colors[3]!.b,
                1,
            ];
        };
    }

    private buildChunk(app: App, parent: Entity, built: Built, cx: number, cz: number): void {
        const world = app.world;
        if (!built.field || !world.valid(parent)) return;
        const assets = app.getResource(Assets);
        const shape = shapeOf(built.data);
        const levels = lodCount(shape, Math.min(4, Math.max(1, Math.floor(built.data.lodLevels))));
        const paint = this.paintFor(built);
        const handles: number[] = [];
        for (let lod = 0; lod < levels; lod++) {
            const handle = assets.createMesh(buildChunkMesh(built.field, shape, cx, cz, lod, paint));
            if (handle === 0) {
                log.warn('terrain', `the engine refused the geometry of chunk ${cx},${cz} at level ${lod}`);
                for (const h of handles) assets.releaseBuiltMesh(h);
                return;
            }
            handles.push(handle);
        }
        built.handles.push(...handles);
        const [x, z] = chunkCenter(shape, cx, cz);
        const chunk = world.spawn(`TerrainChunk ${cx},${cz}`);
        world.insert(chunk, Transform, { position: { x, y: 0, z } });
        world.insert(chunk, MeshRenderer, {
            mesh: handles[0]!, material: built.materialHandle, lit: true, opaque: true, cullBackfaces: false,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        const lodDef = getComponent('LODGroup');
        if (lodDef && handles.length > 1) {
            const k = 1 / Math.max(0.1, built.data.detail);
            world.insert(chunk, lodDef, {
                lod1: handles[1] ?? 0, lod2: handles[2] ?? 0, lod3: handles[3] ?? 0,
                lod1Size: 0.2 * k, lod2Size: 0.09 * k, lod3Size: 0.04 * k, cullSize: 0, hysteresis: 0.1, enabled: true,
            });
        }
        world.setParent(chunk, parent);
        built.chunks.push(chunk);
    }

    private destroy(app: App, built: Built): void {
        built.epoch++;
        built.queue.length = 0;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const chunk of built.chunks) if (app.world.valid(chunk)) app.world.despawn(chunk);
        for (const handle of built.handles) assets?.releaseBuiltMesh(handle);
        built.chunks.length = 0;
        built.handles.length = 0;
    }

    /** Releases the chunks of a terrain whose entity is gone. */
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
