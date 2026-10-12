// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { UiPointerHitCache, MOUSE_POINTER } from '../src/ui/input/pointerBook';
import { UIEvents } from '../src/ui/core/events';
import { onGestureClick, fireGestureClick, takeGestureFired } from '../src/ui/input/gestureClick';
import { inputRouter } from '../src/input/inputRouter';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
const hit = vi.hoisted(() => ({ entity: null as number | null }));
// Deterministic picking isolates event dispatch over the actual WASM Registry.
vi.mock('../src/ui/util/ui-pick', () => ({
    screenToUiWorld: () => ({ x: 0, y: 0 }), screenToUiLayout: () => ({ x: 0, y: 0 }),
    uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity,
}));

describe.skipIf(!HAS_WASM)('pointer callback lifecycle on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        app.insertResource(Input, new InputState());
        app.insertResource(UICameraInfo, { valid: false } as any);
        app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
        app.insertResource(UILayoutGeneration, { generation: 0 });
        uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    });
    afterEach(() => {
        uiInteractionPlugin.cleanup(app);
        vi.restoreAllMocks();
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
    });
    it('expires a cancelled gesture marker before a later quick click on real WASM', async () => {
        const entity = app.world.spawn(); hit.entity = entity; app.world.insert(entity, Interactable);
        const input = app.getResource(Input), clicked = vi.fn();
        onGestureClick(app.world, entity, () => {
            clicked(); app.world.update(entity, Interactable, value => { value.enabled = false; });
        });
        app.getResource(UIEvents).on(entity, 'click', () => {
            if (!takeGestureFired(app.world, entity)) clicked();
        });
        input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
        inputRouter.dispatchPointerUp(0); input.noteMouseUp(0); await app.tick(1 / 60); input.clearFrameState();
        app.world.update(entity, Interactable, value => { value.enabled = true; });
        input.noteMouseDown(0); input.noteMouseUp(0); await app.tick(1 / 60);
        expect(clicked).toHaveBeenCalledTimes(2);
    });
    it('cleans gesture registrations and markers across real WASM target lifetimes', () => {
        const before = app.world.getStorageSizes().despawnCallbacks;
        for (let i = 0; i < 1000; i++) {
            const entity = app.world.spawn(); const clicked = vi.fn();
            onGestureClick(app.world, entity, clicked);
            expect(fireGestureClick(app.world, entity)).toBe(true);
            app.world.despawn(entity);
            expect(fireGestureClick(app.world, entity)).toBe(false);
            expect(takeGestureFired(app.world, entity)).toBe(false);
            expect(clicked).toHaveBeenCalledOnce();
        }
        expect(app.world.getStorageSizes().despawnCallbacks).toBe(before + 1);
    });
    it('does not retain past touch IDs across 1000 real interaction updates', async () => {
        const entity = app.world.spawn(); hit.entity = entity;
        app.world.insert(entity, Interactable, { enabled: true });
        const input = app.getResource(Input);
        const retain = vi.spyOn(UiPointerHitCache.prototype, 'retain');
        for (let id = 0; id < 1000; id++) {
            input.touches.set(id, { id, x: 10, y: 20 });
            input.touchesStarted.set(id, { id, x: 10, y: 20 });
            input.endTouch(id);
            await app.tick(1 / 60);
            const cache = retain.mock.contexts[0] as UiPointerHitCache;
            expect([...cache.keys()]).toEqual([id]);
            input.clearFrameState();
        }
        await app.tick(1 / 60);
        const cache = retain.mock.contexts[0] as UiPointerHitCache;
        expect([...cache.keys()]).toEqual([MOUSE_POINTER]);
    });
    for (const mutation of ['disable', 'despawn'] as const) {
        it.each(['hover_enter', 'press', 'release'])(`${mutation} during %s stops later events`, async phase => {
            const entity = app.world.spawn(); hit.entity = entity;
            app.world.insert(entity, Interactable, { enabled: true });
            const kinds: string[] = [];
            for (const kind of ['hover_enter', 'press', 'release', 'click']) {
                app.getResource(UIEvents).on(entity, kind, () => {
                    kinds.push(kind);
                    if (kind !== phase) return;
                    if (mutation === 'despawn') app.world.despawn(entity);
                    else app.world.update(entity, Interactable, data => { data.enabled = false; });
                });
            }
            const input = app.getResource(Input);
            input.noteMouseDown(0); input.noteMouseUp(0);
            await app.tick(1 / 60);
            const order = ['hover_enter', 'press', 'release'];
            expect(kinds).toEqual(order.slice(0, order.indexOf(phase) + 1));
            expect(input.pointerOverUI).toBe(false);
            if (mutation === 'despawn') expect(app.world.valid(entity)).toBe(false);
            else expect(app.world.get(entity, UIInteraction)).toMatchObject({
                hovered: false, pressed: false, justPressed: false, justReleased: false,
            });
        });
    }
});
