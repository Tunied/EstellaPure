// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { SafeAreaPlugin } from '../src/ui/layout/safe-area';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { subscribeSafeAreaResize } from '../src/ui/layout/safe-area-resize';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { wechatProfile } from '../src/platform/wechat/profile';
import { bootMockApp } from './helpers/mockApp';
import type { App } from '../src/app/app';
const apps: App[] = [];
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    vi.unstubAllGlobals(); setPlatform(webAdapter);
});
const appWith = (plugin: SafeAreaPlugin) => {
    const app = bootMockApp().app; apps.push(app); app.addPlugin(uiLayoutPlugin); app.addPlugin(plugin); return app;
};
const webHost = () => {
    const callbacks = new Set<() => void>();
    return { callbacks, window: {
        addEventListener: (type: string, listener: () => void) => { if (type === 'resize') callbacks.add(listener); },
        removeEventListener: (type: string, listener: () => void) => { if (type === 'resize') callbacks.delete(listener); },
    } };
};
it('quitting one app preserves the other app resize listener and releases its own', () => {
    const host = webHost(); vi.stubGlobal('window', host.window); setPlatform(webAdapter);
    const plugin = new SafeAreaPlugin(), first = appWith(plugin);
    const firstListener = [...host.callbacks][0];
    const second = appWith(plugin), secondListener = [...host.callbacks][1];
    first.quit();
    expect(host.callbacks.has(firstListener)).toBe(false);
    expect(host.callbacks.has(secondListener)).toBe(true);
    second.quit(); expect(host.callbacks.size).toBe(0);
});
it('rebuilding the same app keeps only its latest resize listener', () => {
    const host = webHost(); vi.stubGlobal('window', host.window); setPlatform(webAdapter);
    const plugin = new SafeAreaPlugin(), app = appWith(plugin);
    plugin.build(app);
    expect(host.callbacks.size).toBe(1);
    app.quit(); expect(host.callbacks.size).toBe(0);
});
it('cleanup uses the window that registered the listener after the global host changes', () => {
    const original = webHost(), replacement = webHost();
    vi.stubGlobal('window', original.window); setPlatform(webAdapter);
    const app = appWith(new SafeAreaPlugin());
    vi.stubGlobal('window', replacement.window);
    app.quit(); expect(original.callbacks.size).toBe(0);
});
it('releases each WeChat resize listener by the same callback identity', () => {
    const callbacks = new Set<() => void>();
    vi.stubGlobal('wx', { onWindowResize: (listener: () => void) => callbacks.add(listener), offWindowResize: (listener: () => void) => callbacks.delete(listener) });
    setPlatform(new MiniGamePlatformAdapter(wechatProfile));
    const plugin = new SafeAreaPlugin(), first = appWith(plugin), firstListener = [...callbacks][0];
    const second = appWith(plugin), secondListener = [...callbacks][1];
    first.quit(); expect(callbacks.has(firstListener)).toBe(false); expect(callbacks.has(secondListener)).toBe(true);
    second.quit(); expect(callbacks.size).toBe(0);
});
it('revokes callbacks on older WeChat hosts that cannot unregister listeners', () => {
    let listener = () => {};
    vi.stubGlobal('wx', { onWindowResize: (callback: () => void) => { listener = callback; } });
    setPlatform(new MiniGamePlatformAdapter(wechatProfile));
    const changed = vi.fn(), release = subscribeSafeAreaResize(changed);
    listener(); expect(changed).toHaveBeenCalledOnce();
    release(); listener(); expect(changed).toHaveBeenCalledOnce();
    expect(() => release()).not.toThrow();
});
it('keeps parameterless cleanup compatible and idempotent for the latest app', () => {
    const host = webHost(); vi.stubGlobal('window', host.window); setPlatform(webAdapter);
    const plugin = new SafeAreaPlugin(), app = appWith(plugin);
    plugin.cleanup(); plugin.cleanup(); expect(host.callbacks.size).toBe(0);
    app.quit(); expect(host.callbacks.size).toBe(0);
});
it('keeps listener counts bounded through repeated preview app creation and shutdown', () => {
    const host = webHost(); vi.stubGlobal('window', host.window); setPlatform(webAdapter);
    const plugin = new SafeAreaPlugin(), main = appWith(plugin);
    for (let cycle = 0; cycle < 100; cycle++) {
        const preview = appWith(plugin);
        expect(host.callbacks.size).toBe(2);
        preview.quit(); expect(host.callbacks.size).toBe(1);
    }
    main.quit(); expect(host.callbacks.size).toBe(0);
});
