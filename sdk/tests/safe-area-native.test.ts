// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { webAdapter } from '../src/platform/web';
import { SafeArea, safeAreaPlugin, type SafeAreaInsets } from '../src/ui/layout/safe-area';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { ScreenLayout } from '../src/ui/core/screen-layout';
import { UINode } from '../src/ui/core/ui-node';
import { createMockModule } from './mocks/wasm';

afterEach(() => setPlatform(webAdapter));

function setup(readInsets?: () => SafeAreaInsets) {
    setPlatform({ ...webAdapter, name: 'native', devicePixelRatio: () => 3,
        ...(readInsets ? { safeAreaInsets: readInsets } : {}),
    } as PlatformAdapter);
    const module = createMockModule();
    const app = App.new();
    app.connectCpp(module.getRegistry(), module);
    app.insertResource(ScreenLayout, {
        ...ScreenLayout._default, valid: true, scale: 2,
        left: 0, bottom: 0, right: 1200, top: 600,
        viewportW: 2400, viewportH: 1200,
    });
    app.addPlugin(uiLayoutPlugin);
    app.addPlugin(safeAreaPlugin);
    const entity = app.world.spawn();
    app.world.insert(entity, UINode, { ...UINode._default });
    app.world.insert(entity, SafeArea, { ...SafeArea._default });
    const read = () => {
        const node = app.world.get(entity, UINode);
        return { top: node.insetTop.value, bottom: node.insetBottom.value,
            left: node.insetLeft.value, right: node.insetRight.value };
    };
    return { app, read };
}

describe('native safe-area layout', () => {
    it('keeps a landscape notch clear in surface pixels without applying DPR twice', async () => {
        const { app, read } = setup(() => ({ top: 0, bottom: 60, left: 192, right: 72 }));
        await app.tick(1 / 60);
        expect(read()).toEqual({ top: 0, bottom: 30, left: 96, right: 36 });
    });

    it('accepts delayed native layout and a side swap with the same viewport dimensions', async () => {
        let insets = { top: 0, bottom: 0, left: 0, right: 0 };
        const { app, read } = setup(() => insets);
        await app.tick(1 / 60);
        expect(read().left).toBe(0);
        insets = { top: 0, bottom: 60, left: 192, right: 72 };
        await app.tick(1 / 60);
        expect(read()).toEqual({ top: 0, bottom: 30, left: 96, right: 36 });
        insets = { top: 0, bottom: 60, left: 72, right: 192 };
        await app.tick(1 / 60);
        expect(read()).toEqual({ top: 0, bottom: 30, left: 36, right: 96 });
    });

    it('keeps older hosts with no safe-area bridge compatible', async () => {
        const { app, read } = setup();
        await app.tick(1 / 60);
        expect(read()).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    });
});
