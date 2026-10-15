// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transform, type AnyComponentDef, type ComponentData } from '../src/ecs/component';
import type { Entity } from '../src/types';
import { CharacterController3D } from '../src/physics3d/Physics3DComponents';
import { NavAgent } from '../src/ai/nav/NavAgent';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { stepNavigation, type AgentRuntime, type NavWorldView } from '../src/ai/nav/NavPlugin';

class World implements NavWorldView {
    readonly entities: Entity[] = [];
    private data = new Map<string, unknown>();
    spawn(): Entity {
        const e = (this.entities.length + 1) as Entity;
        this.entities.push(e);
        this.set(e, NavAgent, NavAgent.create({ hasTarget: true, targetX: 80 + e, speed: 0, arriveRadius: 0, repathInterval: 0 }));
        this.set(e, Transform, { position: { x: 0, y: 10, z: 0 } } as ComponentData<typeof Transform>);
        return e;
    }
    getEntitiesWithComponents(): readonly Entity[] { return this.entities; }
    has<C extends AnyComponentDef>(e: Entity, c: C): boolean { return this.data.has(`${e}:${c._name}`); }
    get<C extends AnyComponentDef>(e: Entity, c: C): ComponentData<C> { return structuredClone(this.data.get(`${e}:${c._name}`)) as ComponentData<C>; }
    set<C extends AnyComponentDef>(e: Entity, c: C, data: ComponentData<C>): void { this.data.set(`${e}:${c._name}`, data); }
    patch<C extends AnyComponentDef>(e: Entity, c: C, data: Partial<ComponentData<C>>): void {
        this.set(e, c, { ...this.get(e, c), ...data });
    }
}
function setup(count: number) {
    const world = new World(), nav = new Navigation(), runtimes = new Map<Entity, AgentRuntime>();
    const entities = Array.from({ length: count }, () => world.spawn());
    nav.setSurface(new NavGrid({ width: 20, height: 8, cellSize: 10 }));
    nav.planningBudgetMs = 0;
    const query = vi.spyOn(nav, 'findWorldPath');
    const step = () => stepNavigation(world, nav, 0.01, runtimes);
    return { world, nav, runtimes, entities, query, step };
}
afterEach(() => vi.restoreAllMocks());

