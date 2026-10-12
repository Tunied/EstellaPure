// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { App } from '../src/app/app';
import { ScreenLayout, screenLayoutRect } from '../src/ui/core/screen-layout';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { Canvas, Transform } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { px } from '../src/ui/core/dimension';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('layout preserves transform composition on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let world: World;
    let app: App;
    let root: ReturnType<World['spawn']>;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine); world = app.world;
        root = world.spawn(); world.insert(root, Transform); world.insert(root, Canvas);
        world.insert(root, UINode, { width: px(100), height: px(80) });
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        engine.transform_update(registry);
    });
    afterEach(() => {
        for (const entity of world.getAllEntities()) world.despawn(entity);
        world.disconnectCpp(); registry.delete();
    });
    const epoch = () => engine.HEAPU32[engine.transform_epochAddress!() >>> 2];
    const serial = () => engine.transform_compositionChanges!().serial;
    it('keeps clean early and late layout passes from recomposing the whole world', async () => {
        app.insertResource(ScreenLayout, screenLayoutRect(null, 800, 600));
        app.addPlugin(uiLayoutPlugin);
        for (let i = 0; i < 3; i++) await app.tick(1 / 60);
        const previousEpoch = epoch(), previousSerial = serial();
        for (let i = 0; i < 20; i++) {
            await app.tick(1 / 60);
            world.ensureTransformsComposed();
        }
        expect(epoch()).toBe(previousEpoch);
        expect(serial()).toBe(previousSerial);
    });
    it('recomposes descendants after the screen box moves without resizing', () => {
        const child = world.spawn(); world.insert(child, Transform, { position: { x: 7, y: 0, z: 0 } });
        world.setParent(child, root); world.ensureTransformsComposed();
        const x = world.get(child, Transform).worldPosition.x, previousSerial = serial();
        engine.uiLayout_update(registry, -300, -300, 500, 300, false);
        world.ensureTransformsComposed();
        expect(world.get(child, Transform).worldPosition.x).toBeCloseTo(x + 100);
        expect(serial()).toBe(previousSerial + 1);
    });
    it('recomposes after authored layout properties and transform writes', () => {
        const previous = serial();
        world.update(root, UINode, node => { node.width = px(160); });
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        world.ensureTransformsComposed();
        expect(engine.getUINodeComputedWidth!(registry, root)).toBeCloseTo(160);
        expect(serial()).toBe(previous + 1);
        world.update(root, Transform, transform => { transform.position.x = 42; });
        world.ensureTransformsComposed();
        expect(world.get(root, Transform).worldPosition.x).toBe(42);
        expect(serial()).toBe(previous + 2);
    });
});
