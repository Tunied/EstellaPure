// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Sprite } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { SpriteAnimator, SpriteAnimationAPI } from '../src/animation/SpriteAnimator';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { getDefaultContext } from '../src/ecs/context';

describe.skipIf(!HAS_WASM)('sprite animation callback lifecycle on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let world: World;
    let animation: SpriteAnimationAPI;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        registry = new engine.Registry();
        world = new World(); world.connectCpp(registry, engine);
        animation = new SpriteAnimationAPI();
        animation.registerClip({ name: 'walk', frames: [{ texture: 0 }, { texture: 0 }], fps: 10, loop: true, events: [{ frame: 0, name: 'enter' }] });
    });
    afterEach(() => {
        for (const entity of world.getAllEntities()) world.despawn(entity);
        world.disconnectCpp(); registry.delete();
    });
    const spawn = () => { const entity = world.spawn(); world.insert(entity, SpriteAnimator, { clip: 'walk' }); return entity; };

    it('animates native sprite rows without embind snapshots while preserving authored fields', () => {
        const entities = Array.from({ length: 32 }, () => {
            const entity = spawn(); world.insert(entity, Sprite, { texture: 9, layer: 4, flipX: true, color: { r: .2, g: .3, b: .4, a: .8 } }); return entity;
        });
        const reads = vi.spyOn(world, 'get'), writes = vi.spyOn(world, 'set');
        animation.update(world, .1);
        expect(reads.mock.calls.some(([, component]) => component === Sprite)).toBe(false);
        expect(writes.mock.calls.some(([, component]) => component === Sprite)).toBe(false);
        for (const entity of entities) {
            const sprite = world.get(entity, Sprite);
            expect(sprite.texture).toBe(0); expect(sprite.layer).toBe(4); expect(sprite.flipX).toBe(true);
            expect(sprite.color.r).toBeCloseTo(.2); expect(sprite.color.a).toBeCloseTo(.8);
        }
    });

    it('preserves editor mutation notifications during frame application', () => {
        const entity = spawn(); world.insert(entity, Sprite, { texture: 9 });
        const context = getDefaultContext(), previous = context.editorBridge, changed = vi.fn();
        context.editorBridge = { registerComponent() {}, onComponentChanged: changed };
        try {
            animation.update(world, .1);
            expect(changed).toHaveBeenCalledWith(entity, 'Sprite');
            expect(world.get(entity, Sprite).texture).toBe(0);
        } finally { context.editorBridge = previous; }
    });

    it('records the pre-image when applying a frame inside speculation', () => {
        const entity = spawn(); world.insert(entity, Sprite, { texture: 9 });
        const previous: number[] = [];
        world.openSpeculation({ record(w, e, component) {
            if (component === Sprite && previous.length === 0) {
                previous.push(-1); previous[0] = w.get(e, Sprite).texture;
            }
        } });
        try { animation.update(world, .1); } finally { world.closeSpeculation(); }
        expect(previous).toContain(9); expect(world.get(entity, Sprite).texture).toBe(0);
    });

    it('reports direct frame writes to sparse component write readers', () => {
        const entity = spawn(); world.insert(entity, Sprite, { texture: 9 });
        const tick = world.getWorldTick(), reader = world.registerWriteReaderFrom(Sprite, tick);
        world.advanceTick(); animation.update(world, .1);
        expect(world.getWrittenEntitiesSince(Sprite, tick)).toContain(entity);
        world.disposeWriteReader(Sprite, reader);
    });

    it.each(['entity', 'global'] as const)('self-unsubscription does not skip the next %s listener', kind => {
        const entity = spawn();
        const next = vi.fn();
        let off = () => {};
        if (kind === 'entity') {
            off = animation.onEvent(entity, () => off()); animation.onEvent(entity, next);
        } else {
            off = animation.onEventGlobal(() => off()); animation.onEventGlobal(next);
        }
        animation.update(world, 0);
        expect(next).toHaveBeenCalledOnce();
    });

    it('does not deliver the current event to a listener added inside its callback', () => {
        const entity = spawn(); const late = vi.fn();
        animation.onEvent(entity, () => animation.onEventGlobal(late));
        animation.update(world, 0);
        expect(late).not.toHaveBeenCalled();
    });

    it('does not recreate an animator removed by its callback', () => {
        const entity = spawn();
        animation.onEvent(entity, () => world.remove(entity, SpriteAnimator));
        animation.update(world, 0);
        expect(world.has(entity, SpriteAnimator)).toBe(false);
    });

    it('retains a replacement animator installed by its callback', () => {
        const entity = spawn();
        animation.onEvent(entity, () => world.insert(entity, SpriteAnimator, { clip: 'replacement', playing: false }));
        animation.update(world, 0);
        expect(world.get(entity, SpriteAnimator).clip).toBe('replacement');
        expect(world.get(entity, SpriteAnimator).playing).toBe(false);
    });

    it('does not leave phantom animation components after a callback despawns its entity', () => {
        const entity = spawn();
        animation.onEvent(entity, () => world.despawn(entity));
        expect(() => animation.update(world, 0)).not.toThrow();
        expect(world.valid(entity)).toBe(false);
        expect(world.getEntitiesWithComponents([SpriteAnimator])).toHaveLength(0);
    });

    it('skips a later query entry removed by an earlier entity callback', () => {
        const first = spawn(); const later = spawn();
        animation.onEvent(first, () => world.despawn(later));
        expect(() => animation.update(world, 0)).not.toThrow();
        expect(world.valid(later)).toBe(false);
        expect(world.getEntitiesWithComponents([SpriteAnimator])).toEqual([first]);
    });

    it('does not advance recursively when a listener calls update again', () => {
        const entity = spawn(); let calls = 0;
        animation.onEvent(entity, () => { if (++calls < 4) animation.update(world, .25); });
        animation.update(world, 0);
        expect(calls).toBe(1);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(0);
        expect(world.get(entity, SpriteAnimator).frameTimer).toBe(0);
    });

    it('does not access a frame list cleared inside a callback', () => {
        const entity = spawn(); world.insert(entity, Sprite, { texture: 9 });
        animation.onEvent(entity, () => { animation.getClip('walk')!.frames = []; });
        expect(() => animation.update(world, 0)).not.toThrow();
        expect(world.get(entity, Sprite).texture).toBe(9);
    });

    it('reapplies a shortened clip on the next update without accessing the removed frame', () => {
        const entity = spawn(); world.insert(entity, Sprite, { texture: 9 });
        animation.onEvent(entity, () => { animation.getClip('walk')!.frames.splice(1); });
        expect(() => animation.update(world, .1)).not.toThrow();
        expect(world.get(entity, Sprite).texture).toBe(9);
        animation.update(world, 0);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(0);
        expect(world.get(entity, Sprite).texture).toBe(0);
    });

    it('allows later updates after a listener throws', () => {
        const entity = spawn();
        const off = animation.onEvent(entity, () => { throw new Error('listener failure'); });
        expect(() => animation.update(world, 0)).toThrow('listener failure');
        off(); animation.update(world, .1);
        expect(world.get(entity, SpriteAnimator).currentFrame).toBe(1);
    });
});
