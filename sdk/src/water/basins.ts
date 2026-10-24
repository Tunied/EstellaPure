// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    basins.ts
 * @brief   Where water would gather and how it would run off a piece of ground: basins with their spill levels and outlets, and the
 *          drainage down to the edge. For a game to decide its lakes, rivers and sea, not water that is drawn.
 *
 * @details One priority flood (Barnes et al., 2014) from the region's edge, lowest first. Each texel is reached from a neighbour no
 *          higher than it would drain to, so:
 *            - a texel reached from above its own ground is in a basin, filled to the level the flood stood at: the basin's spill
 *              level, where a lake there would run over, through its outlet;
 *            - the texel each one was reached from is where its water goes, so every texel drains along a tree to the edge, flats and
 *              basins included, and the accumulation along it (how many texels drain through each) is where rivers run;
 *            - with a sea level, low ground the flood reaches from the edge without climbing over it is sea; a basin below the sea that
 *              is walled off from it stays a basin (dry, or a lake at its own level).
 *          The answer depends only on the ground and the region, never on the order anything is asked.
 */
import type { ZoneGrid } from './zone';

/** A basin: the texels a lake filling it to its spill level would cover. */
export interface Basin {
    id: number;
    /** The height water stands at when the basin is full: the lowest point of its rim. */
    level: number;
    /** How many texels it covers, and its deepest point. */
    cells: number;
    deepest: { x: number; z: number; y: number };
    /** Where it runs over its rim, and the texel index there. */
    outlet: { x: number; z: number; y: number; index: number };
}

export interface BasinMap {
    grid: ZoneGrid;
    /** The ground's height per texel (row by row from minZ), and the height water would fill it to. */
    ground: Float32Array;
    filled: Float32Array;
    /** The texel each one drains to; -1 at the edge, where water leaves the region. */
    downstream: Int32Array;
    /** How many texels drain through each, itself included. */
    accumulation: Float32Array;
    /** The basin each texel is in, or -1. */
    basin: Int32Array;
    /** 1 where the ground is the sea's (with a sea level). */
    sea: Uint8Array;
    basins: Basin[];
}

export interface BasinOptions {
    /** The sea's level: low ground joined to the edge below it is sea, not basin. */
    seaLevel?: number;
    /** A basin shallower than this, or of fewer texels, is not kept as one (its texels still drain through it). */
    minDepth?: number;
    minCells?: number;
}

/** A binary heap of texels by height, lowest first; ties in the order pushed. */
class Heap {
    private readonly k: number[] = [];
    private readonly h: number[] = [];
    private readonly o: number[] = [];
    private n = 0;
    get size(): number { return this.k.length; }
    push(key: number, height: number): void {
        this.k.push(key); this.h.push(height); this.o.push(this.n++);
        let i = this.k.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!this.less(i, p)) break;
            this.swap(i, p);
            i = p;
        }
    }
    pop(): number {
        const top = this.k[0]!;
        const lk = this.k.pop()!, lh = this.h.pop()!, lo = this.o.pop()!;
        if (this.k.length > 0) {
            this.k[0] = lk; this.h[0] = lh; this.o[0] = lo;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let m = i;
                if (l < this.k.length && this.less(l, m)) m = l;
                if (r < this.k.length && this.less(r, m)) m = r;
                if (m === i) break;
                this.swap(i, m);
                i = m;
            }
        }
        return top;
    }
    private less(a: number, b: number): boolean {
        return this.h[a]! < this.h[b]! || (this.h[a] === this.h[b] && this.o[a]! < this.o[b]!);
    }
    private swap(a: number, b: number): void {
        [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
        [this.h[a], this.h[b]] = [this.h[b]!, this.h[a]!];
        [this.o[a], this.o[b]] = [this.o[b]!, this.o[a]!];
    }
}

