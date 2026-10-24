// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zone.ts
 * @brief   A water zone: every body of water in a region baked into one field, which one surface is drawn from.
 *
 * @details Bodies of water drawn each as a mesh of its own are separate surfaces, and where a river runs into a lake or the sea they meet
 *          along a seam: two heights, two sets of waves, a shore foaming across the river's mouth, a ribbon's edge showing over the lake.
 *          So a body of water is not drawn: it is an INPUT. A zone gathers the bodies over its region and bakes them into a grid, each
 *          texel holding what the water is there:
 *            - the height of its surface (a lake's level, the height of a river's curve at its nearest place, the sea's level);
 *            - the signed distance to the nearest shore (positive on the water): where the surface is cut and where it foams;
 *            - how high its waves stand there (a body's own height, calmed toward its shore and as the water shallows);
 *            - how it flows (a river's current), and how deep it is over the ground.
 *          Where two bodies meet their values are blended by how far inside each the texel is, so a river is at its lake's level where it runs
 *          into it, its current fades into the still water, and its banks run on into the lake's shores with no seam; the sea gives way to
 *          the bodies over it. One mesh following the camera reads the field and is the whole surface, and {@link WaterField.sample} answers
 *          the CPU from the same numbers.
 *
 *          The field is in the world's own frame on the xz plane: bodies may be turned about their up, not tilted.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';
import { polygonSdf, shoreDamp, type Point2 } from './shore';

/** The fields of the `WaterZone` component. @experimental */
export interface WaterZoneData {
    /** The region baked, along x and z, centred on the entity. Bodies (or the parts of them) outside it are not drawn; an ocean goes on past it. */
    sizeX: number;
    sizeZ: number;
    /** Texels along the longer side of the region. */
    resolution: number;
    /** A material on the Water shader for the whole surface. Empty uses the stock water. */
    material: number;
    /** The waves every body shares (each sets only how high they stand): the length of the longest, a multiplier on their speed, their heading in degrees. */
    waveLength: number;
    waveSpeed: number;
    waveDirection: number;
    /** The surf: how high a breaker stands against its body's waves (0 draws none), and how long the surf's waves are, in world units. */
    surf: number;
    surfLength: number;
    /** The surface's mesh: the cell size of its finest ring, cells along a ring's side, and how many rings (each twice as coarse) follow the camera. */
    cellSize: number;
    cells: number;
    rings: number;
    /** Cells along a side of the ripple grid; 0 keeps none. The grid is a window of `rippleSize` that follows the camera. */
    ripples: number;
    rippleSize: number;
    /** How fast a ripple spreads (world units a second), how much of its height it loses a second, and how fast the foam it leaves fades a second. */
    rippleSpeed: number;
    rippleDamping: number;
    foamFade: number;
}

/**
 * Where the bodies of water are drawn from, and what they share. A scene without one is given a zone over its lakes and rivers with these
 * defaults; put one in to say where, how fine, and what the water looks like.
 *
 * @experimental
 */
export const WaterZone: ComponentDef<WaterZoneData> = defineComponent<WaterZoneData>('WaterZone', {
    sizeX: 200, sizeZ: 200, resolution: 256, material: 0,
    waveLength: 14, waveSpeed: 1, waveDirection: 30, surf: 0.6, surfLength: 8,
    cellSize: 1, cells: 64, rings: 5,
    ripples: 0, rippleSize: 64, rippleSpeed: 6, rippleDamping: 0.8, foamFade: 0.4,
}, {
    assetFields: [{ field: 'material', type: 'material' }],
    fields: {
        sizeX: { min: 1, category: 'Region', tooltip: 'The region baked along x, centred on the entity. Water outside it is not drawn; an ocean goes on past it.' },
        sizeZ: { min: 1, category: 'Region', tooltip: 'The region baked along z, centred on the entity.' },
        resolution: { min: 32, max: 1024, step: 32, category: 'Region', tooltip: 'Texels along the longer side of the region: how finely shores and rivers are traced.' },
        material: { category: 'Look', tooltip: 'A material on the Water shader for the whole surface. Empty uses the stock water.' },
        waveLength: { min: 0.5, max: 3000, category: 'Waves', tooltip: 'The length of the longest wave. Every body shares the waves; each sets how high they stand.' },
        waveSpeed: { min: 0, max: 4, category: 'Waves', tooltip: 'A multiplier on how fast the waves travel.' },
        waveDirection: { min: 0, max: 360, category: 'Waves', tooltip: 'The heading of the waves, in degrees.' },
        surf: { min: 0, max: 4, category: 'Waves', tooltip: 'How high the surf breaking on a shore stands against its body\'s waves. 0 draws none. A current carries none.' },
        surfLength: { min: 0.1, max: 100000, category: 'Waves', tooltip: 'The length of the surf\'s waves, in world units. They run in over four lengths of water, break, and run up the ground past the shore.' },
        cellSize: { min: 0.05, category: 'Detail', tooltip: 'The cell size of the finest ring of the surface. Waves shorter than six cells are not drawn as geometry there (the shading still shows them).' },
        cells: { min: 4, max: 256, step: 4, category: 'Detail', tooltip: 'Cells along a ring\'s side.' },
        rings: { min: 1, max: 10, step: 1, category: 'Detail', tooltip: 'Rings of the surface, each twice as coarse as the one inside it.' },
        ripples: { min: 0, max: 256, step: 8, category: 'Ripples', tooltip: 'Cells along a side of the grid that keeps what disturbs the water: bodies moving in it, rain, and what a script disturbs. 0 keeps none.' },
        rippleSize: { min: 4, category: 'Ripples', tooltip: 'The side of the window the ripples are kept in, in world units. It follows the camera.' },
        rippleSpeed: { min: 0.1, max: 4000, category: 'Ripples', tooltip: 'How fast a ripple spreads, in world units a second.' },
        rippleDamping: { min: 0, max: 10, category: 'Ripples', tooltip: 'How much of its height a ripple loses each second.' },
        foamFade: { min: 0, max: 10, category: 'Ripples', tooltip: 'How fast the foam a disturbance leaves fades, a second.' },
    },
});

/** An ocean, as the zone takes it: everywhere at `level`, where the ground (if known) is below it. */
export interface ZoneOcean { kind: 'ocean'; key: number; level: number; waveHeight: number; shoreWidth: number }

/** A lake: its outline on its own plane at world height `level`, and how a world point is put into the outline's space. */
export interface ZoneLake {
    kind: 'lake'; key: number; level: number; waveHeight: number; shoreWidth: number;
    outline: readonly Point2[];
    /** A world (x, z) in the outline's own space, and back. */
    toLocal(x: number, z: number): [number, number];
    toWorld(x: number, z: number): [number, number];
}

/** A point along a river, in the world: where its middle is, its surface's height, half its width, its heading and how fast it runs there. */
export interface RiverStation { x: number; z: number; y: number; half: number; dx: number; dz: number; speed: number }

/** A river, as the stations along it (a few to a width), in order downstream. */
export interface ZoneRiver { kind: 'river'; key: number; waveHeight: number; shoreWidth: number; stations: readonly RiverStation[] }

export type ZoneBody = ZoneOcean | ZoneLake | ZoneRiver;

/** The ground's world height at (x, z), or null where none is known. */
export type ZoneGround = (x: number, z: number) => number | null;

/** The region a field is baked over, in world units, and its grid. */
export interface ZoneGrid { minX: number; minZ: number; sizeX: number; sizeZ: number; nx: number; nz: number }

/** What the field encodes its numbers over, which the shader decodes with: see {@link WaterField.encode}. */
export interface ZoneRanges { heightMin: number; heightSpan: number; shore: number; amp: number; flow: number; depth: number }

/** What {@link WaterField.sample} answers about the water at a point. */
export interface FieldSample {
    /** The body that owns the most of it. */
    key: number;
    /** Its surface's height at rest, the height its waves stand to (and the share of its body's that is, calmed toward the shore), and its current. */
    height: number;
    amp: number;
    calm: number;
    /** The height its body's waves stand to away from any shore: what the surf breaking on the shore is measured against. */
    swell: number;
    flowX: number;
    flowZ: number;
    /** The signed distance to the nearest shore (positive on the water) and how deep the water is over the ground. */
    shore: number;
    depth: number;
}

/** What the current is at a reach this wide against the river's widest, against its nominal speed (half): a narrow reach is quick and a wide one slow. */
export function currentShare(width: number, widest: number): number {
    return Math.min(Math.max(widest / Math.max(width, 1e-3), 0.25), 2) / 2;
}

/** The depth over ground nothing is known of. */
const DEEP = 1e6;

/** The baked water of a zone. */
export class WaterField {
    readonly grid: ZoneGrid;
    readonly height: Float32Array;
    readonly shore: Float32Array;
    readonly amp: Float32Array;
    readonly calm: Float32Array;
    readonly swell: Float32Array;
    readonly flowX: Float32Array;
    readonly flowZ: Float32Array;
    readonly depth: Float32Array;
    /** The body that owns the most of each texel, as its key; -1 where there is no water. */
    readonly owner: Int32Array;
    /** The ocean, which goes on past the region: what a point outside it is. */
    readonly ocean: ZoneOcean | null;

    private constructor(grid: ZoneGrid, ocean: ZoneOcean | null) {
        const n = grid.nx * grid.nz;
        this.grid = grid;
        this.ocean = ocean;
        this.height = new Float32Array(n);
        this.shore = new Float32Array(n);
        this.amp = new Float32Array(n);
        this.calm = new Float32Array(n);
        this.swell = new Float32Array(n);
        this.flowX = new Float32Array(n);
        this.flowZ = new Float32Array(n);
        this.depth = new Float32Array(n);
        this.owner = new Int32Array(n);
    }

    /**
     * Bakes `bodies` over `grid`. Each texel takes every body's say (its height, its distance to its own shore, its waves and current) and
     * weighs them by how far inside each it is, over a texel and a half, so where two bodies meet the values run from one to the other.
     * The lakes and rivers come first; the ocean has what they leave. A texel no body holds keeps the height of the nearest water, so the
     * surface's vertices there (which the shore cuts away) do not pull the water's edge down to nothing.
     */
    static bake(grid: ZoneGrid, bodies: readonly ZoneBody[], ground?: ZoneGround): WaterField {
        const job = WaterField.baking(grid, bodies, ground);
        for (;;) {
            const next = job.next();
            if (next.done) return next.value;
        }
    }

    /** {@link WaterField.bake} as a job that yields its progress (0 to 1) every few rows, for spreading over frames. */
    static *baking(grid: ZoneGrid, bodies: readonly ZoneBody[], ground?: ZoneGround): Generator<number, WaterField, void> {
        const ocean = (bodies.find((b) => b.kind === 'ocean') as ZoneOcean | undefined) ?? null;
        const field = new WaterField(grid, ocean);
        const texel = Math.max(grid.sizeX / Math.max(grid.nx - 1, 1), grid.sizeZ / Math.max(grid.nz - 1, 1));
        const blend = texel * 1.5;
        const bounded = bodies.filter((b) => b.kind !== 'ocean') as (ZoneLake | ZoneRiver)[];
        const boxes = bounded.map((b) => boundsOf(b));
        for (let j = 0; j < grid.nz; j++) {
            if (j % 16 === 0) yield 0.8 * (j / grid.nz);
            for (let i = 0; i < grid.nx; i++) {
                const k = j * grid.nx + i;
                const x = grid.minX + (i / Math.max(grid.nx - 1, 1)) * grid.sizeX;
                const z = grid.minZ + (j / Math.max(grid.nz - 1, 1)) * grid.sizeZ;
                const g = ground ? ground(x, z) : null;
                let w = 0, h = 0, a = 0, c = 0, sw = 0, fx = 0, fz = 0, best = -Infinity, owner = -1, ownerW = 0, held = 0;
                for (let b = 0; b < bounded.length; b++) {
                    const box = boxes[b]!;
                    if (x < box[0] - blend || x > box[2] + blend || z < box[1] - blend || z > box[3] + blend) continue;
                    const say = sayOf(bounded[b]!, x, z, g);
                    if (!say) continue;
                    best = Math.max(best, say.shore);
                    const weight = smooth(-blend, blend, say.shore);
                    if (weight <= 0) continue;
                    held = Math.max(held, weight);
                    w += weight; h += say.height * weight; a += say.amp * weight; c += say.calm * weight; sw += bounded[b]!.waveHeight * weight; fx += say.fx * weight; fz += say.fz * weight;
                    if (weight > ownerW) { ownerW = weight; owner = bounded[b]!.key; }
                }
                if (ocean) {
                    const deep = g === null ? DEEP : ocean.level - g;
                    best = Math.max(best, deep);
                    const weight = smooth(-blend, blend, deep) * (1 - held);
                    if (weight > 0) {
                        const calm = shoreDamp(deep, ocean.shoreWidth);
                        w += weight; h += ocean.level * weight; a += ocean.waveHeight * calm * weight; c += calm * weight; sw += ocean.waveHeight * weight;
                        if (weight > ownerW) { ownerW = weight; owner = ocean.key; }
                    }
                }
                field.shore[k] = best === -Infinity ? -DEEP : best;
                field.owner[k] = w > 0 ? owner : -1;
                if (w > 0) {
                    field.height[k] = h / w;
                    field.amp[k] = a / w;
                    field.calm[k] = c / w;
                    field.swell[k] = sw / w;
                    field.flowX[k] = fx / w;
                    field.flowZ[k] = fz / w;
                } else {
                    field.height[k] = Number.NaN;
                }
                field.depth[k] = g === null ? DEEP : Math.max(0, (w > 0 ? h / w : 0) - g);
            }
        }
        yield* levelShore(field, texel);
        yield* fillDry(field);
        return field;
    }

    /** The field at a world point inside the region, read as the texels around it blend; null outside the region. */
    at(x: number, z: number): FieldSample | null {
        const { minX, minZ, sizeX, sizeZ, nx, nz } = this.grid;
        if (nx < 2 || nz < 2) return null;
        const u = (x - minX) / sizeX, v = (z - minZ) / sizeZ;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        const fx = u * (nx - 1), fz = v * (nz - 1);
        const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
        const tx = fx - i, tz = fz - j;
        const lerp2 = (a: Float32Array): number => {
            const k = j * nx + i;
            const lo = a[k]! * (1 - tx) + a[k + 1]! * tx, hi = a[k + nx]! * (1 - tx) + a[k + nx + 1]! * tx;
            return lo * (1 - tz) + hi * tz;
        };
        const near = (j + (tz > 0.5 ? 1 : 0)) * nx + i + (tx > 0.5 ? 1 : 0);
        return {
            key: this.owner[near]!, height: lerp2(this.height), amp: lerp2(this.amp), calm: lerp2(this.calm), swell: lerp2(this.swell), flowX: lerp2(this.flowX), flowZ: lerp2(this.flowZ),
            shore: lerp2(this.shore), depth: lerp2(this.depth),
        };
    }

    /**
     * The water at a world point: the field inside the region, the ocean past it (as deep as it likes, waves whole), null where there is none.
     * `shore` above zero is water.
     */
    sample(x: number, z: number): FieldSample | null {
        const inside = this.at(x, z);
        if (inside) return inside.shore > 0 ? inside : null;
        const o = this.ocean;
        if (!o) return null;
        return { key: o.key, height: o.level, amp: o.waveHeight, calm: 1, swell: o.waveHeight, flowX: 0, flowZ: 0, shore: DEEP, depth: DEEP };
    }

    /** The ranges the encoding spans, from what the field holds; the shore distance reaches `shoreReach` at least (as far out as the surf is drawn). */
    ranges(shoreReach = 0): ZoneRanges {
        const r = this.ranges_ ??= this.measure();
        return { ...r, shore: Math.max(r.shore, shoreReach * 1.25) };
    }

    private ranges_: ZoneRanges | null = null;

    private measure(): ZoneRanges {
        let lo = Infinity, hi = -Infinity, amp = 0, flow = 0;
        for (let k = 0; k < this.height.length; k++) {
            const h = this.height[k]!;
            if (Number.isFinite(h)) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
            amp = Math.max(amp, this.swell[k]!);
            flow = Math.max(flow, Math.abs(this.flowX[k]!), Math.abs(this.flowZ[k]!));
        }
        if (this.ocean) { lo = Math.min(lo, this.ocean.level); hi = Math.max(hi, this.ocean.level); amp = Math.max(amp, this.ocean.waveHeight); }
        if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
        const texel = Math.max(this.grid.sizeX / Math.max(this.grid.nx - 1, 1), this.grid.sizeZ / Math.max(this.grid.nz - 1, 1));
        return { heightMin: lo, heightSpan: Math.max(hi - lo, 1e-3), shore: texel * 16, amp: Math.max(amp, 1e-3), flow: Math.max(flow, 1e-3), depth: texel * 16 };
    }

    /**
     * The field as two RGBA8 images, rows from minZ. heights (read texel by texel: filtered bytes are no number): rg the height, high byte
     * first; b the depth; a the swell (the body's waves' height). field (filtered): r the shore distance (0.5 at it); gb the current (0.5 still); a the calm.
     * Each over its range in `r`.
     */
    encode(r: ZoneRanges): { heights: Uint8Array; field: Uint8Array } {
        const n = this.height.length;
        const heights = new Uint8Array(n * 4), field = new Uint8Array(n * 4);
        const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);
        for (let k = 0; k < n; k++) {
            const h = Math.round(Math.min(Math.max((this.height[k]! - r.heightMin) / r.heightSpan, 0), 1) * 65535);
            heights[k * 4] = h >> 8;
            heights[k * 4 + 1] = h & 255;
            heights[k * 4 + 2] = byte(this.depth[k]! / r.depth);
            heights[k * 4 + 3] = byte(this.swell[k]! / r.amp);
            field[k * 4] = byte(this.shore[k]! / (2 * r.shore) + 0.5);
            field[k * 4 + 1] = byte(this.flowX[k]! / (2 * r.flow) + 0.5);
            field[k * 4 + 2] = byte(this.flowZ[k]! / (2 * r.flow) + 0.5);
            field[k * 4 + 3] = byte(this.calm[k]!);
        }
        return { heights, field };
    }
}

/** What one body says about a point: its height there, how far inside it the point is, its waves and its current. Null where it says nothing. */
function sayOf(body: ZoneLake | ZoneRiver, x: number, z: number, g: number | null):
    { height: number; shore: number; amp: number; calm: number; fx: number; fz: number } | null {
    if (body.kind === 'lake') {
        const [lx, lz] = body.toLocal(x, z);
        const shore = polygonSdf(body.outline, lx, lz);
        const deep = g === null ? DEEP : body.level - g;
        const calm = shoreDamp(Math.min(shore, deep), body.shoreWidth);
        return { height: body.level, shore, amp: body.waveHeight * calm, calm, fx: 0, fz: 0 };
    }
    const st = body.stations;
    if (st.length < 2) return null;
    // The nearest place on the river's middle, between two stations, with what is there eased between them.
    let best = Infinity, at = 0, t = 0;
    for (let s = 0; s + 1 < st.length; s++) {
        const a = st[s]!, b = st[s + 1]!;
        const ex = b.x - a.x, ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        const u = len2 > 0 ? Math.min(Math.max(((x - a.x) * ex + (z - a.z) * ez) / len2, 0), 1) : 0;
        const d = Math.hypot(x - (a.x + u * ex), z - (a.z + u * ez));
        if (d < best) { best = d; at = s; t = u; }
    }
    const a = st[at]!, b = st[at + 1]!;
    const mix = (p: number, q: number): number => p + (q - p) * t;
    const half = mix(a.half, b.half), y = mix(a.y, b.y), speed = mix(a.speed, b.speed);
    let dx = mix(a.dx, b.dx), dz = mix(a.dz, b.dz);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const shore = half - best;
    // The current fades in over a width from the spring and out over a width into whatever it runs into.
    const along = (at + t) / (st.length - 1);
    const length = st.reduce((n, p, i) => (i ? n + Math.hypot(p.x - st[i - 1]!.x, p.z - st[i - 1]!.z) : 0), 0);
    const run = smooth(0, 2 * half, along * length) * smooth(0, 2 * half, (1 - along) * length);
    const deep = g === null ? DEEP : y - g;
    const calm = shoreDamp(Math.min(shore, deep), body.shoreWidth);
    return { height: y, shore, amp: body.waveHeight * calm, calm, fx: dx * speed * run, fz: dz * speed * run };
}

/** A body's box on the world's xz plane, [minX, minZ, maxX, maxZ]. */
function boundsOf(body: ZoneLake | ZoneRiver): [number, number, number, number] {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    if (body.kind === 'river') {
        for (const s of body.stations) {
            minX = Math.min(minX, s.x - s.half); maxX = Math.max(maxX, s.x + s.half);
            minZ = Math.min(minZ, s.z - s.half); maxZ = Math.max(maxZ, s.z + s.half);
        }
        return [minX, minZ, maxX, maxZ];
    }
    for (const p of body.outline) {
        const [x, z] = body.toWorld(p.x, p.y);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return [minX, minZ, maxX, maxZ];
}

/**
 * The shore distance made one measure everywhere: how far across the ground the nearest edge of ANY water is, the sign the bodies gave. A body's
 * own say is exact only near its edge (an ocean's is its depth, a lake's ends at its outline even where a river carries the water on), so the
 * texels on either side of an edge keep it, held to a texel, and every other texel is that plus how far it is from the nearest of them
 * (each texel carries its nearest edge texel, two sweeps).
 */
function* levelShore(field: WaterField, texel: number): Generator<number, void, void> {
    const { nx, nz, sizeX, sizeZ } = field.grid;
    const n = nx * nz;
    if (nx < 2 || nz < 2) return;
    const dx = sizeX / (nx - 1), dz = sizeZ / (nz - 1);
    const wet = (k: number): boolean => field.shore[k]! > 0;
    const seed = new Int32Array(n).fill(-1);
    const offset = new Float32Array(n);
    const dist = new Float32Array(n).fill(Infinity);
    yield 0.85;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, w = wet(k);
        const edge = (i > 0 && wet(k - 1) !== w) || (i < nx - 1 && wet(k + 1) !== w) || (j > 0 && wet(k - nx) !== w) || (j < nz - 1 && wet(k + nx) !== w);
        if (!edge) continue;
        seed[k] = k;
        offset[k] = Math.min(Math.abs(field.shore[k]!), texel);
        dist[k] = offset[k]!;
    }
    const relax = (k: number, from: number): void => {
        const s = seed[from]!;
        if (s < 0) return;
        const ex = ((k % nx) - (s % nx)) * dx, ez = (Math.floor(k / nx) - Math.floor(s / nx)) * dz;
        const d = Math.hypot(ex, ez) + offset[s]!;
        if (d < dist[k]!) { dist[k] = d; seed[k] = s; }
    };
    yield 0.85;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i > 0) relax(k, k - 1);
        if (j > 0) { relax(k, k - nx); if (i > 0) relax(k, k - nx - 1); if (i < nx - 1) relax(k, k - nx + 1); }
    }
    yield 0.92;
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (i < nx - 1) relax(k, k + 1);
        if (j < nz - 1) { relax(k, k + nx); if (i < nx - 1) relax(k, k + nx + 1); if (i > 0) relax(k, k + nx - 1); }
    }
    for (let k = 0; k < n; k++) {
        if (!Number.isFinite(dist[k]!)) continue;
        field.shore[k] = wet(k) ? dist[k]! : -dist[k]!;
    }
}

