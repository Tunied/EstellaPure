// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform } from '../src/ecs/component';
import { TweenAPI, TweenTarget } from '../src/animation/Tween';
import { LoopMode, TweenState } from '../src/animation/TweenTypes';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('loop phase on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    it.each([LoopMode.None, LoopMode.Restart, LoopMode.PingPong])('resumes native successors after completion: %j', loop => {
        const api = new TweenAPI(engine, registry), a = world.spawn(), b = world.spawn();
        world.insert(a, Transform); world.insert(b, Transform);
        const first = api.to(a, TweenTarget.PositionX, 0, 10, 1, { loop, loopCount: 2 });
        const next = api.to(b, TweenTarget.PositionX, 0, 20, 10);
        first.then(next);
        api.update(2.25);
        expect(next.state).toBe(TweenState.Running);
        api.update(.25);
        expect(world.get(b, Transform).position.x).toBeGreaterThan(0);
    });

    it('does not revive a native successor cancelled after linking', () => {
        const api = new TweenAPI(engine, registry), a = world.spawn(), b = world.spawn();
        world.insert(a, Transform); world.insert(b, Transform);
        const first = api.to(a, TweenTarget.PositionX, 0, 10, 1);
        const next = api.to(b, TweenTarget.PositionX, 0, 20, 10);
        first.then(next); next.cancel();
        api.update(1);
        expect(world.get(b, Transform).position.x).toBe(0);
    });

    it.each([LoopMode.Restart, LoopMode.PingPong])('matches JS and native loop phase across time steps and counts: %j', loop => {
        for (const loopCount of [0, 1, 2, 3, 4]) {
            for (const elapsed of [0, .25, 1, 1.25, 2, 2.25, 3, 3.25, 10.25, 1000000.25]) {
                const api = new TweenAPI(engine, registry), entity = world.spawn();
                world.insert(entity, Transform);
                api.to(entity, TweenTarget.PositionX, 0, 10, 1, { loop, loopCount });
                const values: number[] = [];
                const handle = api.value(0, 10, 1, value => values.push(value), { loop, loopCount });
                api.update(elapsed);
                const complete = loopCount > 0 && elapsed >= loopCount;
                const boundary = elapsed > 0 && elapsed % 1 === 0;
                const cycle = complete ? loopCount - 1 : Math.floor(elapsed) - (boundary ? 1 : 0);
                const t = complete || boundary ? 1 : elapsed % 1;
                const expected = 10 * (loop === LoopMode.PingPong && cycle % 2 === 1 ? 1 - t : t);
                expect(values).toEqual([expected]);
                expect(world.get(entity, Transform).position.x).toBeCloseTo(expected);
                expect(handle.state).toBe(complete ? TweenState.Completed : TweenState.Running);
            }
        }
    });

    it('retains delay remainder with a subsecond ping-pong duration', () => {
        const api = new TweenAPI(engine, registry), entity = world.spawn();
        world.insert(entity, Transform);
        api.to(entity, TweenTarget.PositionX, 0, 10, .125, { loop: LoopMode.PingPong, delay: .5 });
        const values: number[] = [];
        api.value(0, 10, .125, value => values.push(value), { loop: LoopMode.PingPong, delay: .5 });
        api.update(.8125);
        expect(values).toEqual([5]);
        expect(world.get(entity, Transform).position.x).toBeCloseTo(5);
    });
});
