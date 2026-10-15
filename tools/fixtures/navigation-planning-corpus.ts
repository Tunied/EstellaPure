// SPDX-License-Identifier: Apache-2.0
import { NavGrid } from '../../sdk/src/ai/nav/NavGrid';
import { Navigation } from '../../sdk/src/ai/nav/Navigation';
import { NavAgent } from '../../sdk/src/ai/nav/NavAgent';
import { stepNavigation, type AgentRuntime, type NavWorldView } from '../../sdk/src/ai/nav/NavPlugin';
import { applyObstaclesToGrid } from '../../sdk/src/ai/nav/navObstacles';
import type { AnyComponentDef, ComponentData } from '../../sdk/src/ecs/component';
import type { Entity } from '../../sdk/src/types';
import type { NavPoint, NavQueryOptions } from '../../sdk/src/ai/nav/NavSurface';
import { obstacles } from './navigation-build-corpus';

const frame = () => new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now())));
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * 0.95) - 1]!;
class World implements NavWorldView {
    readonly ids: Entity[] = [];
    private data = new Map<string, unknown>();
    constructor(span: number) {
        for (let i = 0; i < 64; i++) {
            const id = (i + 1) as Entity;
            this.ids.push(id);
            const a = span * (0.15 + 0.7 * (i % 16) / 15);
            const b = span * (0.15 + 0.7 * ((i * 7) % 16) / 15);
            this.data.set(`${id}:Transform`, { position: { x: span * 0.2, y: a, z: 0 } });
            this.data.set(`${id}:NavAgent`, NavAgent.create({ speed: 0, radius: 5, arriveRadius: 0,
                repathInterval: 0, hasTarget: true, targetX: span * 0.8, targetY: b }));
        }
    }
    getEntitiesWithComponents(): readonly Entity[] { return this.ids; }
    has<C extends AnyComponentDef>(id: Entity, type: C): boolean { return this.data.has(`${id}:${type._name}`); }
    get<C extends AnyComponentDef>(id: Entity, type: C): ComponentData<C> { return this.data.get(`${id}:${type._name}`) as ComponentData<C>; }
    set<C extends AnyComponentDef>(id: Entity, type: C, value: ComponentData<C>): void { this.data.set(`${id}:${type._name}`, value); }
}
class ObservedNavigation extends Navigation {
    readonly shapes: object[] = [];
    readonly queryTimesMs: number[] = [];
    override findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions) {
        const began = performance.now();
        const path = super.findWorldPath(from, to, opts);
        this.queryTimesMs.push(performance.now() - began);
        // Keep every waypoint, not just the first agent's endpoint. Compare all
        // 64 routes across the two budget settings after each door/building edit.
        this.shapes.push({ from: { ...from }, to: { ...to }, radius: opts?.radius,
            path });
        return path;
    }
}

export async function runNavigationPlanningCorpus() {
    const records = [];
    for (const size of [32, 64, 128]) {
        const modes = [];
        for (const mode of ['unlimited', 'budgeted'] as const) {
            const samples = [];
            for (let iteration = -3; iteration < 16; iteration++) {
                const span = size * 10, closed = iteration % 2 === 0, placed = iteration % 3 === 0;
                const world = new World(span), nav = new ObservedNavigation();
                const runtimes = new Map<Entity, AgentRuntime>();
                nav.setSurface(new NavGrid({ width: size, height: size, cellSize: 10 }));
                if (mode === 'unlimited') { nav.planningBudgetMs = 0; nav.maxPlansPerFrame = 0; }
                let previous = await frame();
                const began = previous, buildStart = performance.now();
                applyObstaclesToGrid(nav.surface as NavGrid, obstacles(size, closed, placed).map(box => ({
                    ...box, center: { x: box.center.x, y: box.center.z, z: 0 },
                    halfExtents: { x: box.halfExtents.x, y: box.halfExtents.z, z: 20 },
                })));
                const buildMs = performance.now() - buildStart;
                const cpuMs = [], planningMs = [], frameGapsMs = [], completed = [], pending = [];
                do {
                    const start = performance.now();
                    stepNavigation(world, nav, 1 / 60, runtimes);
                    const elapsed = performance.now() - start;
                    cpuMs.push(elapsed + (cpuMs.length === 0 ? buildMs : 0));
                    planningMs.push(nav.planningStats.elapsedMs);
                    completed.push(nav.planningStats.completed); pending.push(nav.planningStats.pending);
                    const next = await frame();
                    const gap = next - previous;
                    if (gap + 1 < cpuMs.at(-1)!) throw Error('Frame gap excludes measured CPU work');
                    frameGapsMs.push(gap); previous = next;
                    if (cpuMs.length > 64 || (nav.planningStats.pending > 0 && nav.planningStats.completed === 0)) throw Error('Planning queue did not make progress');
                } while (nav.planningStats.pending > 0);
                if (nav.shapes.length !== 64) throw Error('Did not query all 64 agents');
                if (mode === 'budgeted' && completed.some(n => n > nav.maxPlansPerFrame)) throw Error('Count budget exceeded');
                if (iteration >= 0) samples.push({ closed, placed, buildMs, cpuMs, planningMs, frameGapsMs, completed, pending,
                    latencyMs: previous - began, queryTimesMs: nav.queryTimesMs, shapes: nav.shapes });
            }
            modes.push({ mode, samples,
                peakStepP95Ms: p95(samples.map(s => Math.max(...s.cpuMs))),
                peakPlanningP95Ms: p95(samples.map(s => Math.max(...s.planningMs))),
                peakQueryP95Ms: p95(samples.map(s => Math.max(...s.queryTimesMs))),
                peakFrameGapP95Ms: p95(samples.map(s => Math.max(...s.frameGapsMs))),
                totalCpuP95Ms: p95(samples.map(s => s.cpuMs.reduce((a, b) => a + b, 0))),
                latencyP95Ms: p95(samples.map(s => s.latencyMs)),
                batchesOverFrameBudget: samples.filter(s => Math.max(...s.cpuMs) > 1000 / 60).length });
        }
        for (let i = 0; i < 16; i++) {
            if (JSON.stringify(modes[0]!.samples[i]!.shapes) !== JSON.stringify(modes[1]!.samples[i]!.shapes)) throw Error('Budget settings changed route shapes');
        }
        records.push({ size, agents: 64, planningBudgetMs: 2, maxPlansPerFrame: 16, modes });
    }
    return { warmup: 3, samples: 16, frameBudgetMs: 1000 / 60, records };
}