/** A texel no body holds takes the height of the nearest that one does: two passes of a chamfer sweep over which texel is nearest. */
function* fillDry(field: WaterField): Generator<number, void, void> {
    const { nx, nz } = field.grid;
    const n = nx * nz;
    const src = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n).fill(Infinity);
    for (let k = 0; k < n; k++) if (Number.isFinite(field.height[k]!)) { src[k] = k; dist[k] = 0; }
    const relax = (k: number, from: number, step: number): void => {
        if (src[from]! < 0 || dist[from]! + step >= dist[k]!) return;
        dist[k] = dist[from]! + step;
        src[k] = src[from]!;
    };
    yield 0.85;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i > 0) relax(k, k - 1, 1);
        if (j > 0) relax(k, k - nx, 1);
        if (i > 0 && j > 0) relax(k, k - nx - 1, Math.SQRT2);
        if (i < nx - 1 && j > 0) relax(k, k - nx + 1, Math.SQRT2);
    }
    yield 0.92;
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (i < nx - 1) relax(k, k + 1, 1);
        if (j < nz - 1) relax(k, k + nx, 1);
        if (i < nx - 1 && j < nz - 1) relax(k, k + nx + 1, Math.SQRT2);
        if (i > 0 && j < nz - 1) relax(k, k + nx - 1, Math.SQRT2);
    }
    const fallback = field.ocean ? field.ocean.level : 0;
    for (let k = 0; k < n; k++) {
        if (Number.isFinite(field.height[k]!)) continue;
        field.height[k] = src[k]! >= 0 ? field.height[src[k]!]! : fallback;
    }
}

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
}
