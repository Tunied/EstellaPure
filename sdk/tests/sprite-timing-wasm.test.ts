// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Sprite } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { SpriteAnimator, SpriteAnimationAPI, type SpriteAnimClip } from '../src/animation/SpriteAnimator';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('sprite timing on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World, api: SpriteAnimationAPI;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); api = new SpriteAnimationAPI(); });
    afterEach(() => { for (const entity of world.getAllEntities()) world.despawn(entity); world.disconnectCpp(); registry.delete(); });
    const clip = (loop = true): SpriteAnimClip => ({ name: 'clip', fps: 8, loop, frames: [{ texture: 1 }, { texture: 2 }], events: [{ frame: 0, name: 'zero' }, { frame: 1, name: 'one' }] });
    const spawn = (value = clip()) => { api.registerClip(value); const entity = world.spawn(); world.insert(entity, Sprite, { texture: 9 }); world.insert(entity, SpriteAnimator, { clip: value.name, loop: value.loop }); return entity; };

    it('does not repeat the initial event when time does not advance', () => {
        const entity = spawn(), events: string[] = []; api.onEvent(entity, event => events.push(event.name));
        api.update(world, 0); api.update(world, 0);
        expect(events).toEqual(['zero']);
    });

    it('reports crossed frames when a complete loop ends on the starting frame', () => {
        const entity = spawn(), events: string[] = []; api.update(world, 0);
        api.onEvent(entity, event => events.push(event.name)); api.update(world, .25);
        expect(events).toEqual(['one', 'zero']);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(0);
    });

    it('fast-forwards a large elapsed time without retaining a catch-up backlog', () => {
        const entity = spawn(), events: string[] = []; api.update(world, 0);
        api.onEvent(entity, event => events.push(event.name)); api.update(world, 10.125);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(1);
        expect(world.get(entity, SpriteAnimator).frameTimer).toBeCloseTo(0);
        expect(events).toEqual(['one', 'zero']);
        api.update(world, 0);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(1);
        expect(events).toEqual(['one', 'zero']);
    });

    it('does not repeat a single-frame one-shot event at completion', () => {
        const value = clip(false); value.frames = [{ texture: 1 }]; value.events = [{ frame: 0, name: 'zero' }];
        const entity = spawn(value), events: string[] = []; api.onEvent(entity, event => events.push(event.name));
        api.update(world, 0); api.update(world, .125);
        expect(events).toEqual(['zero']);
        expect(world.get(entity, SpriteAnimator).finished).toBe(true);
    });

    it('poses the selected frame when seeking and stopping', () => {
        const entity = spawn(); api.update(world, 0);
        api.gotoFrame(world.get(entity, SpriteAnimator), 1, false); api.update(world, 0);
        expect(world.get(entity, Sprite).texture).toBe(2);
        expect(world.get(entity, SpriteAnimator).playing).toBe(false);
    });

    it('retains the correct phase after a long update with unequal frame durations', () => {
        const value = clip(); value.frames[0].duration = .125; value.frames[1].duration = .375;
        const entity = spawn(value); api.update(world, 0); api.update(world, 123456.25);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(1);
        expect(world.get(entity, SpriteAnimator).frameTimer).toBeCloseTo(.125);
    });

    it('fires the start event once again on an explicit one-shot replay', () => {
        const value = clip(false); value.frames = [{ texture: 1 }]; value.events = [{ frame: 0, name: 'zero' }];
        const entity = spawn(value), events: string[] = []; api.onEvent(entity, event => events.push(event.name));
        api.update(world, 0); api.update(world, .125);
        world.update(entity, SpriteAnimator, animator => { animator.playing = true; });
        api.update(world, 0); api.update(world, 0);
        expect(events).toEqual(['zero', 'zero']);
    });

    it('applies a stopped seek requested inside an event without continuing old events', () => {
        const entity = spawn();
        api.onEvent(entity, event => { if (event.frame === 0) api.gotoFrame(world.get(entity, SpriteAnimator), 1, false); });
        api.update(world, 0); api.update(world, 0);
        expect(world.get(entity, Sprite).texture).toBe(2);
        expect(world.get(entity, SpriteAnimator).playing).toBe(false);
    });
});
