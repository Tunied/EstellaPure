// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Disabled, Draggable, Transform } from '../src/ecs/component';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { takePrimaryPointerCancellation } from '../src/input/pointerCancellation';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { UINode } from '../src/ui/core/ui-node';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UIInteraction } from '../src/ui/input/interactable';
import { DragPlugin } from '../src/ui/input/drag';
import { DragState } from '../src/ui/input/draggable';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('drag cancellation on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, input: InputState, entity: Entity;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine);
        input = new InputState(); app.insertResource(Input, input);
        app.insertResource(UIEvents, new UIEventQueue());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true, vpW: 100, vpH: 100 });
        new DragPlugin().build(app); flushPendingRegistrations(app);
        entity = app.world.spawn(); app.world.insert(entity, Transform); app.world.insert(entity, Draggable);
        app.world.insert(entity, UIInteraction, { hovered: true });
    });
    afterEach(() => { app.quit({ keepRenderer: true }); registry.delete(); });
    async function step(x: number) {
        app.getResource(UICameraInfo).worldMouseX = x;
        await app.tick(1 / 60); input.clearFrameState();
    }
    async function drag() { input.noteMouseDown(0); await step(0); await step(20); }
    function stopped() {
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, Transform).position.x).toBeCloseTo(20);
    }
    it('claimed release ends capture after the UI sample consumes cancellation', async () => {
        await drag(); const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { inputEventCallbacks(input).onPointerUp(0); } finally { off(); }
        takePrimaryPointerCancellation(input); await step(100); stopped();
    });
    it.each(['inactive', 'disabled'])('%s targets cannot keep dragging', async kind => {
        await drag();
        if (kind === 'inactive') app.world.insert(entity, Disabled);
        else app.world.update(entity, Draggable, d => { d.enabled = false; });
        await step(100); stopped();
    });
    it('hidden targets stop at the position reached before layout hides them', async () => {
        await drag(); app.world.insert(entity, Canvas); app.world.insert(entity, UINode, { display: 1 });
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(true);
        const resolved = app.world.get(entity, Transform).position.x;
        await step(100);
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, Transform).position.x).toBe(resolved);
    });
});