/** The basins and drainage of the ground over `grid`. Ground not known is taken as the sea's level (or as low as the lowest known). */
export function findBasins(grid: ZoneGrid, ground: (x: number, z: number) => number | null, options: BasinOptions = {}): BasinMap {
    const { nx, nz } = grid;
    const n = nx * nz;
    const at = (k: number): [number, number] => [
        grid.minX + ((k % nx) / Math.max(nx - 1, 1)) * grid.sizeX,
        grid.minZ + (Math.floor(k / nx) / Math.max(nz - 1, 1)) * grid.sizeZ,
    ];
    const g = new Float32Array(n);
    let lowest = Infinity;
    const known: boolean[] = new Array(n);
    for (let k = 0; k < n; k++) {
        const [x, z] = at(k);
        const y = ground(x, z);
        known[k] = y !== null;
        g[k] = y ?? 0;
        if (y !== null) lowest = Math.min(lowest, y);
    }
    const unknown = options.seaLevel ?? (Number.isFinite(lowest) ? lowest : 0);
    for (let k = 0; k < n; k++) if (!known[k]) g[k] = unknown;

    const filled = new Float32Array(n);
    const downstream = new Int32Array(n).fill(-1);
    const sea = new Uint8Array(n);
    const done = new Uint8Array(n);
    const order: number[] = [];
    const heap = new Heap();
    const sl = options.seaLevel;
    const seed = (k: number): void => {
        if (done[k]) return;
        done[k] = 1;
        filled[k] = g[k]!;
        if (sl !== undefined && g[k]! < sl) sea[k] = 1;
        heap.push(k, g[k]!);
    };
    for (let i = 0; i < nx; i++) { seed(i); seed((nz - 1) * nx + i); }
    for (let j = 0; j < nz; j++) { seed(j * nx); seed(j * nx + nx - 1); }
    while (heap.size > 0) {
        const c = heap.pop();
        order.push(c);
        const ci = c % nx, cj = Math.floor(c / nx);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const i = ci + di, j = cj + dj;
            if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
            const k = j * nx + i;
            if (done[k]) continue;
            done[k] = 1;
            downstream[k] = c;
            filled[k] = Math.max(g[k]!, filled[c]!);
            // The sea comes in from the edge over ground below it, and no further than that ground goes.
            if (sea[c] && g[k]! < sl!) sea[k] = 1;
            heap.push(k, filled[k]!);
        }
    }

    // Through every texel drains what drains into it: the reverse of the order the flood reached them.
    const accumulation = new Float32Array(n).fill(1);
    for (let q = order.length - 1; q >= 0; q--) {
        const k = order[q]!, d = downstream[k]!;
        if (d >= 0) accumulation[d] += accumulation[k]!;
    }

    // The basins: texels filled above their ground (and not the sea), joined where they touch.
    const basin = new Int32Array(n).fill(-1);
    const basins: Basin[] = [];
    const minDepth = options.minDepth ?? 0, minCells = options.minCells ?? 1;
    const wet = (k: number): boolean => !sea[k] && filled[k]! - g[k]! > 1e-6;
    for (let s = 0; s < n; s++) {
        if (!wet(s) || basin[s]! >= 0) continue;
        const id = basins.length, level = filled[s]!;
        const members: number[] = [s];
        basin[s] = id;
        let deepest = s;
        for (let q = 0; q < members.length; q++) {
            const c = members[q]!, ci = c % nx, cj = Math.floor(c / nx);
            if (g[c]! < g[deepest]!) deepest = c;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                const i = ci + di, j = cj + dj;
                if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
                const k = j * nx + i;
                if (basin[k]! < 0 && wet(k) && filled[k] === level) { basin[k] = id; members.push(k); }
            }
        }
        // It runs over where the water leaving it first leaves it: down the drainage from its deepest point to the first texel outside.
        let out = deepest;
        while (out >= 0 && basin[out] === id) out = downstream[out]!;
        const outlet = out >= 0 ? out : deepest;
        if (level - g[deepest]! < minDepth || members.length < minCells) {
            for (const k of members) basin[k] = -2;
            continue;
        }
        const [dx, dz] = at(deepest), [ox, oz] = at(outlet);
        basins.push({
            id, level, cells: members.length, deepest: { x: dx, z: dz, y: g[deepest]! },
            outlet: { x: ox, z: oz, y: g[outlet]!, index: outlet },
        });
    }
    // Ids follow the kept basins in order; the dropped ones are no basin.
    const remap = new Map<number, number>();
    basins.forEach((b, i) => { remap.set(b.id, i); b.id = i; });
    for (let k = 0; k < n; k++) basin[k] = basin[k]! >= 0 ? remap.get(basin[k]!) ?? -1 : -1;
    return { grid, ground: g, filled, downstream, accumulation, basin, sea, basins };
}

/** The path water takes from (x, z) down the drainage, texel by texel, to the region's edge: a river's course, as world points. */
export function drainPath(map: BasinMap, x: number, z: number): { x: number; z: number; y: number }[] {
    const { grid } = map, { nx, nz } = grid;
    const i = Math.round(((x - grid.minX) / grid.sizeX) * (nx - 1)), j = Math.round(((z - grid.minZ) / grid.sizeZ) * (nz - 1));
    if (i < 0 || j < 0 || i >= nx || j >= nz) return [];
    const out: { x: number; z: number; y: number }[] = [];
    for (let k = j * nx + i; k >= 0; k = map.downstream[k]!) {
        out.push({
            x: grid.minX + ((k % nx) / Math.max(nx - 1, 1)) * grid.sizeX,
            z: grid.minZ + (Math.floor(k / nx) / Math.max(nz - 1, 1)) * grid.sizeZ,
            y: map.filled[k]!,
        });
    }
    return out;
}
