// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetPages.ts
 * @brief   A planet node's page: its heights, normals and paint, sampled from a provider by direction.
 *
 * @details The same three images a flat node's page holds (pages.ts), laid out the same way so the one atlas and the one page table serve both: a
 *          node's square of its face sampled `PAGE_TEXELS` times along each side with one more sample past each edge. What differs is the normal. Flat
 *          ground has one up for every sample; here up is the direction from the planet's centre, so the normal is stored in the frame at its own
 *          sample, x along the face's u direction made perpendicular to up, z along its v direction, y up; the shader builds the same frame from the
 *          direction and the face and turns it back.
 */
import { PAGE_SIDE, PAGE_TEXELS, type PageImage } from './pages';
import { FACES, direction, nodeRect, type SphereNode } from './sphere';
import type { PlanetProvider } from './planetProvider';

/** What a planet page is made against. */
export interface PlanetPageSource {
    provider: PlanetProvider;
    world: string;
    seed: number;
    version: number;
    radius: number;
    /** The levels of the planet's tree (see sphere.ts). */
    levels: number;
    minHeight: number;
    maxHeight: number;
}

/** The frame at a unit direction on a face: the face's u and v directions made perpendicular to it. */
export function tangentFrame(face: number, d: readonly [number, number, number], eu: [number, number, number], ev: [number, number, number]): void {
    const f = FACES[face]!;
    for (const [axis, out] of [[f.a, eu], [f.b, ev]] as const) {
        const k = axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2];
        const x = axis[0] - d[0] * k, y = axis[1] - d[1] * k, z = axis[2] - d[2] * k;
        const len = Math.hypot(x, y, z) || 1;
        out[0] = x / len; out[1] = y / len; out[2] = z / len;
    }
}

/** Samples a node's page: the grid's directions go to the provider, and what comes back is encoded. May answer later, as the provider may. */
export function makePlanetPage(src: PlanetPageSource, node: SphereNode): PageImage | Promise<PageImage> {
    const n = PAGE_SIDE;
    const { u0, v0, span } = nodeRect(src.levels, node);
    const step = span / PAGE_TEXELS;
    const dirs = new Float32Array(n * n * 3);
    const d: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        direction(node.face, u0 + (i - 1) * step, v0 + (j - 1) * step, d);
        const k = (j * n + i) * 3;
        dirs[k] = d[0]; dirs[k + 1] = d[1]; dirs[k + 2] = d[2];
    }
    const got = src.provider.sample({ world: src.world, seed: src.seed, version: src.version, radius: src.radius, directions: dirs, count: n * n });
    return got instanceof Promise ? got.then((r) => encodePlanetPage(src, node, dirs, r.heights, r.paint)) : encodePlanetPage(src, node, dirs, got.heights, got.paint);
}

function encodePlanetPage(src: PlanetPageSource, node: SphereNode, dirs: Float32Array, h: Float32Array, given?: Float32Array): PageImage {
    const n = PAGE_SIDE;
    let min = Infinity, max = -Infinity;
    for (let j = 1; j <= n - 2; j++) for (let i = 1; i <= n - 2; i++) { const v = h[j * n + i]!; min = Math.min(min, v); max = Math.max(max, v); }
    const span = Math.max(src.maxHeight - src.minHeight, 1e-6);
    const heights = new Uint8Array(n * n * 4), paint = new Uint8Array(n * n * 4), paint2 = new Uint8Array(n * n * 4);
    // The position of a sample, in metres from the planet's centre.
    const at = (i: number, j: number, out: [number, number, number]): void => {
        const ci = Math.min(Math.max(i, 0), n - 1), cj = Math.min(Math.max(j, 0), n - 1), k = cj * n + ci, r = src.radius + h[k]!;
        out[0] = dirs[k * 3]! * r; out[1] = dirs[k * 3 + 1]! * r; out[2] = dirs[k * 3 + 2]! * r;
    };
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0], c: [number, number, number] = [0, 0, 0], e: [number, number, number] = [0, 0, 0];
    const eu: [number, number, number] = [0, 0, 0], ev: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const enc = Math.round(Math.min(Math.max((h[k]! - src.minHeight) / span, 0), 1) * 65535);
        // The surface's tangents toward +u and +v from the samples either side, and the normal they make, outward.
        at(i - 1, j, a); at(i + 1, j, b); at(i, j - 1, c); at(i, j + 1, e);
        const tu = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tv = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
        let nx = tu[1]! * tv[2]! - tu[2]! * tv[1]!, ny = tu[2]! * tv[0]! - tu[0]! * tv[2]!, nz = tu[0]! * tv[1]! - tu[1]! * tv[0]!;
        const dir: [number, number, number] = [dirs[k * 3]!, dirs[k * 3 + 1]!, dirs[k * 3 + 2]!];
        let len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        if (nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        tangentFrame(node.face, dir, eu, ev);
        const lx = nx * eu[0] + ny * eu[1] + nz * eu[2], lz = nx * ev[0] + ny * ev[1] + nz * ev[2];
        const up = nx * dir[0] + ny * dir[1] + nz * dir[2];
        len = Math.hypot(lx, up, lz) || 1;
        heights[k * 4] = enc >> 8;
        heights[k * 4 + 1] = enc & 255;
        heights[k * 4 + 2] = Math.round((lx / len * 0.5 + 0.5) * 255);
        heights[k * 4 + 3] = Math.round((lz / len * 0.5 + 0.5) * 255);
        // The paint the provider gave; without it, rock where it is steep and grass elsewhere, so a planet with no paint is still readable.
        let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
        if (given) { w0 = given[k * 4]!; w1 = given[k * 4 + 1]!; w2 = given[k * 4 + 2]!; w3 = given[k * 4 + 3]!; }
        else { const steep = Math.min(Math.max((0.9 - up / len) * 6, 0), 1); w0 = 1 - steep; w3 = steep; }
        paint[k * 4] = Math.round(Math.min(Math.max(w0, 0), 1) * 255);
        paint[k * 4 + 1] = Math.round(Math.min(Math.max(w1, 0), 1) * 255);
        paint[k * 4 + 2] = Math.round(Math.min(Math.max(w2, 0), 1) * 255);
        paint[k * 4 + 3] = Math.round(Math.min(Math.max(w3, 0), 1) * 255);
    }
    return { heights, paint, paint2, min: Number.isFinite(min) ? min : src.minHeight, max: Number.isFinite(max) ? max : src.maxHeight };
}
