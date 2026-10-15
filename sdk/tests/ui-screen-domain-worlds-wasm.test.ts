// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('screen domain ownership on real WASM', () => {
    let engine: ESEngineModule;
    const worlds: Array<{ app: App; registry: CppRegistry }> = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => {
        for (const { app, registry } of worlds.splice(0)) {
            for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
            app.world.disconnectCpp();
            registry.delete();
        }
    });
    const make = (screen: boolean) => {
        setDefaultContext(new AppContext());
        const registry = new engine.Registry(), app = App.new();
        app.connectCpp(registry, engine);
        worlds.push({ app, registry });
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.insert(entity, UINode);
        if (screen) app.world.insert(entity, Canvas);
        return { app, registry, entity };
    };
    it('does not borrow a screen-domain entry from another registry with the same entity ID', () => {
        const first = make(true);
        engine.uiLayout_update(first.registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
        const second = make(false);
        expect(second.entity).toBe(first.entity);
        expect(engine.ui_isScreenDomain!(second.registry, second.entity)).toBe(false);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
        engine.uiLayout_update(second.registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(second.registry, second.entity)).toBe(false);
        engine.uiLayout_update(first.registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(first.registry, first.entity)).toBe(true);
    });
    it('does not classify a despawned entity using the previous layout entry', () => {
        const { app, registry, entity } = make(true);
        engine.uiLayout_update(registry, -50, -50, 50, 50, true);
        expect(engine.ui_isScreenDomain!(registry, entity)).toBe(true);
        app.world.despawn(entity);
        expect(engine.ui_isScreenDomain!(registry, entity)).toBe(false);
    });
});
