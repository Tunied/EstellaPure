// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { VideoAPI } from '../src/video/VideoAPI';
import { NullVideoBackend } from '../src/video/NullVideoBackend';

const policy = vi.hoisted(() => ({ enabled: true, muted: true, listeners: new Set<(muted: boolean) => void>() }));
vi.mock('../src/platform/base', () => ({
    isPlatformInitialized: () => true,
    getPlatform: () => ({ onAudioMute: policy.enabled ? (callback: (muted: boolean) => void) => {
        policy.listeners.add(callback); callback(policy.muted);
        return () => policy.listeners.delete(callback);
    } : undefined }),
}));
const services: VideoAPI[] = [];
afterEach(() => { for (const api of services.splice(0)) api.dispose(); policy.listeners.clear(); policy.enabled=true; policy.muted=true; });
function build() {
    const backend = new NullVideoBackend();
    const original = backend.createStream;
    const create = vi.spyOn(backend, 'createStream');
    create.mockImplementation((url, options) => {
        const stream = original.call(backend, url, options);
        vi.spyOn(stream, 'setMuted'); return stream;
    });
    const api = new VideoAPI(backend); services.push(api);
    return { api, create };
}
function mute(value: boolean) { policy.muted=value; for (const callback of policy.listeners) callback(value); }
it('mutes new streams and prevents game controls from overriding host policy', () => {
    const { api, create } = build(), handle = api.play('clip.mp4');
    const raw = create.mock.results[0].value;
    expect(create.mock.calls[0][1].muted).toBe(true);
    handle.setMuted(false); expect(raw.setMuted).toHaveBeenLastCalledWith(true);
    mute(false); expect(raw.setMuted).toHaveBeenLastCalledWith(false);
    handle.setMuted(true); mute(true); mute(false);
    expect(raw.setMuted).toHaveBeenLastCalledWith(true);
});
it('preserves stream method receivers, getters and callback identity', () => {
    const { api } = build(), handle = api.play('clip.mp4');
    handle.pause(); expect(handle.isPlaying).toBe(false);
    handle.play(); expect(handle.isPlaying).toBe(true);
    expect(handle.play).toBe(handle.play);
    const callback = vi.fn(); handle.onEnded=callback;
    expect(handle.onEnded).toBe(callback);
});
it('retires mute targets on stop and unsubscribes on disposal', () => {
    const { api, create } = build(), handle=api.play('clip.mp4');
    const raw=create.mock.results[0].value;
    api.stop(handle); mute(false); expect(raw.setMuted).not.toHaveBeenCalled();
    api.dispose(); expect(policy.listeners.size).toBe(0);
});
it('keeps raw handle identity on platforms without host audio policy', () => {
    policy.enabled=false;
    const { api, create }=build(), handle=api.play('clip.mp4');
    expect(handle).toBe(create.mock.results[0].value);
    expect(create.mock.calls[0][1].muted).toBeUndefined();
});
