// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { RenderPipeline } from '../src/render/renderPipeline';
import { Transform } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { Text } from '../src/ui/core/text';
import { InlineImagePlugin } from '../src/ui/text/inline-image-plugin';

const renderers = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn> }>);
vi.mock('../src/ui/util/helpers', async original => ({
    ...await original<typeof import('../src/ui/util/helpers')>(),
    getUINodeWidth: () => 320,
    getUINodeHeight: () => 48,
}));
vi.mock('../src/ui/text/text-renderer', () => ({
    SdfTextRenderer: class {
        atlas = {
            pixelSizeFor: () => 64,
            getGlyph: () => ({
                pageId: 1, u0: 0, v0: 0, u1: 1, v1: 1,
                width: 16, height: 32, advance: 16, bearingX: 0, bearingY: 24,
            }),
        };
        dispose = vi.fn();
        constructor() { renderers.push(this); }
    },
}));
const apps: ReturnType<typeof bootMockApp>['app'][] = [];
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    renderers.length = 0;
});

it('keeps inline measurement pages scoped to the App being closed', async () => {
    const plugin = new InlineImagePlugin();
    const prepare = async () => {
        const { app } = bootMockApp();
        apps.push(app);
        app.setPipeline(new RenderPipeline());
        app.addPlugin(plugin);
        const label = app.world.spawn();
        app.world.insert(label, Transform, {});
        app.world.insert(label, UINode, {});
        app.world.insert(label, Text, {
            content: 'A<img src="icon.png" width="16" height="16">Ω', richText: true,
        });
        await app.tick(1 / 60);
        return app;
    };
    const first = await prepare(), second = await prepare();
    expect(renderers).toHaveLength(2);
    first.quit();
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
    expect(renderers[1].dispose).not.toHaveBeenCalled();
    second.quit();
    plugin.cleanup();
    expect(renderers[1].dispose).toHaveBeenCalledOnce();
});
