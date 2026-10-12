// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-list-view-widget.test.ts
 * @brief   Integration tests for the createListView widget factory over the real
 *          WASM module + full uiPlugin — virtualization, scroll re-mount, dispose.
 *
 * Requires pre-built WASM at build/wasm/web/esengine.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiPlugin } from '../src/ui/ui-plugin';
import { createListView, type ListViewHandle } from '../src/ui/widgets/list-view';
import { spawnUIEntity } from '../src/ui/core/compose';
import { arrayDataSource } from '../src/ui/collection/data-source';
import { px, percent } from '../src/ui/core/dimension';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import { Canvas } from '../src/ecs/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('createListView (WASM integration)', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function createApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0,
            worldLeft: 0, worldBottom: 0, worldRight: 800, worldTop: 600,
            worldMouseX: 0, worldMouseY: 0, valid: true, revision: 1,
        });
        // No inputPlugin: it binds platform input (unavailable in tests). The Input
        // resource has a default InputState, so the ScrollWheelSystem still resolves.
        app.addPlugin(uiPlugin);
        return { app, registry };
    }

    function disposeApp(app: App, registry: CppRegistry): void {
        const world = app.world;
        for (const e of world.getAllEntities()) { try { world.despawn(e); } catch (_) {} }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    const bigList = (n: number) =>
        arrayDataSource(Array.from({ length: n }, (_, i) => i));

    const numberRow = {
        create: (w: import('../src/ecs/world').World, parent: import('../src/types').Entity) =>
            spawnUIEntity({ world: w, parent, node: { height: px(40) } }),
        bind: () => {},
    };

    it('virtualizes: a 1000-item list mounts only items near the viewport', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            host: uiPlugin,
            world: app.world,
            viewportSize: { x: 200, y: 200 },   // 5 rows visible @ 40px
            data: bigList(1000),
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);

        const mounted = list.mountedCount();
        expect(mounted).toBeGreaterThan(0);
        expect(mounted).toBeLessThanOrEqual(12);   // ~5 visible + buffer, NEVER 1000

        list.dispose();
        disposeApp(app, registry);
    });

    it('re-mounts a new window on scroll without growing the mount set', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            host: uiPlugin,
            world: app.world,
            viewportSize: { x: 200, y: 200 },
            data: bigList(1000),
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);
        const before = list.mountedCount();

        list.scroll.setOffset({ x: 0, y: 4000 });   // jump ~100 rows down
        await app.tick(1 / 60);

        expect(list.mountedCount()).toBeGreaterThan(0);
        expect(list.mountedCount()).toBeLessThanOrEqual(before + 4);   // stable, not accumulating

        list.dispose();
        disposeApp(app, registry);
    });

    it('grows the mount set when the data source grows, and dispose clears it', async () => {
        const { app, registry } = createApp();
        const data = bigList(3);
        const list = createListView<number>({
            host: uiPlugin,
            world: app.world,
            viewportSize: { x: 200, y: 400 },   // fits ~10 rows → all 3 visible
            data,
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);
        expect(list.mountedCount()).toBe(3);

        (data as ReturnType<typeof bigList>).append([3, 4, 5, 6]);
        await app.tick(1 / 60);
        expect(list.mountedCount()).toBe(7);

        list.dispose();
        expect(list.mountedCount()).toBe(0);
        disposeApp(app, registry);
    });

    it('grid layout mounts a virtualized subset of a large tile set', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            host: uiPlugin,
            world: app.world,
            viewportSize: { x: 300, y: 200 },
            data: bigList(1000),
            layout: { columns: 3, itemSize: { x: 96, y: 96 } },
            item: {
                create: (w, parent) => spawnUIEntity({ world: w, parent, node: { width: px(96), height: px(96) } }),
                bind: () => {},
            },
        });

        await app.tick(1 / 60);
        expect(list.mountedCount()).toBeGreaterThan(0);
        expect(list.mountedCount()).toBeLessThan(60);   // a few rows of 3, not 1000

        list.dispose();
        disposeApp(app, registry);
    });

    it('keeps a constrained viewport, scroll range and final row in agreement after resize', async () => {
        const { app, registry } = createApp();
        const parent = spawnUIEntity({ world: app.world, node: { width: px(180), height: px(140) } });
        app.world.insert(parent, Canvas, {});
        const list = createListView<number>({
            host: uiPlugin, world: app.world, parent,
            viewportSize: { x: 200, y: 200 },
            node: { width: percent(100), height: percent(100) },
            data: bigList(100), layout: { itemHeight: 40 }, item: numberRow,
        });
        try {
            module.uiLayout_update(registry, 0, 0, 800, 600, true);
            expect(module.getUINodeComputedHeight!(registry, list.entity)).toBe(140);
            await app.tick(1 / 60);
            expect(list.scroll.getViewportSize()).toEqual({ x: 180, y: 140 });
            const node = app.world.get(parent, UINode) as UINodeData;
            node.width = px(160);
            node.height = px(80);
            app.world.insert(parent, UINode, node);
            module.uiLayout_update(registry, 0, 0, 800, 600, true);
            await app.tick(1 / 60);
            expect(list.scroll.getViewportSize()).toEqual({ x: 160, y: 80 });
            expect(list.view.getContentSize().x).toBe(160);
            list.scrollToIndex(99);
            await app.tick(1 / 60);
            expect(list.scroll.getOffset().y).toBe(3920);
            expect(list.view.getVisibleRange()).toEqual([98, 100]);
            expect(list.mountedCount()).toBeLessThanOrEqual(6);
            node.width = px(240);
            node.height = px(240);
            app.world.insert(parent, UINode, node);
            module.uiLayout_update(registry, 0, 0, 800, 600, true);
            await app.tick(1 / 60);
            expect(list.scroll.getViewportSize()).toEqual({ x: 240, y: 240 });
            expect(list.scroll.getOffset().y).toBe(3760);
            expect(list.view.getViewport().y).toBe(3760);
        } finally {
            list.dispose();
            disposeApp(app, registry);
        }
    });

    it('reads viewport geometry from its own world after another app binds UI', () => {
        const first = createApp();
        const root = spawnUIEntity({ world: first.app.world, node: { width: px(180), height: px(140) } });
        first.app.world.insert(root, Canvas, {});
        const list = createListView<number>({ host: uiPlugin, world: first.app.world, parent: root,
            viewportSize: { x: 200, y: 200 }, node: { width: percent(100), height: percent(100) },
            data: bigList(100), layout: { itemHeight: 40 }, item: numberRow });
        module.uiLayout_update(first.registry, 0, 0, 800, 600, true);
        const second = createApp();
        try {
            list.view.update();
            expect(list.scroll.getViewportSize()).toEqual({ x: 180, y: 140 });
            expect(list.view.getViewport().width).toBe(180);
        } finally {
            list.dispose();
            disposeApp(first.app, first.registry);
            disposeApp(second.app, second.registry);
        }
    });

    it('remeasures variable-height items at the new width before clamping the scroll extent', async () => {
        const { app, registry } = createApp();
        const parent = spawnUIEntity({ world: app.world, node: { width: px(180), height: px(140) } });
        app.world.insert(parent, Canvas, {});
        let list: ListViewHandle<number> | undefined;
        list = createListView<number>({ host: uiPlugin, world: app.world, parent,
            viewportSize: { x: 200, y: 200 }, node: { width: percent(100), height: percent(100) },
            data: bigList(100), item: numberRow,
            layout: { itemHeight: () => (list?.view.getViewport().width ?? 200) > 160 ? 40 : 80 } });
        try {
            module.uiLayout_update(registry, 0, 0, 800, 600, true);
            await app.tick(1 / 60);
            list.scroll.setOffset({ x: 0, y: 850 });
            const node = app.world.get(parent, UINode) as UINodeData;
            node.width = px(160);
            node.height = px(80);
            app.world.insert(parent, UINode, node);
            module.uiLayout_update(registry, 0, 0, 800, 600, true);
            await app.tick(1 / 60);
            expect(list.scroll.getOffset().y).toBe(850);
            expect(list.scroll.getContentSize()).toEqual({ x: 160, y: 8000 });
            list.scrollToIndex(99);
            await app.tick(1 / 60);
            expect(list.scroll.getOffset().y).toBe(7920);
            expect(list.view.getVisibleRange()).toEqual([99, 100]);
        } finally {
            list.dispose();
            disposeApp(app, registry);
        }
    });
});
