// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Disabled, Parent } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UIDialog } from '../src/ui/behavior/dialog';
import { UINode } from '../src/ui/core/ui-node';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import { inspectFocusTraversal, isFocusEligible } from '../src/ui/input/focus-inspection';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('focus transitions on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry();
        app = App.new(); app.connectCpp(registry, engine);
        app.insertResource(Input, new InputState());
        app.insertResource(UIEvents, new UIEventQueue());
        focusPlugin.build(app); flushPendingRegistrations(app);
    });
    afterEach(() => {
        focusPlugin.cleanup(app);
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp(); registry.delete();
    });
    const control = (tabIndex: number) => {
        const entity = app.world.spawn();
        app.world.insert(entity, Focusable, { tabIndex });
        return entity;
    };
    const tab = async () => {
        app.getResource(Input).keysPressed.add('Tab');
        await app.tick(1 / 60);
        app.getResource(Input).keysPressed.clear();
    };
    it.each(['despawn', 'remove', 'modal', 'disable'] as const)(
        'rejects a next target invalidated by blur: %s', async mutation => {
            const first = control(0), next = control(1);
            const modal = app.world.spawn(); app.world.insert(modal, UINode);
            await tab();
            app.getResource(UIEvents).on(first, 'blur', () => {
                if (mutation === 'despawn') app.world.despawn(next);
                if (mutation === 'remove') app.world.remove(next, Focusable);
                if (mutation === 'modal') app.world.insert(modal, UIDialog);
                if (mutation === 'disable') app.world.insert(next, Disabled);
            });
            await tab();
            expect(app.getResource(FocusManager).focusedEntity).toBeNull();
            if (app.world.valid(next) && app.world.has(next, Focusable)) {
                expect(app.world.get(next, Focusable).isFocused).toBe(false);
            }
        });
    it('clears a target deleted by its focus callback in the same tick', async () => {
        const entity = control(0);
        app.getResource(UIEvents).on(entity, 'focus', () => app.world.despawn(entity));
        await tab();
        expect(app.getResource(FocusManager).focusedEntity).toBeNull();
    });
    it('checks inherited inactivity without enumerating other focusables', () => {
        const parent = app.world.spawn(), entity = control(0);
        app.world.insert(entity, Parent, { entity: parent });
        expect(isFocusEligible(app.world, entity)).toBe(true);
        app.world.insert(parent, Disabled);
        expect(inspectFocusTraversal(app.world).entries).toEqual([]);
        expect(isFocusEligible(app.world, entity)).toBe(false);
        app.world.remove(parent, Disabled);
        const queries = vi.spyOn(app.world, 'getEntitiesWithComponents');
        expect(isFocusEligible(app.world, entity)).toBe(true);
        expect(queries.mock.calls.every(([components]) => !components.includes(Focusable))).toBe(true);
        queries.mockRestore();
    });
});
