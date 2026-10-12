// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Schedule } from '../src/ecs/system';
import { Canvas, Disabled, Transform } from '../src/ecs/component';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UIInteraction, Interactable } from '../src/ui/input/interactable';
import { px } from '../src/ui/core/dimension';
import { initUIHelpers } from '../src/ui/util/helpers';
import { UIEventQueue } from '../src/ui/core/events';
import { UINode } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import { UISlider, createSliderSystem } from '../src/ui/behavior/slider';
import { createSlider } from '../src/ui/widgets/slider';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('slider visual reconciliation on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine); events = new UIEventQueue();
        initUIHelpers(engine as never, registry);
        app.addSystemToSchedule(Schedule.Update, createSliderSystem(app.world, events));
    });
    afterEach(() => { initUIHelpers(null, registry); app.quit({ keepRenderer: true }); registry.delete(); });
    it('range edits repaint fill and thumb without reporting a value change', async () => {
        const changed = vi.fn(), slider = createSlider({ world: app.world, events, value: .5, onChange: changed });
        await app.tick(1 / 60);
        app.world.update(slider.entity, UISlider, d => { d.max = 2; }); await app.tick(1 / 60);
        expect(app.world.get(slider.fillEntity, UIVisual).fillAmount).toBe(.25);
        expect(app.world.get(slider.handleEntity, UINode).insetLeft.value).toBe(25);
        expect(changed).not.toHaveBeenCalled();
    });
    it('new visual targets receive the current fraction immediately', async () => {
        const slider = createSlider({ world: app.world, events, value: .5 }); await app.tick(1 / 60);
        const fill = app.world.spawn(), handle = app.world.spawn();
        app.world.insert(fill, UIVisual); app.world.insert(handle, UINode);
        app.world.update(slider.entity, UISlider, d => { d.fill = fill; d.handle = handle; });
        await app.tick(1 / 60);
        expect(app.world.get(fill, UIVisual).fillAmount).toBe(.5);
        expect(app.world.get(handle, UINode).insetLeft.value).toBe(50);
    });

    async function captureSlider() {
        const root = app.world.spawn(); app.world.insert(root, Canvas); app.world.insert(root, UINode); app.world.insert(root, Transform);
        const slider = createSlider({ world: app.world, events, parent: root,
            node: { width: px(100), height: px(20) }, value: .5 });
        engine.uiLayout_update(registry, -50, -50, 50, 50, true); app.world.ensureTransformsComposed();
        const center = app.world.get(slider.entity, Transform).worldPosition.x;
        const input = new InputState(); input.noteMouseDown(0); app.insertResource(Input, input);
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true, worldMouseX: center });
        app.insertResource(ScreenOverlay, { ...ScreenOverlay._default, pointerX: center });
        app.world.insert(slider.entity, UIInteraction, { justPressed: true });
        await app.tick(1 / 60);
        app.world.update(slider.entity, UIInteraction, ui => { ui.justPressed = false; });
        const first = slider.getValue();
        app.getResource(UICameraInfo).worldMouseX = center + 10;
        app.getResource(ScreenOverlay).pointerX = center + 10;
        await app.tick(1 / 60);
        const value = slider.getValue();
        expect(value).toBeGreaterThan(first);
        return { slider, center, value, input, root };
    }

    it.each(['disabled', 'inactive', 'hidden', 'projection'])('%s cancels a captured slider without resuming it', async kind => {
        const { slider, center, value, root } = await captureSlider();
        if (kind === 'disabled') app.world.update(slider.entity, Interactable, d => { d.enabled = false; });
        if (kind === 'inactive') app.world.insert(slider.entity, Disabled);
        if (kind === 'hidden') {
            app.world.update(root, UINode, n => { n.display = 1; });
            engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        }
        if (kind === 'projection') app.getResource(UICameraInfo).valid = false;
        app.getResource(UICameraInfo).worldMouseX = center + 30;
        app.getResource(ScreenOverlay).pointerX = center + 30;
        await app.tick(1 / 60);
        expect(slider.getValue()).toBe(value);
        if (kind === 'disabled') app.world.update(slider.entity, Interactable, d => { d.enabled = true; });
        if (kind === 'inactive') app.world.remove(slider.entity, Disabled);
        if (kind === 'hidden') {
            app.world.update(root, UINode, n => { n.display = 0; });
            engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        }
        if (kind === 'projection') app.getResource(UICameraInfo).valid = true;
        await app.tick(1 / 60);
        expect(slider.getValue()).toBe(value);
    });

    it('a consumed release followed by an outside press cannot reuse old capture', async () => {
        const { slider, center, value, input } = await captureSlider();
        const callbacks = inputEventCallbacks(input);
        const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { callbacks.onPointerUp(0); } finally { off(); }
        callbacks.onPointerDown(0, 500, 500);
        app.getResource(UICameraInfo).worldMouseX = center + 30;
        app.getResource(ScreenOverlay).pointerX = center + 30;
        await app.tick(1 / 60);
        expect(slider.getValue()).toBe(value);
    });

    it('rebinding legacy UI helpers cannot change this Worlds track width', async () => {
        const { slider, center } = await captureSlider();
        initUIHelpers({ getUINodeComputedWidth: () => 200 } as never, registry);
        app.getResource(UICameraInfo).worldMouseX = center + 20;
        app.getResource(ScreenOverlay).pointerX = center + 20;
        await app.tick(1 / 60);
        expect(slider.getValue()).toBeCloseTo(.7);
    });
});
