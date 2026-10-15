// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { AudioBufferHandle, AudioHandle, PlatformAudioBackend, PlayConfig } from '../src/audio/PlatformAudioBackend';

const loads = new Map<string, (buffer: AudioBufferHandle) => void>();
function voice(id: number): AudioHandle {
    let playing = true;
    return {
        id, stop: vi.fn(() => { playing = false; }), pause: vi.fn(() => { playing = false; }),
        resume: vi.fn(() => { playing = true; }),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        get isPlaying() { return playing; }, currentTime: 0, duration: 1,
    };
}
function create() {
    let nextVoice = 0;
    const backend = {
        name: 'intent-test', delivery: 'bytes', mixer: null, isReady: true,
        initialize: vi.fn(async () => {}), ensureResumed: vi.fn(async () => {}),
        loadBuffer: vi.fn((url: string) => new Promise<AudioBufferHandle>(resolve => { loads.set(url, resolve); })),
        loadBufferFromData: vi.fn(async () => ({ id: 1, duration: 1 })),
        unloadBuffer: vi.fn(), play: vi.fn((_buffer: AudioBufferHandle, _config: PlayConfig) => voice(++nextVoice)),
        suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
    } satisfies PlatformAudioBackend;
    return { backend, audio: new AudioAPI(backend) };
}
beforeEach(() => loads.clear());
async function finish(audio: AudioAPI, url: string, id: number) {
    loads.get(url)!({ id, duration: 1 });
    await vi.waitFor(() => expect(audio.getBufferHandle(url)?.id).toBe(id));
}

it.each(['old-first', 'new-first'] as const)('only starts the latest BGM request when loads finish %s', async order => {
    const { audio, backend } = create();
    audio.playBGM('old.wav');
    audio.playBGM('new.wav');
    if (order === 'old-first') { await finish(audio, 'old.wav', 1); await finish(audio, 'new.wav', 2); }
    else { await finish(audio, 'new.wav', 2); await finish(audio, 'old.wav', 1); }
    expect(backend.play).toHaveBeenCalledTimes(1);
    expect(backend.play).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), expect.objectContaining({ bus: 'music' }));
});

it.each(['stopBGM', 'stopAll'] as const)('%s cancels a BGM request before it has a voice', async stop => {
    const { audio, backend } = create();
    audio.playBGM('pending.wav');
    audio[stop]();
    await finish(audio, 'pending.wav', 1);
    expect(backend.play).not.toHaveBeenCalled();
});

it('keeps a cached BGM ahead of an earlier pending request', async () => {
    const { audio, backend } = create();
    await audio.preloadFromData('ready.wav', new ArrayBuffer(8));
    audio.playBGM('pending.wav');
    audio.playBGM('ready.wav');
    await finish(audio, 'pending.wav', 9);
    expect(backend.play).toHaveBeenCalledTimes(1);
    expect(backend.play.mock.calls[0][0].id).toBe(1);
});

it.each([false, true])('an immediate stop ends outgoing BGM while repeated fade requests remain idempotent (repeat=%s)', async repeat => {
    const { audio, backend } = create();
    await audio.preloadFromData('ready.wav', new ArrayBuffer(8));
    audio.playBGM('ready.wav');
    const handle = backend.play.mock.results[0].value;
    audio.stopBGM(1);
    if (repeat) {
        audio.stopBGM(1);
        expect(handle.isPlaying).toBe(true);
    }
    audio.stopBGM();
    expect(handle.isPlaying).toBe(false);
    expect(handle.stop).toHaveBeenCalledOnce();
});
