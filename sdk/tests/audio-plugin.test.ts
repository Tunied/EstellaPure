// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlugin, audioPlugin } from '../src/audio/AudioPlugin';
import { AudioAPI } from '../src/audio/Audio';
import type { AudioHandle, AudioBufferHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';
import type { AudioMixer } from '../src/audio/AudioMixer';
import type { AudioBus } from '../src/audio/AudioBus';

function createMockHandle(overrides: Partial<AudioHandle> = {}): AudioHandle {
    return {
        id: 1,
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        setVolume: vi.fn(),
        setPan: vi.fn(),
        setLoop: vi.fn(),
        setPlaybackRate: vi.fn(),
        isPlaying: true,
        currentTime: 0,
        duration: 1.0,
        ...overrides,
    };
}

function createMockBus(name: string): AudioBus {
    return {
        name,
        volume: 1.0,
        muted: false,
        node: {} as GainNode,
        connect: vi.fn(),
        addChild: vi.fn(),
    } as unknown as AudioBus;
}

function createMockBackend(): PlatformAudioBackend {
    const masterBus = createMockBus('master');
    const musicBus = createMockBus('music');
    const sfxBus = createMockBus('sfx');
    const mixer = {
        master: masterBus,
        music: musicBus,
        sfx: sfxBus,
        ui: createMockBus('ui'),
        voice: createMockBus('voice'),
        getBus: vi.fn((name: string) => {
            const map: Record<string, AudioBus> = { master: masterBus, music: musicBus, sfx: sfxBus };
            return map[name] ?? sfxBus;
        }),
        createBus: vi.fn(),
    } as unknown as AudioMixer;

    return {
        name: 'MockBackend',
        mixer,
        isReady: true,
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 2.0 }),
        unloadBuffer: vi.fn(),
        play: vi.fn().mockReturnValue(createMockHandle()),
        suspend: vi.fn(),
        resume: vi.fn(),
        dispose: vi.fn(),
    } as unknown as PlatformAudioBackend;
}

describe('AudioPlugin', () => {
    it('should be exported as singleton', () => {
        expect(audioPlugin).toBeInstanceOf(AudioPlugin);
    });

    it('should have name "audio"', () => {
        expect(audioPlugin.name).toBe('audio');
    });

    it('should have a build method', () => {
        expect(typeof audioPlugin.build).toBe('function');
    });

    it('should accept config options', () => {
        const plugin = new AudioPlugin({
            initialPoolSize: 32,
            masterVolume: 0.8,
            musicVolume: 0.5,
            sfxVolume: 0.9,
        });
        expect(plugin.name).toBe('audio');
    });

    it('stopping and cleaning up an unbuilt plugin remains safe', () => {
        const plugin = new AudioPlugin();
        expect(() => plugin.stopAllSources()).not.toThrow();
        expect(() => plugin.cleanup()).not.toThrow();
    });
});

describe('AudioAPI.stopAll', () => {
    let backend: PlatformAudioBackend;
    let audio: AudioAPI;

    beforeEach(() => {
        backend = createMockBackend();
        audio = new AudioAPI(backend, backend.mixer);
    });

    it('should stop BGM without disposing backend', async () => {
        await audio.preload('bgm.mp3');
        const bgmHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(bgmHandle);
        audio.playBGM('bgm.mp3');

        audio.stopAll();

        expect(bgmHandle.stop).toHaveBeenCalled();
        expect(backend.dispose).not.toHaveBeenCalled();
        expect(audio.getBufferHandle('bgm.mp3')).toBeDefined();
    });

    it('should allow playing new BGM after stopAll', async () => {
        await audio.preload('bgm.mp3');
        const firstHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(firstHandle);
        audio.playBGM('bgm.mp3');
        audio.stopAll();

        const secondHandle = createMockHandle();
        (backend.play as ReturnType<typeof vi.fn>).mockReturnValue(secondHandle);
        audio.playBGM('bgm.mp3');

        expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('should be safe to call when no audio is playing', () => {
        expect(() => audio.stopAll()).not.toThrow();
    });
});
