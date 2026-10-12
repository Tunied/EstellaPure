// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Input, InputState } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UIInteraction } from '../src/ui/input/interactable';
import { UIBehaviorPlugin } from '../src/ui/behavior/plugin';
import { ScrollContainer } from '../src/ui/collection/scroll-container';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('scroll motion ownership on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, plugin: UIBehaviorPlugin;
    let entity: Entity, input: InputState;
    const container = () => new ScrollContainer({ viewportSize: { x: 100, y: 100 },
        contentSize: { x: 100, y: 2000 }, decelerationRate: .135 });
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        input = new InputState(); app.insertResource(Input, input);
        app.insertResource(UIEvents, new UIEventQueue());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true,
            vpW: 100, vpH: 100, screenW: 100, screenH: 100 });
        plugin = new UIBehaviorPlugin(); plugin.build(app); flushPendingRegistrations(app);
        entity = app.world.spawn(); app.world.insert(entity, UIInteraction, { hovered: true });
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    async function step(y: number) {
        app.getResource(UICameraInfo).worldMouseY = y;
        await app.tick(1 / 60); input.clearFrameState();
    }
    async function drag() {
        input.noteMouseDown(0); await step(0); await step(40); await step(80);
    }
    it('a replaced container does not inherit an active pointer drag', async () => {
        const old = container(); plugin.attachScrollContainer(entity, old); await drag();
        expect(old.getOffset().y).toBe(80);
        const next = container(); plugin.attachScrollContainer(entity, next);
        await step(120);
        expect(next.getOffset().y).toBe(0);
        expect(old.getOffset().y).toBe(80);
    });
    it('a replaced container does not inherit the previous content fling', async () => {
        const old = container(); plugin.attachScrollContainer(entity, old); await drag();
        input.noteMouseUp(0); await step(100); await step(100);
        expect(old.getOffset().y).toBeGreaterThan(100);
        const next = container(); plugin.attachScrollContainer(entity, next);
        for (let i = 0; i < 10; i++) await step(100);
        expect(next.getOffset().y).toBe(0);
    });
});