describe('agent planning budgets', () => {
    it('serves FIFO requests fairly despite early agents becoming due again and world order changes', () => {
        const f = setup(5); f.nav.maxPlansPerFrame = 2;
        for (const e of f.entities) f.world.patch(e, NavAgent, { repathInterval: 0.001 });
        f.step();
        expect(f.query.mock.calls.map(c => c[1].x)).toEqual([81, 82]);
        expect(f.nav.planningStats).toMatchObject({ completed: 2, pending: 3 });
        f.world.entities.reverse(); f.step();
        expect(f.query.mock.calls.map(c => c[1].x)).toEqual([81, 82, 83, 84]);
        f.step();
        expect(f.query.mock.calls.map(c => c[1].x)).toEqual([81, 82, 83, 84, 85, 82]);
        expect(new Set(f.query.mock.calls.slice(0, 5).map(c => c[1].x)).size).toBe(5);
    });

    it('checks time between queries, guarantees progress, and reports an indivisible overrun honestly', () => {
        const f = setup(5); f.nav.maxPlansPerFrame = 0; f.nav.planningBudgetMs = 2;
        let clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        f.query.mockImplementation((from, to) => { clock += 1.5; return [{ ...from, z: 0 }, { ...to, z: 0 }]; });
        f.step();
        expect(f.nav.planningStats).toEqual({ completed: 2, pending: 3, elapsedMs: 3 });
        f.query.mockImplementation((from, to) => { clock += 25; return [{ ...from, z: 0 }, { ...to, z: 0 }]; });
        f.step();
        expect(f.nav.planningStats).toEqual({ completed: 1, pending: 2, elapsedMs: 25 });
    });

    it('coalesces queued edits and reads current position, target and radius when served', () => {
        const f = setup(2); f.nav.maxPlansPerFrame = 1;
        f.step();
        const e = f.entities[1]!;
        f.world.patch(e, NavAgent, { targetX: 120, targetY: 30, targetZ: 7, radius: 2 });
        f.world.patch(e, Transform, { position: { x: 15, y: 20, z: 3 } });
        f.step();
        expect(f.query.mock.calls[1]).toEqual([{ x: 15, y: 20, z: 3 }, { x: 120, y: 30, z: 7 }, { radius: 2 }]);
        expect(f.runtimes.get(e)).toMatchObject({ plannedX: 120, plannedY: 30, plannedZ: 7, plannedRadius: 2 });
    });

    it('stops deferred character steering while preserving gravity, and drops stopped or removed requests', () => {
        const f = setup(3); f.nav.maxPlansPerFrame = 1;
        const e = f.entities[1]!;
        f.world.set(e, CharacterController3D, { enabled: true, velocity: { x: 10, y: -30, z: 20 } } as ComponentData<typeof CharacterController3D>);
        f.step();
        expect(f.world.get(e, CharacterController3D).velocity).toEqual({ x: 0, y: -30, z: 0 });
        f.world.patch(e, NavAgent, { hasTarget: false });
        f.world.entities.splice(f.world.entities.indexOf(f.entities[2]!), 1);
        f.step();
        expect(f.query).toHaveBeenCalledTimes(1);
        expect(f.nav.planningStats.pending).toBe(0);
        expect(f.runtimes.has(e)).toBe(false);
    });

    it('keeps valid cached routes moving while periodic refresh requests wait', () => {
        const f = setup(3); f.nav.maxPlansPerFrame = 1;
        for (let i = 0; i < 3; i++) f.step();
        for (const e of f.entities) {
            f.world.patch(e, NavAgent, { speed: 10, repathInterval: 0.001 });
        }
        const before = f.entities.map(e => ({ ...f.world.get(e, Transform).position }));
        f.step();
        expect(f.nav.planningStats).toMatchObject({ completed: 1, pending: 2 });
        for (const [i, e] of f.entities.entries()) expect(f.world.get(e, Transform).position.x).toBeGreaterThan(before[i]!.x);
        // A changed target is not a periodic refresh: it waits for a fresh plan.
        const e = f.entities[2]!;
        const held = { ...f.world.get(e, Transform).position };
        f.world.patch(e, NavAgent, { targetX: -50 });
        f.step();
        expect(f.world.get(e, Transform).position).toEqual(held);
    });

    it('retires stale grid routes, even with periodic replanning disabled, and waits safely for its turn', () => {
        const f = setup(2); f.nav.maxPlansPerFrame = 1;
        const e = f.entities[0]!; f.world.patch(e, NavAgent, { speed: 10 });
        f.step();
        const before = { ...f.world.get(e, Transform).position };
        const grid = f.nav.surface as NavGrid;
        for (let y = 0; y < grid.height; y++) grid.setWalkable(5, y, false);
        f.step(); // Entity 2 was already queued; entity 1 joins behind it.
        expect(f.world.get(e, Transform).position).toEqual(before);
        expect(f.nav.planningStats.pending).toBe(1);
        f.step();
        expect(f.query).toHaveBeenCalledTimes(3);
        expect(f.runtimes.get(e)?.waypoints.at(-1)?.x).toBeLessThan(50);
        expect(f.nav.planningStats.pending).toBe(0);
    });

    it('does not keep an old narrow route after body radius changes or explicit invalidation', () => {
        const f = setup(1), e = f.entities[0]!;
        f.world.patch(e, NavAgent, { speed: 10 });
        f.step();
        const before = { ...f.world.get(e, Transform).position };
        f.world.patch(e, NavAgent, { radius: 2 });
        f.query.mockReturnValueOnce(null);
        f.step();
        expect(f.world.get(e, Transform).position).toEqual(before);
        expect(f.runtimes.get(e)?.reachable).toBe(false);
        f.world.patch(e, NavAgent, { radius: 0 }); f.step();
        f.query.mockReturnValue(null); f.nav.invalidatePaths(); f.step();
        expect(f.runtimes.get(e)?.reachable).toBe(false);
    });

    it('cleans runtimes after component removal, supports disabling budgets, and leaves direct queries synchronous', () => {
        const f = setup(20); f.nav.maxPlansPerFrame = 0;
        f.step();
        expect(f.nav.planningStats).toMatchObject({ completed: 20, pending: 0 });
        f.world.entities.length = 0; f.step();
        expect(f.runtimes.size).toBe(0);
        f.nav.maxPlansPerFrame = 1; f.nav.planningBudgetMs = 0.001;
        for (let i = 0; i < 20; i++) expect(f.nav.findWorldPath({ x: 0, y: 10 }, { x: 80, y: 10 })).not.toBeNull();
        expect(f.query).toHaveBeenCalledTimes(40);
    });

    it('clears failed or cancelled navigation steering, then relinquishes idle characters to other controls', () => {
        const f = setup(1), e = f.entities[0]!;
        f.world.set(e, CharacterController3D, { enabled: true, velocity: { x: 10, y: -30, z: 20 } } as ComponentData<typeof CharacterController3D>);
        f.world.patch(e, NavAgent, { speed: 10 }); f.step();
        f.query.mockReturnValueOnce(null); f.nav.invalidatePaths(); f.step();
        expect(f.world.get(e, CharacterController3D).velocity).toEqual({ x: 0, y: -30, z: 0 });
        f.world.patch(e, NavAgent, { hasTarget: false });
        f.world.patch(e, CharacterController3D, { velocity: { x: 8, y: -30, z: 0 } }); f.step();
        expect(f.world.get(e, CharacterController3D).velocity.x).toBe(0);
        f.world.patch(e, CharacterController3D, { velocity: { x: 15, y: -30, z: 0 } }); f.step();
        expect(f.world.get(e, CharacterController3D).velocity.x).toBe(15);
    });

    it('removes a throwing query from the head so other queued agents can make progress', () => {
        const f = setup(2); f.nav.maxPlansPerFrame = 1;
        f.query.mockImplementationOnce(() => { throw Error('custom query failed'); });
        expect(f.step).toThrow('custom query failed');
        f.step();
        expect(f.query.mock.calls.map(c => c[1].x)).toEqual([81, 82]);
        expect(f.nav.planningStats).toMatchObject({ completed: 1, pending: 1 });
        f.step();
        expect(f.query.mock.calls.at(-1)?.[1].x).toBe(81);
    });
});
