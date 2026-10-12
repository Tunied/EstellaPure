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
import { UIEvents } from '../src/ui/core/events';
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
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
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
