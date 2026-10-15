// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { buildNavMesh } from '../../sdk/src/ai/nav/navmesh/build';
import { NavGrid } from '../../sdk/src/ai/nav/NavGrid';
import { applyObstaclesToGrid, type NavObstacleBox } from '../../sdk/src/ai/nav/navObstacles';

const cellSize = 10;
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const percentile = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.ceil(q * a.length) - 1]!;
const frame = () => new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now())));

/** Deterministic building footprints and a wall with a six-cell door. */
export function obstacles(size: number, closed: boolean, placed: boolean): NavObstacleBox[] {
    const span = size * cellSize, mid = span / 2, gap = cellSize * 3;
    const boxes: NavObstacleBox[] = [];
    const add = (x: number, z: number, hx: number, hz: number) => boxes.push({
        center: { x, y: 15, z }, halfExtents: { x: hx, y: 20, z: hz }, rotation,
    });
    add(mid, (mid - gap) / 2, cellSize, (mid - gap) / 2);
    add(mid, (span + mid + gap) / 2, cellSize, (span - mid - gap) / 2);
    if (closed) add(mid, mid, cellSize, gap);
    for (let z = 8; z < size - 5; z += 12) for (let x = 7; x < size - 5; x += 12) {
        if (Math.abs(x - size / 2) < 7 || Math.abs(z - size / 2) < 5) continue;
        add(x * cellSize, z * cellSize, cellSize * 2, cellSize * 2);
    }
    if (placed) add(span * 0.25, mid - cellSize * 4, cellSize * 2, cellSize * 2);
    return boxes;
}

export async function runNavigationBuildCorpus() {
    const records = [];
    for (const size of [32, 64, 128]) {
        const span = size * cellSize;
        const verts = new Float32Array([0, 0, 0, span, 0, 0, span, 0, span, 0, 0, span]);
        const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);
        for (const mode of ['mesh-full-bake', 'grid-obstacle-update'] as const) {
            const grid = new NavGrid({ width: size, height: size, cellSize });
            const samples = [], queries = [], totals = [], frameGaps = [], shapes = [];
            for (let iteration = -3; iteration < 16; iteration++) {
                const closed = iteration % 2 === 0, placed = iteration % 3 === 0;
                const boxes = obstacles(size, closed, placed);
                const beforeFrame = await frame();
                const start = performance.now();
                let route: { x: number; y: number; z: number }[] | null;
                let polygons = 0;
                let surface: NavGrid | ReturnType<typeof buildNavMesh>;
                if (mode === 'mesh-full-bake') {
                    const mesh = buildNavMesh(verts, indices, {
                        min: { x: 0, y: -20, z: 0 }, max: { x: span, y: 80, z: span },
                        cellSize, cellHeight: 2, agentRadius: 5, agentHeight: 20, stepHeight: 4,
                        minRegionArea: 0, obstacles: boxes,
                    });
                    const elapsed = performance.now() - start;
                    surface = mesh;
                    polygons = mesh.polyCount;
                    if (iteration >= 0) samples.push(elapsed);
                } else {
                    applyObstaclesToGrid(grid, boxes.map(b => ({
                        ...b, center: { x: b.center.x, y: b.center.z, z: 0 },
                        halfExtents: { x: b.halfExtents.x, y: b.halfExtents.z, z: 20 },
                    })));
                    if (iteration >= 0) samples.push(performance.now() - start);
                    surface = grid;
                }
                const queryStart = performance.now();
                route = mode === 'mesh-full-bake'
                    ? surface.findWorldPath({ x: span * 0.2, y: 2, z: span / 2 }, { x: span * 0.8, y: 2, z: span / 2 }, { radius: 5 })
                    : surface.findWorldPath({ x: span * 0.2, y: span / 2 }, { x: span * 0.8, y: span / 2 }, { radius: 5 });
                for (let agent = 1; agent < 64; agent++) {
                    const a = span * (0.15 + 0.7 * (agent % 16) / 15);
                    const b = span * (0.15 + 0.7 * ((agent * 7) % 16) / 15);
                    surface.findWorldPath(mode === 'mesh-full-bake' ? { x: span * 0.2, y: 2, z: a } : { x: span * 0.2, y: a },
                        mode === 'mesh-full-bake' ? { x: span * 0.8, y: 2, z: b } : { x: span * 0.8, y: b }, { radius: 5 });
                }
                const queryMs = performance.now() - queryStart;
                const totalMs = performance.now() - start;
                const nextFrame = await frame();
                if (nextFrame - beforeFrame + 1 < totalMs) throw Error('Frame interval does not cover the measured CPU work');
                if (iteration >= 0) {
                    frameGaps.push(nextFrame - beforeFrame);
                    queries.push(queryMs); totals.push(totalMs);
                    shapes.push({ closed, placed, obstacleCount: boxes.length, polygons, waypoints: route?.length ?? 0,
                        end: route?.at(-1) ?? null });
                }
            }
            const target = span * 0.8;
            for (const [i, shape] of shapes.entries()) {
                if (!shape.end) throw Error('No route in corpus ' + mode + '/' + size + '/' + i);
                const complete = mode === 'mesh-full-bake' ? shape.end.x >= target - cellSize * 2 : shape.end.x >= target - cellSize;
                if (complete === shape.closed) throw Error('Door did not change reachability: ' + JSON.stringify(shape));
            }
            records.push({ mode, size, cellSize, triangles: 2, agents: 64,
                samplesMs: samples, querySamplesMs: queries, totalSamplesMs: totals, frameGapsMs: frameGaps,
                medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95),
                queryP95Ms: percentile(queries, 0.95), updateP95Ms: percentile(totals, 0.95),
                overFrameBudget: samples.filter(ms => ms > 1000 / 60).length,
                updatesOverFrameBudget: totals.filter(ms => ms > 1000 / 60).length,
                frameGapP95Ms: percentile(frameGaps, 0.95), shapes });
        }
    }
    return { frameBudgetMs: 1000 / 60, warmup: 3, samples: 16, records };
}
