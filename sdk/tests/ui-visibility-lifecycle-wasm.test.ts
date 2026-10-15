// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { UIEvents, UIEventQueue, UIEventType } from '../src/ui/core/events';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { uiVisibilityPlugin } from '../src/ui/core/visibility';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('UI component lifetimes on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry();
        app = App.new();
        app.connectCpp(registry, engine);
        app.insertResource(UIEvents, new UIEventQueue());
        uiVisibilityPlugin.build(app);
        flushPendingRegistrations(app);
        app.getResource(UIEvents).on(UIEventType.Shown, () => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        app.world.disconnectCpp();
        registry.delete();
    });
    const tick = async () => {
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        await app.tick(1 / 60);
        return app.getResource(UIEvents).drain().map(event => event.type);
    };
    it.each([false, true])('recreates a panel with a fresh visibility baseline (gap=%s)', async gap => {
        const panel = app.world.spawn();
        app.world.insert(panel, Canvas);
        app.world.insert(panel, Transform);
        app.world.insert(panel, UINode, { display: UIDisplay.None });
        expect(await tick()).toEqual([]);
        expect(engine.getUINodeHiddenInTree!(registry, panel)).toBe(true);
        app.world.remove(panel, UINode);
        if (gap) expect(await tick()).toEqual([]);
        app.world.insert(panel, UINode, { display: UIDisplay.Flex });
        expect(await tick()).toEqual([]);
        expect(engine.getUINodeHiddenInTree!(registry, panel)).toBe(false);
        app.world.update(panel, UINode, node => { node.display = UIDisplay.None; });
        expect(await tick()).toEqual([UIEventType.Hidden]);
        app.world.update(panel, UINode, node => { node.display = UIDisplay.Flex; });
        expect(await tick()).toEqual([UIEventType.Shown]);
    });
    it('keeps replacement storage bounded and does no resolved reads on steady frames', async () => {
        const panel = app.world.spawn();
        app.world.insert(panel, Canvas);
        app.world.insert(panel, Transform);
        app.world.insert(panel, UINode);
        await tick();
        let last = app.world.getComponentIncarnation(panel, UINode);
        for (let i = 0; i < 256; i++) {
            app.world.remove(panel, UINode);
            expect(app.world.getComponentIncarnation(panel, UINode)).toBe(0);
            app.world.insert(panel, UINode, { display: i % 2 ? UIDisplay.None : UIDisplay.Flex });
            const current = app.world.getComponentIncarnation(panel, UINode);
            expect(current).toBeGreaterThan(last);
            last = current;
            expect(await tick()).toEqual([]);
        }
        await tick();
        const reads = vi.spyOn(engine, 'getUINodeHiddenInTree');
        for (let i = 0; i < 60; i++) await tick();
        expect(reads).not.toHaveBeenCalled();
        expect(app.world.getStorageSizes().changes.removedRows).toBe(0);
        expect(app.world.removedReaderCount(UINode)).toBe(0);
        app.world.despawn(panel);
        expect(app.world.getComponentIncarnation(panel, UINode)).toBe(0);
    });
});
