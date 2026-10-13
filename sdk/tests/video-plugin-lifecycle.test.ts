// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { VideoPlugin } from '../src/video/VideoPlugin';
import { VideoPlayer } from '../src/video/VideoAPI';
import { Video } from '../src/video/VideoComponents';
import { NullVideoBackend } from '../src/video/NullVideoBackend';

const { backends } = vi.hoisted(() => ({ backends: [] as NullVideoBackend[] }));
vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    getPlatform: () => ({ createVideoBackend: () => {
        const backend = new NullVideoBackend(); vi.spyOn(backend, 'dispose');
        vi.spyOn(backend, 'createStream').mockImplementation((_url, options) => {
            const handle = new NullVideoBackend().createStream('', options);
            vi.spyOn(handle, 'stop'); vi.spyOn(handle, 'pump'); return handle;
        });
        backends.push(backend); return backend;
    } }),
}));
const apps: App[] = [];
function build(plugin: VideoPlugin) { const app = App.new(); apps.push(app); app.addPlugin(plugin); return app; }
afterEach(() => { for (const app of apps.splice(0)) app.quit(); backends.length = 0; });

it('quitting an older app releases its video backend and preserves the newer app', () => {
    const plugin = new VideoPlugin(), first = build(plugin), second = build(plugin);
    const a = first.getResource(VideoPlayer).play('first.mp4'), b = second.getResource(VideoPlayer).play('second.mp4');
    first.quit();
    expect(backends[0].dispose).toHaveBeenCalledOnce();
    expect(backends[1].dispose).not.toHaveBeenCalled();
    expect(a.stop).toHaveBeenCalledOnce(); expect(b.stop).not.toHaveBeenCalled();
    second.quit(); expect(backends[1].dispose).toHaveBeenCalledOnce();
});

it('releases 100 preview backends without stopping the main app video', () => {
    const plugin = new VideoPlugin(), main = build(plugin);
    const handle = main.getResource(VideoPlayer).play('main.mp4');
    for (let i = 0; i < 100; i++) { const preview = build(plugin); preview.quit(); }
    expect(handle.stop).not.toHaveBeenCalled();
    expect(backends[0].dispose).not.toHaveBeenCalled();
    for (const backend of backends.slice(1)) expect(backend.dispose).toHaveBeenCalledOnce();
    main.quit(); expect(handle.stop).toHaveBeenCalledOnce();
});

it('stopAll retires component handles from the video service, once', async () => {
    const plugin = new VideoPlugin(), app = build(plugin), api = app.getResource(VideoPlayer);
    const entity = app.world.spawn(); app.world.insert(entity, Video, { source: 'a.mp4' });
    await app.tick(1 / 60);
    const handle = vi.mocked(backends[0].createStream).mock.results[0].value;
    plugin.stopAll(); plugin.stopAll();
    const pumps = vi.mocked(handle.pump).mock.calls.length;
    api.update(null);
    expect(handle.stop).toHaveBeenCalledOnce(); expect(handle.pump).toHaveBeenCalledTimes(pumps);
    app.quit(); expect(handle.stop).toHaveBeenCalledOnce();
});

it('parameterless cleanup releases only the latest app and remains idempotent', () => {
    const plugin = new VideoPlugin(), first = build(plugin); build(plugin);
    plugin.cleanup(); plugin.cleanup();
    expect(backends[0].dispose).not.toHaveBeenCalled();
    expect(backends[1].dispose).toHaveBeenCalledOnce();
    first.quit(); expect(backends[0].dispose).toHaveBeenCalledOnce();
});

it('cleanup detaches the world subscription and prevents an old system from starting streams', async () => {
    const app = App.new(); apps.push(app);
    const subscribe = app.world.onDespawn.bind(app.world);
    const off = vi.fn();
    vi.spyOn(app.world, 'onDespawn').mockImplementation(callback => {
        const unsubscribe = subscribe(callback);
        return () => { off(); unsubscribe(); };
    });
    const plugin = new VideoPlugin(); app.addPlugin(plugin);
    plugin.cleanup(app);
    const entity = app.world.spawn(); app.world.insert(entity, Video, { source: 'late.mp4' });
    await app.tick(1 / 60);
    expect(off).toHaveBeenCalledOnce(); expect(backends[0].createStream).not.toHaveBeenCalled();
    app.quit(); expect(backends[0].dispose).toHaveBeenCalledOnce();
});
