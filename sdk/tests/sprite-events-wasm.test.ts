// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { SpriteAnimator, SpriteAnimationAPI } from '../src/animation/SpriteAnimator';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

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
});
