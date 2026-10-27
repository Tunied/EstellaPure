// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A Text spawned in Update (after PreUpdate's TextRenderNodeSystem has run) must
 * still be ordered in the frame it appears. Without a UIVisual the order pass
 * skips it, ui_getRenderOrder answers -1, and the glyphs are drawn at the base
 * layer — under every panel — for that one frame: the text of a rebuilt screen
 * flashes out.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Canvas, Transform } from '../src/ecs/component';
import { defineSystem, Schedule } from '../src/ecs/system';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import { Text } from '../src/ui/core/text';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { uiRenderOrderPlugin } from '../src/ui/render/render-order';
import { textPlugin } from '../src/ui/text/plugin';
import { px, auto } from '../src/ui/core/dimension';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { setScreenBox } from './helpers/screenBox';

function box(over: Partial<UINodeData> = {}): UINodeData {
    return {
        display: 0, position: 0, opacity: 1, pointerEvents: 0,
        width: auto(), height: auto(),
        minWidth: auto(), minHeight: auto(), maxWidth: auto(), maxHeight: auto(),
        flexGrow: 0, flexShrink: 1, flexBasis: auto(), alignSelf: 0,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
        ...over,
    } as UINodeData;
}

describe.skipIf(!HAS_WASM)('a Text spawned in Update (WASM integration)', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('is given a render order in the frame it is spawned', async () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        setScreenBox(app, -400, -300, 400, 300);
        app.addPlugin(uiLayoutPlugin);
        app.addPlugin(textPlugin);
        app.addPlugin(uiRenderOrderPlugin);
        const world = app.world;

        const canvas = world.spawn();
        world.insert(canvas, Canvas, {});
        world.insert(canvas, UINode, box());
        world.insert(canvas, Transform);

        let label = 0;
        let spawned = false;
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (spawned) return;
            spawned = true;
            const e = world.spawn();
            world.insert(e, Transform);
            world.insert(e, UINode, box({ position: 1, insetLeft: px(0), insetTop: px(0), width: px(100), height: px(20) }));
            world.insert(e, Text, { content: 'hello' });
            world.setParent(e, canvas);
            label = e as number;
        }, { name: 'SpawnLabel' }));

        await app.tick(1 / 60);

        expect(label).not.toBe(0);
        expect(module.ui_getRenderOrder!(registry, label)).toBeGreaterThanOrEqual(0);

        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch { /* already gone */ }
        }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    });
});
