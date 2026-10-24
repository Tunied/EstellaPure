// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    provider.ts
 * @brief   Ground made by a generator a game names: one function of the world's position, versioned, the same on every machine.
 *
 * @details A provider samples the ground over a region it is handed: a world, a seed, a generator version, a corner in world units, a
 *          spacing and a count. Every region is the same function read at other points, so two regions that share an edge share its
 *          samples, a coarse page and a fine one agree where their samples coincide, and the order regions are asked in changes nothing.
 *          The client draws from it, the server answers from it, and what stands on the ground is placed by it: one source.
 *
 *          A version names an algorithm for good. A saved world keeps the version it was made with; a provider that changes its algorithm
 *          adds a version and keeps the old one, and a terrain asking for a version its provider does not have fails, loudly, rather than
 *          growing other ground under what was built on it. The engine's own noise is the provider `estella:noise`, version 1.
 */
import type { TerrainSource } from './source';
import { NoiseSource, type NoiseParams } from './source';

/** Where and how finely a provider is asked to sample. */
export interface TerrainRegion {
    /** The world (a planet, a level) the ground belongs to, as the game names it. */
    world: string;
    seed: number;
    /** The generator version the world was made with. */
    version: number;
    /** The world position of the first sample, and the distance between samples along x and z. */
    x0: number;
    z0: number;
    spacing: number;
    /** Samples along each side: `count * count` of them, row by row from z0, each row from x0. */
    count: number;
}

/** What a provider answers for a region: heights in world units and, if it paints the ground, four layer weights a sample. */
export interface TerrainSamples {
    heights: Float32Array;
    /** Grass, dirt, snow, rock, 0 to 1, four a sample; absent leaves the terrain to paint by height and slope. */
    paint?: Float32Array;
}

/** A generator of ground. */
export interface TerrainProvider {
    /** The name a Terrain asks for it by. */
    readonly id: string;
    /** The generator versions it can still make. */
    readonly versions: readonly number[];
    /** The least and most height its ground can have for this seed and version: what the GPU encodes heights over. */
    range(seed: number, version: number): [number, number];
    /** The ground over a region. May answer later (a worker, a server); must answer the same for the same region every time. */
    sample(region: TerrainRegion): TerrainSamples | Promise<TerrainSamples>;
    /** The height at one point, for a provider that can answer one at once; without it a point is answered from sampled regions. */
    heightAt?(world: string, seed: number, version: number, x: number, z: number): number;
}

const providers_ = new Map<string, TerrainProvider>();
let revision_ = 0;

/**
 * Makes `provider` available to every Terrain that names it. A second provider under the same id replaces the first. A terrain that
 * named one not yet registered (a script registers it after the scene loaded) is made once it is.
 */
export function registerTerrainProvider(provider: TerrainProvider): void {
    providers_.set(provider.id, provider);
    revision_++;
}

/** @internal Bumped on every registration, so a terrain whose provider was missing asks again. */
export function terrainProvidersRevision(): number {
    return revision_;
}

/** The provider registered under `id`, if any. */
export function terrainProvider(id: string): TerrainProvider | undefined {
    return providers_.get(id);
}

/** Why a terrain's ground could not be made. */
export class TerrainUnavailable extends Error {}

/** The size of the tiles a point is answered from when its provider has no `heightAt`: this many samples a side. */
const POINT_TILE = 33;

/** Ground from a provider, as a terrain draws and answers it. Positions are world positions less the terrain's own. */
export class ProviderSource implements TerrainSource {
    readonly infinite = true;
    readonly bounds = null;
    readonly minHeight: number;
    readonly maxHeight: number;
    /** Tiles of samples a point is answered from, by key; a tile asked for and not yet answered is a promise. */
    private readonly tiles_ = new Map<string, TerrainSamples | Promise<TerrainSamples>>();

