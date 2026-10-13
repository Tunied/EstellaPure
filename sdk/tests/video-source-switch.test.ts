// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { VideoPlugin } from '../src/video/VideoPlugin';
import { Video } from '../src/video/VideoComponents';
import { NullVideoBackend } from '../src/video/NullVideoBackend';

const { backend } = vi.hoisted(() => ({ backend: { createStream: vi.fn(), dispose: vi.fn(), name: 'probe' } }));
vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    getPlatform: () => ({ createVideoBackend: () => backend }),
}));
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.clearAllMocks(); });

it('applies changed playback settings once without recreating the stream', async () => {
    backend.createStream.mockImplementation((_url, options) => {
        const handle = new NullVideoBackend().createStream('', options);
        for (const key of ['stop', 'setVolume', 'setMuted', 'setLoop', 'setPlaybackRate'] as const) vi.spyOn(handle, key);
        return handle;
    });
    const app = App.new(); apps.push(app); app.addPlugin(new VideoPlugin());
    const entity = app.world.spawn(); app.world.insert(entity, Video, { source: 'clip.mp4' });
    await app.tick(1 / 60);
    const handle = backend.createStream.mock.results[0].value;
    app.world.update(entity, Video, value => {
        value.volume = 0.25; value.muted = false; value.loop = false; value.playbackRate = 2;
    });
    await app.tick(1 / 60);
    expect(handle.setVolume).toHaveBeenCalledWith(0.25);
    expect(handle.setMuted).toHaveBeenCalledWith(false);
    expect(handle.setLoop).toHaveBeenCalledWith(false);
    expect(handle.setPlaybackRate).toHaveBeenCalledWith(2);
    for (let i = 0; i < 100; i++) await app.tick(1 / 60);
    for (const key of ['setVolume', 'setMuted', 'setLoop', 'setPlaybackRate'] as const) expect(handle[key]).toHaveBeenCalledOnce();
    expect(backend.createStream).toHaveBeenCalledOnce(); expect(handle.stop).not.toHaveBeenCalled();
});

it('switches a live source without restarting unchanged streams and releases retired handles', async () => {
    const handles: ReturnType<NullVideoBackend['createStream']>[] = [];
    backend.createStream.mockImplementation((_url, options) => {
        const handle = new NullVideoBackend().createStream('', options);
        vi.spyOn(handle, 'stop'); handles.push(handle); return handle;
    });
    const app = App.new(); apps.push(app); app.addPlugin(new VideoPlugin());
    const entity = app.world.spawn();
    app.world.insert(entity, Video, { source: 'first.mp4' });
    await app.tick(1 / 60);
    for (let i = 0; i < 10; i++) await app.tick(1 / 60);
    expect(backend.createStream).toHaveBeenCalledTimes(1);
    app.world.update(entity, Video, value => { value.source = 'second.mp4'; });
    await app.tick(1 / 60);
    expect(backend.createStream).toHaveBeenCalledTimes(2);
    expect(backend.createStream.mock.calls[1][0]).toBe('second.mp4');
    expect(handles[0].stop).toHaveBeenCalledOnce();
    expect(handles[1].stop).not.toHaveBeenCalled();
    for (let i = 0; i < 100; i++) {
        app.world.update(entity, Video, value => { value.source = `clip-${i}.mp4`; });
        await app.tick(1 / 60);
    }
    app.world.update(entity, Video, value => { value.source = ''; });
    await app.tick(1 / 60);
    expect(handles).toHaveLength(102);
    for (const handle of handles) expect(handle.stop).toHaveBeenCalledOnce();
    app.world.update(entity, Video, value => { value.source = 'second.mp4'; });
    await app.tick(1 / 60);
    expect(handles).toHaveLength(103);
    app.world.despawn(entity);
    expect(handles[102].stop).toHaveBeenCalledOnce();
});
