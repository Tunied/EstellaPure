// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { AudioHandle, PlatformAudioBackend } from '../src/audio/PlatformAudioBackend';
function setup() {
    const handles: AudioHandle[] = [];
    const backend = { name: 'Counting', mixer: null, isReady: true,
        play: vi.fn(() => {
            let playing = true, stopped = false;
            const h: AudioHandle = { id: handles.length + 1,
                stop: vi.fn(() => { playing = false; stopped = true; }),
                pause: vi.fn(() => { playing = false; }),
                resume: vi.fn(() => { if (!stopped) playing = true; }),
                setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
                get isPlaying() { return playing; }, currentTime: 0, duration: 1 };
            handles.push(h); return h;
        }), unloadBuffer: vi.fn(), dispose: vi.fn() } as unknown as PlatformAudioBackend;
    return { audio: new AudioAPI(backend, null), backend, handles };
}
const buffer = { id: 1, duration: 1 };
describe('paused voice ownership', () => {
    it('a paused voice remains inside its priority budget', () => {
        const { audio, backend } = setup(); audio.setMaxVoices(1);
        const h = audio.playBuffer(buffer, { priority: 9 }); h.pause();
        expect(audio.playBuffer(buffer, { priority: 1 }).isPlaying).toBe(false);
        expect(backend.play).toHaveBeenCalledTimes(1);
        h.resume(); expect(h.isPlaying).toBe(true);
    });
    it('paused voices receive bus changes and stay tracked after resume', () => {
        const { audio, handles } = setup();
        const h = audio.playBuffer(buffer, { volume: .8 }); h.pause();
        audio.setSFXVolume(.5); h.resume(); audio.setSFXVolume(.25);
        expect(handles[0]!.setVolume).toHaveBeenLastCalledWith(.2);
    });
    it('handle volume changes update base gain before later bus changes', () => {
        const { audio, handles } = setup();
        const h = audio.playBuffer(buffer, { volume: .8 }); h.setVolume(.2);
        audio.setSFXVolume(.5);
        expect(handles[0]!.setVolume).toHaveBeenLastCalledWith(.1);
    });
    it('disposing the API stops paused voices even after a bus update', () => {
        const { audio, handles } = setup();
        const h = audio.playBuffer(buffer); h.pause(); audio.setSFXVolume(.5); audio.dispose();
        expect(handles[0]!.stop).toHaveBeenCalled();
        h.resume(); expect(h.isPlaying).toBe(false);
    });
    it('a stolen paused voice cannot resume outside the voice budget', () => {
        const { audio, handles } = setup(); audio.setMaxVoices(1);
        const old = audio.playBuffer(buffer, { priority: 1 }); old.pause();
        const next = audio.playBuffer(buffer, { priority: 9 }); old.resume();
        vi.mocked(handles[0]!.setVolume).mockClear(); old.setVolume(.2);
        expect(handles[0]!.stop).toHaveBeenCalled();
        expect(handles[0]!.resume).not.toHaveBeenCalled(); expect(next.isPlaying).toBe(true);
        expect(handles[0]!.setVolume).not.toHaveBeenCalled();
    });
    it('BGM fades remain attached to the tracked voice and stop at completion', async () => {
        const { audio, backend, handles } = setup();
        backend.loadBuffer = vi.fn().mockResolvedValue(buffer); await audio.preload('music.wav');
        audio.playBGM('music.wav', { volume: .8, fadeIn: 1 }); audio.updateFades(.5);
        expect(handles[0]!.setVolume).toHaveBeenLastCalledWith(.4);
        audio.stopBGM(1); audio.updateFades(1);
        expect(handles[0]!.stop).toHaveBeenCalled();
        expect((audio as unknown as { fadingOut_: Set<AudioHandle> }).fadingOut_.size).toBe(0);
    });
    it('a stopped ramp does not write to an already released backend voice', async () => {
        const { audio, backend, handles } = setup();
        backend.loadBuffer = vi.fn().mockResolvedValue(buffer); await audio.preload('music.wav');
        audio.playBGM('music.wav', { fadeIn: 1 });
        handles[0]!.stop(); vi.mocked(handles[0]!.setVolume).mockClear(); audio.updateFades(.5);
        expect(handles[0]!.setVolume).not.toHaveBeenCalled();
    });
    it('mute and unmute affect a paused voice before it resumes', () => {
        const { audio, handles } = setup(); const h = audio.playBuffer(buffer, { volume: .8 });
        h.pause(); audio.muteBus('sfx', true);
        expect(handles[0]!.setVolume).toHaveBeenLastCalledWith(0);
        audio.muteBus('sfx', false); h.resume();
        expect(handles[0]!.setVolume).toHaveBeenLastCalledWith(.8);
    });
    it('managed handles preserve backend identity fields and completion callbacks', () => {
        const { audio, handles } = setup(); const h = audio.playBuffer(buffer), ended = vi.fn();
        h.onEnd = ended; handles[0]!.onEnd?.();
        expect(ended).toHaveBeenCalledTimes(1); expect(h.onEnd).toBe(ended);
        expect(h.id).toBe(handles[0]!.id); expect(h.duration).toBe(handles[0]!.duration);
    });
});
