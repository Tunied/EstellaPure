// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-residency.test.ts
 * @brief   AudioAPI buffer residency: the audio mirror of the texture pool's
 *          held → evictable → evicted lifecycle. Retain/release, byte-budgeted
 *          LRU eviction (with access refreshing recency), hot-reload
 *          invalidation, and the memory-pressure trim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from '../src/audio/PlatformAudioBackend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}), getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

interface MockBackend extends PlatformAudioBackend {
    loads: string[];
    unloaded: number[];
}

function createMockBackend(bytesPerBuffer = 100): MockBackend {
    let nextId = 0;
    const playHandle: AudioHandle = {
        id: 0,
        stop() {}, pause() {}, resume() {},
        setVolume() {}, setPan() {}, setLoop() {}, setPlaybackRate() {},
        isPlaying: false, currentTime: 0, duration: 1,
    };
    const backend: MockBackend = {
        name: 'mock',
        delivery: 'bytes',
        mixer: null,
        isReady: true,
        loads: [],
        unloaded: [],
        initialize: async () => {},
        ensureResumed: async () => {},
        loadBuffer: async (url: string): Promise<AudioBufferHandle> => {
            backend.loads.push(url);
            return { id: ++nextId, duration: 1, bytes: bytesPerBuffer };
        },
        loadBufferFromData: async (url: string): Promise<AudioBufferHandle> => {
            backend.loads.push(url);
            return { id: ++nextId, duration: 1, bytes: bytesPerBuffer };
        },
        unloadBuffer: (handle: AudioBufferHandle) => { backend.unloaded.push(handle.id); },
        play: () => playHandle,
        suspend() {}, resume() {}, dispose() {},
    };
    return backend;
}

vi.mock('../src/platform', () => ({
    platformCreateCanvas: vi.fn(),
    platformCreateImage: vi.fn(),
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));

describe('AudioAPI buffer residency', () => {
    let backend: MockBackend;
    let audio: AudioAPI;

    beforeEach(() => {
        backend = createMockBackend();
        audio = new AudioAPI(backend);
        audio.setBufferBudget(1000);
    });

    it.each([0, 1000])('releasing an old asset lease cannot release the replacement clip, budget=%i', async budget => {
        audio.setBufferBudget(budget);
        const assets = Assets.create({
            module: null,
            getAudio: () => audio,
            backend: {
                fetchBinary: async () => new ArrayBuffer(8),
                fetchText: async () => '{}',
                resolveUrl: (path: string) => path,
            } as Backend,
        });
        const old = await assets.acquireTyped('audio', 'edited.wav');
        const before = audio.getBufferHandle('edited.wav');
        expect(assets.invalidate('edited.wav')).toBe(true);
        const current = await assets.acquireTyped('audio', 'edited.wav');
        const replacement = audio.getBufferHandle('edited.wav');
        expect(replacement).toBeDefined();
        expect(replacement).not.toBe(before);
        old.release();
        expect(audio.getBufferHandle('edited.wav')).toBe(replacement);
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 1, evictableCount: 0 });
        expect(audio.trimBufferCache()).toBe(0);
        current.release();
        audio.trimBufferCache();
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 0, bufferBytes: 0 });
    });

    it('releases a lease on its original device when the audio provider changes', async () => {
        audio.setBufferBudget(0);
        const original = audio;
        const assets = Assets.create({
            module: null, getAudio: () => audio,
            backend: { fetchBinary: async () => new ArrayBuffer(8), fetchText: async () => '{}',
                resolveUrl: (path: string) => path } as Backend,
        });
        const old = await assets.acquireTyped('audio', 'edited.wav');
        audio = new AudioAPI(createMockBackend());
        audio.setBufferBudget(0);
        assets.invalidate('edited.wav');
        const current = await assets.acquireTyped('audio', 'edited.wav');
        const replacement = audio.getBufferHandle('edited.wav');
        old.release();
        expect(original.getBufferStats().bufferCount).toBe(0);
        expect(audio.getBufferHandle('edited.wav')).toBe(replacement);
        current.release();
        expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('preload lands in the warm cache (evictable), playable immediately', async () => {
        await audio.preload('sfx/a.mp3');
        expect(audio.getBufferStats()).toMatchObject({
            bufferCount: 1, bufferBytes: 100, evictableCount: 1,
        });
        expect(audio.getBufferHandle('sfx/a.mp3')).toBeDefined();
    });

    it('retain pins, release returns to the warm cache, revive skips the backend', async () => {
        await audio.preload('sfx/a.mp3');
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(true);
        expect(audio.getBufferStats().evictableCount).toBe(0);

        audio.releaseBuffer('sfx/a.mp3');
        expect(audio.getBufferStats().evictableCount).toBe(1);
        expect(backend.unloaded).toEqual([]);           // retained, not freed

        expect(audio.retainBuffer('sfx/a.mp3')).toBe(true);   // revive
        expect(backend.loads).toHaveLength(1);          // no second decode
    });

    it('budget 0 frees at release instead of caching', async () => {
        audio.setBufferBudget(0);
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        audio.releaseBuffer('sfx/a.mp3');
        expect(backend.unloaded).toHaveLength(1);
        expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(false);
    });

    it('evicts oldest warm-cache entries past the budget; access refreshes recency', async () => {
        audio.setBufferBudget(250);
        await audio.preload('sfx/a.mp3');
        await audio.preload('sfx/b.mp3');
        audio.getBufferHandle('sfx/a.mp3');   // touch a → b is now oldest

        await audio.preload('sfx/c.mp3');     // 300 > 250 → evict b
        expect(audio.getBufferHandle('sfx/b.mp3')).toBeUndefined();
        expect(audio.getBufferHandle('sfx/a.mp3')).toBeDefined();
        expect(audio.getBufferHandle('sfx/c.mp3')).toBeDefined();
        expect(audio.getBufferStats().bufferBytes).toBe(200);
    });

    it('never evicts held buffers, even far over budget', async () => {
        audio.setBufferBudget(50);
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        await audio.preload('sfx/b.mp3');
        audio.retainBuffer('sfx/b.mp3');
        expect(audio.getBufferStats().bufferBytes).toBe(200);
        expect(backend.unloaded).toEqual([]);
    });

    it('invalidate drops even a held buffer so stale bytes are never served', async () => {
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        expect(audio.invalidateBuffer('sfx/a.mp3')).toBe(true);
        expect(backend.unloaded).toHaveLength(1);
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(false);
        expect(audio.invalidateBuffer('sfx/a.mp3')).toBe(false);
    });

    it('trimBufferCache frees only the warm cache and lets it refill', async () => {
        await audio.preload('sfx/held.mp3');
        audio.retainBuffer('sfx/held.mp3');
        await audio.preload('sfx/warm1.mp3');
        await audio.preload('sfx/warm2.mp3');

        expect(audio.trimBufferCache()).toBe(2);
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 1, evictableCount: 0 });

        audio.releaseBuffer('sfx/held.mp3');   // cache refills after the trim
        expect(audio.getBufferStats().evictableCount).toBe(1);
    });
});
