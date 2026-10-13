// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { takePrimaryPointerCancellation } from '../src/input/pointerCancellation';
import { Canvas, Disabled, Transform } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
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
        // Refresh the shared WASM layout cache for this registry before pointer projection.
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
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
    it('an editor-owned release cancels the drag without starting a fling', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { inputEventCallbacks(input).onPointerUp(0); } finally { off(); }
        takePrimaryPointerCancellation(input);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('a new press before sampling cancellation grabs from the retained offset', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        inputEventCallbacks(input).onInputCancel!();
        input.noteMouseDown(0); await step(200); await step(240);
        expect(scroll.getOffset().y).toBe(120);
        inputEventCallbacks(input).onInputCancel!();
        for (let i = 0; i < 10; i++) await step(300);
        expect(scroll.getOffset().y).toBe(120);
    });
    it.each(['inactive', 'noninteractive'])('a %s captured viewport stops moving', async kind => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        if (kind === 'inactive') app.world.insert(entity, Disabled);
        else app.world.insert(entity, Interactable, { enabled: false });
        await step(120);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('losing all pointer projections cancels capture before the view returns', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        app.getResource(UICameraInfo).valid = false; await step(120);
        app.getResource(UICameraInfo).valid = true; await step(140);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('a hidden viewport stops its captured drag after layout resolves visibility', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        app.world.insert(entity, Canvas); app.world.insert(entity, Transform);
        app.world.insert(entity, UINode, { display: 1 });
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(true);
        await step(120);
        expect(scroll.getOffset().y).toBe(80);
    });
    it('disabling a viewport stops an already released fling', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        input.noteMouseUp(0); await step(100);
        const before = scroll.getOffset().y;
        app.world.insert(entity, Disabled);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(before);
    });
    it('host input cancellation stops a released fling before the next frame', async () => {
        const scroll = container(); plugin.attachScrollContainer(entity, scroll); await drag();
        input.noteMouseUp(0); await step(100); await step(100);
        const before = scroll.getOffset().y;
        expect(before).toBeGreaterThan(100);
        inputEventCallbacks(input).onInputCancel!();
        takePrimaryPointerCancellation(input);
        for (let i = 0; i < 10; i++) await step(100);
        expect(scroll.getOffset().y).toBe(before);
    });
});