    constructor(
        readonly provider: TerrainProvider,
        readonly world: string,
        readonly seed: number,
        readonly version: number,
        /** The terrain's own position, which the provider's world positions are offset by. */
        private readonly originX: number,
        private readonly originZ: number,
        /** The spacing a point's tile is sampled at: the finest the terrain is drawn at. */
        private readonly pointSpacing: number,
        private readonly paintRules: (h: number, ny: number) => [number, number, number, number],
    ) {
        if (!provider.versions.includes(version)) {
            throw new TerrainUnavailable(`the terrain provider ${provider.id} has no version ${version} (it has ${provider.versions.join(', ') || 'none'})`);
        }
        [this.minHeight, this.maxHeight] = provider.range(seed, version);
    }

    /** The ground over a region of the terrain's space, from the provider. */
    region(x0: number, z0: number, spacing: number, count: number): TerrainSamples | Promise<TerrainSamples> {
        return this.provider.sample({ world: this.world, seed: this.seed, version: this.version, x0: x0 + this.originX, z0: z0 + this.originZ, spacing, count });
    }

    height(x: number, z: number): number | null {
        const p = this.provider;
        if (p.heightAt) return p.heightAt(this.world, this.seed, this.version, x + this.originX, z + this.originZ);
        // From the tile the point falls in, bilinear between its samples (the same samples the pages hold at the finest level).
        const span = this.pointSpacing * (POINT_TILE - 1);
        const tx = Math.floor(x / span), tz = Math.floor(z / span);
        const key = `${tx}:${tz}`;
        let tile = this.tiles_.get(key);
        if (!tile) {
            tile = this.region(tx * span, tz * span, this.pointSpacing, POINT_TILE);
            this.tiles_.set(key, tile);
            if (tile instanceof Promise) void tile.then((t) => this.tiles_.set(key, t), () => this.tiles_.delete(key));
        }
        if (tile instanceof Promise) return null;
        const fx = (x - tx * span) / this.pointSpacing, fz = (z - tz * span) / this.pointSpacing;
        const i = Math.min(Math.floor(fx), POINT_TILE - 2), j = Math.min(Math.floor(fz), POINT_TILE - 2);
        const u = fx - i, v = fz - j, h = tile.heights, n = POINT_TILE;
        const a = h[j * n + i]!, b = h[j * n + i + 1]!, c = h[(j + 1) * n + i]!, d = h[(j + 1) * n + i + 1]!;
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    /** The normal at (x, z), from the heights a spacing either side; null where they are not known yet. */
    normal(x: number, z: number): [number, number, number] | null {
        const e = this.pointSpacing;
        const l = this.height(x - e, z), r = this.height(x + e, z), d = this.height(x, z - e), u = this.height(x, z + e);
        if (l === null || r === null || d === null || u === null) return null;
        const sx = (r - l) / (2 * e), sz = (u - d) / (2 * e);
        const len = Math.hypot(sx, 1, sz);
        return [-sx / len, 1 / len, -sz / len];
    }

    paint(_x: number, _z: number, h: number, ny: number): [number, number, number, number] {
        return this.paintRules(h, ny);
    }
}

/** The engine's own ground without end: seeded noise of the world's position, as `estella:noise` version 1. */
export function noiseProvider(params: (seed: number) => NoiseParams): TerrainProvider {
    const sources = new Map<number, NoiseSource>();
    const source = (seed: number): NoiseSource => {
        let s = sources.get(seed);
        if (!s) { s = new NoiseSource(params(seed)); sources.set(seed, s); }
        return s;
    };
    return {
        id: 'estella:noise',
        versions: [1],
        range: (seed) => [0, source(seed).maxHeight],
        sample(r) {
            const s = source(r.seed);
            const heights = new Float32Array(r.count * r.count);
            for (let j = 0; j < r.count; j++) for (let i = 0; i < r.count; i++) heights[j * r.count + i] = s.height(r.x0 + i * r.spacing, r.z0 + j * r.spacing);
            return { heights };
        },
        heightAt: (_world, seed, _version, x, z) => source(seed).height(x, z),
    };
}
