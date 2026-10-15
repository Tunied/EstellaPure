// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    let engine: ESEngineModule, registry: CppRegistry, app: App, input: InputState, entity: Entity, dragPlugin: DragPlugin;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine);
        input = new InputState(); app.insertResource(Input, input);
        app.insertResource(UIEvents, new UIEventQueue());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true, vpW: 100, vpH: 100 });
        dragPlugin = new DragPlugin();dragPlugin.build(app); flushPendingRegistrations(app);
        entity = app.world.spawn(); app.world.insert(entity, Transform); app.world.insert(entity, Draggable);
        app.world.insert(entity, UIInteraction, { hovered: true });
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
    });
    afterEach(() => { dragPlugin.cleanup(app);app.quit({ keepRenderer: true }); registry.delete(); });
    async function step(x: number) {
        app.getResource(UICameraInfo).worldMouseX = x;
        await app.tick(1 / 60); input.clearFrameState();
    }
    async function drag() { input.noteMouseDown(0); await step(0); await step(20); }
    function stopped() {
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, Transform).position.x).toBeCloseTo(20);
    }
    it('follows world-pointer movement through a sheared parent hierarchy', async () => {
        const grand = app.world.spawn(),parent = app.world.spawn();
        app.world.insert(grand, Transform, { scale: { x: 2, y: 1, z: 1 } });
        app.world.insert(parent, Transform, { rotation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) } });
        app.world.setParent(parent, grand);app.world.setParent(entity, parent);
        engine.transform_update(registry);
        input.noteMouseDown(0);await step(0);
        app.getResource(UICameraInfo).worldMouseY = 0;await step(20);
        engine.transform_update(registry);
        const moved = app.world.get(entity, Transform).worldPosition;
        expect(moved.x).toBeCloseTo(20, 4);expect(moved.y).toBeCloseTo(0, 4);
        expect(app.world.get(entity, DragState).isDragging).toBe(true);
    });

    it('ends a captured drag when its parent collapses instead of changing hidden local coordinates', async () => {
        const parent = app.world.spawn();app.world.insert(parent, Transform);app.world.setParent(entity, parent);
        engine.transform_update(registry);await drag();
        const before = app.world.get(entity, Transform).position.x;
        app.world.update(parent, Transform, t => { t.scale.x = 0; });engine.transform_update(registry);
        await step(100);
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, Transform).position.x).toBe(before);
    });

    it('reuses one parent-matrix allocation and releases it on cleanup', async () => {
        const parent = app.world.spawn();app.world.insert(parent, Transform);app.world.setParent(entity, parent);
        engine.transform_update(registry);
        const malloc = vi.spyOn(engine, '_malloc'),free = vi.spyOn(engine, '_free');
        try {
            input.noteMouseDown(0);await step(0);await step(20);await step(30);await step(40);
            const indices = malloc.mock.calls.flatMap((args, i) => args[0] === 64 ? [i] : []);
            expect(indices).toHaveLength(1);
            const pointer = malloc.mock.results[indices[0]].value;
            dragPlugin.cleanup(app);dragPlugin.cleanup(app);
            expect(app.world.get(entity, DragState).isDragging).toBe(false);
            expect(free.mock.calls.filter(args => args[0] === pointer)).toHaveLength(1);
        } finally { malloc.mockRestore();free.mockRestore(); }
    });

    it('claimed release ends capture after the UI sample consumes cancellation', async () => {
        await drag(); const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { inputEventCallbacks(input).onPointerUp(0); } finally { off(); }
        takePrimaryPointerCancellation(input); await step(100); stopped();
    });
    it('a new press before sampling cancellation starts a fresh drag', async () => {
        await drag();
        inputEventCallbacks(input).onInputCancel!();
        input.noteMouseDown(0); await step(100); await step(120);
        expect(app.world.get(entity, DragState).isDragging).toBe(true);
        expect(app.world.get(entity, Transform).position.x).toBeCloseTo(40);
        input.noteMouseUp(0); await step(120);
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
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
    it.each(['self', 'ancestor'] as const)('cancels authored %s hiding before layout resolves it', async kind => {
        await drag();
        expect(app.world.get(entity, DragState).isDragging).toBe(true);
        const root = kind === 'self' ? entity : app.world.spawn();
        app.world.insert(root, Canvas);
        if (root !== entity) {
            app.world.insert(root, Transform);
            app.world.setParent(entity, root);
        }
        app.world.insert(root, UINode);
        app.world.insert(entity, UINode);
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        engine.transform_update(registry);
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(false);
        const before = app.world.get(entity, UINode).insetLeft.value;
        expect(app.world.get(entity, DragState).isDragging).toBe(true);
        app.getResource(UIEvents).drain();
        app.world.update(root, UINode, node => { node.display = 1; });
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(false);
        await step(100);
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, UINode).insetLeft.value).toBe(before);
        expect(app.getResource(UIEvents).drain().filter(event => event.type === 'drag_end')).toHaveLength(1);
    });
    it('rejects a stale hover when authored visibility is already hidden', async () => {
        app.world.insert(entity, UINode, { display: 1 });
        expect(engine.getUINodeHiddenInTree!(registry, entity)).toBe(false);
        await drag();
        expect(app.world.has(entity, DragState)).toBe(false);
        expect(app.world.get(entity, Transform).position.x).toBe(0);
        expect(app.getResource(UIEvents).drain()).toEqual([]);
    });
    it('ends a drag hidden by its start callback before applying a move', async () => {
        app.getResource(UIEvents).on(entity, 'drag_start', () => {
            app.world.insert(entity, UINode, { display: 1 });
        });
        await drag();
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, DragState).totalDeltaWorld.x).toBe(0);
        expect(app.getResource(UIEvents).drain().map(event => event.type)).toEqual(['drag_start', 'drag_end']);
    });
    it('ends a drag hidden by its move callback and does not resume when shown', async () => {
        app.getResource(UIEvents).on(entity, 'drag_move', () => {
            app.world.insert(entity, UINode, { display: 1 });
        });
        await drag();
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        const before = app.world.get(entity, UINode).insetLeft.value;
        expect(app.getResource(UIEvents).drain().map(event => event.type)).toEqual(['drag_start', 'drag_move', 'drag_end']);
        app.world.update(entity, UINode, node => { node.display = 0; });
        await step(100);
        expect(app.world.get(entity, DragState).isDragging).toBe(false);
        expect(app.world.get(entity, UINode).insetLeft.value).toBe(before);
        expect(app.getResource(UIEvents).drain()).toEqual([]);
    });
});
