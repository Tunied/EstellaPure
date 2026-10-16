// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({}), getResourceManager: () => null, evictTextureDimensions: vi.fn() }));
import { AudioAPI } from '../src/audio/Audio';
import type { AudioHandle, AudioBufferHandle, PlatformAudioBackend, PlayConfig } from '../src/audio/PlatformAudioBackend';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { SoundEventPlayback } from '../src/audio/SoundEventPlayback';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import type { MiniGameGlobal, MiniGameInnerAudioContext } from '../src/platform/minigame/api';
import type { Entity } from '../src/types';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function fixture(extra: Record<string, unknown> = {}, actualBackend?: PlatformAudioBackend) {
    let id = 0;
    const voices: Array<{ handle: AudioHandle; end(): void; config: PlayConfig }> = [];
    const backend = {
        name: 'counting', mixer: null, isReady: true, delivery: 'bytes' as const,
        initialize: vi.fn(async () => {}), ensureResumed: vi.fn(async () => {}),
        loadBuffer: vi.fn(async () => ({ id: ++id, bytes: 4, duration: 1 })),
        loadBufferFromData: vi.fn(async () => ({ id: ++id, bytes: 4, duration: 1 })), unloadBuffer: vi.fn(),
        suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
        play: vi.fn((_buffer: AudioBufferHandle, config: PlayConfig = {}): AudioHandle => {
            let playing = true, stopped = false;
            const handle: AudioHandle = { id: ++id, currentTime: 0, duration: 1,
                get isPlaying() { return playing; },
                stop: vi.fn(() => { playing = false; stopped = true; }), pause: vi.fn(() => { playing = false; }),
                resume: vi.fn(() => { if (!stopped) playing = true; }), setVolume: vi.fn(), setPan: vi.fn(),
                setLoop: vi.fn(), setPlaybackRate: vi.fn(),
            };
            voices.push({ handle, config, end() { playing = false; handle.onEnd?.(); } }); return handle;
        }),
    } satisfies PlatformAudioBackend;
    const audio = new AudioAPI(actualBackend ?? backend); audio.setBufferBudget(0);
    let document: Record<string, unknown> = { version: 1, mode: 'sequence', clips: [{ clip: 'a.wav' }, { clip: 'b.wav' }], ...extra };
    const fetchText = vi.fn(async () => JSON.stringify(document));
    const fetchBinary = vi.fn(async () => new ArrayBuffer(4));
    const resources = Assets.create({ module: null, getAudio: () => audio, backend: { fetchText, fetchBinary,
        resolveUrl: (ref: string) => ref, setBaseUrl() {} } as unknown as Backend });
    const alive = new Set<Entity>(), positions = new Map<Entity, { x: number; y: number; z: number }>();
    const events = new SoundEventPlayback(audio, () => resources, owner => alive.has(owner), owner => positions.get(owner) ?? null);
    cleanup.push(() => { events.dispose(); resources.releaseAll(); audio.dispose(); });
    return { events, audio, backend, voices, resources, alive, positions, fetchText, fetchBinary,
        setDocument: (next: typeof document) => { document = next; } };
}

describe('event admission and owned playback', () => {
    it('loads definitions without fetching clips and releases its definition on emitter disposal', async () => {
        const { events, fetchBinary } = fixture(); const emitter = (await events.load('steps.esaudioevent', { seed: 1 }))!;
        expect(fetchBinary).not.toHaveBeenCalled(); expect(events.getStats().emitters).toBe(1);
        emitter.dispose(); emitter.dispose(); expect(events.getStats()).toMatchObject({ definitions: 0, emitters: 0, active: 0 });
        expect(emitter.trigger().reason).toBe('disposed');
    });

    it('holds one event slot through loading and pause, then frees it on natural completion', async () => {
        const { events, fetchBinary, voices, audio } = fixture({ maxInstances: 1 });
        const load = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(load.promise);
        const emitter = (await events.load('steps.esaudioevent'))!, first = emitter.trigger(); first.pause();
        expect(emitter.trigger().reason).toBe('event-limit'); expect(events.getStats().pendingClips).toBe(1);
        load.resolve(new ArrayBuffer(4)); expect(await first.ready).toBe('paused');
        expect(emitter.trigger().reason).toBe('event-limit'); first.resume(); expect(first.status).toBe('playing');
        const ended = vi.fn(); first.onEnd = ended; voices[0].end();
        expect(first.status).toBe('ended'); expect(ended).toHaveBeenCalledOnce();
        expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(await emitter.trigger().ready).toBe('playing');
    });

    it('shares event limits and cooldown across emitters without advancing rejected choices', async () => {
        const { events, backend } = fixture({ maxInstances: 1, cooldown: .5 });
        const a = (await events.load('steps.esaudioevent', { seed: 4 }))!, b = (await events.load('steps.esaudioevent', { seed: 4 }))!;
        const first = a.trigger(); await first.ready;
        expect(b.trigger().reason).toBe('cooldown'); first.stop(); expect(a.trigger().reason).toBe('cooldown');
        events.update(.5); const second = a.trigger(); expect(second.selection?.clip).toBe('b.wav'); await second.ready;
        events.update(.5); expect(b.trigger().reason).toBe('event-limit'); expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('uses global priority admission and releases clips after refusal or stealing a paused voice', async () => {
        const { events, audio, backend } = fixture({ maxInstances: 1, priority: 2 }); audio.setMaxVoices(1);
        const buffer = { id: 900, duration: 1 }; const high = audio.playBuffer(buffer, { priority: 9 });
        const emitter = (await events.load('steps.esaudioevent'))!;
        const rejected = emitter.trigger(); expect(await rejected.ready).toBe('rejected'); expect(rejected.reason).toBe('global-limit');
        expect(events.getStats().active).toBe(0); high.stop();
        const first = emitter.trigger(); await first.ready; first.pause();
        audio.playBuffer(buffer, { priority: 9 }); expect(first.status).toBe('stopped');
        expect(events.getStats().active).toBe(0); expect(backend.play).toHaveBeenCalledTimes(3);
    });

    it('cancels pending clips synchronously on Audio.stopAll and cannot resume them later', async () => {
        const { events, audio, fetchBinary, backend } = fixture({ maxInstances: 1 });
        const load = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(load.promise);
        const emitter = (await events.load('steps.esaudioevent'))!, pending = emitter.trigger();
        audio.stopAll(); expect(await pending.ready).toBe('stopped'); expect(events.getStats().active).toBe(0);
        pending.resume(); load.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).not.toHaveBeenCalled(); expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(await emitter.trigger().ready).toBe('playing');
    });

    it('cancels owner definition and clip loads and returns every late lease', async () => {
        const { events, fetchText, fetchBinary, alive, backend } = fixture(); const owner = 123 as Entity; alive.add(owner);
        const definition = deferred<string>(); fetchText.mockReturnValueOnce(definition.promise);
        const loading = events.load('steps.esaudioevent', { owner }); events.stopOwner(owner); alive.delete(owner);
        definition.resolve(JSON.stringify({ version: 1, clips: [] })); expect(await loading).toBeNull();
        alive.add(owner); const emitter = (await events.load('other.esaudioevent', { owner }))!;
        const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValueOnce(clip.promise);
        const pending = emitter.trigger(); events.stopOwner(owner); expect(await pending.ready).toBe('stopped');
        clip.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).not.toHaveBeenCalled(); expect(events.getStats()).toMatchObject({ definitions: 0, emitters: 0, active: 0 });
    });

    it('reports a missing selected resource by event, slot and clip without leaking an event slot', async () => {
        const { events, fetchBinary } = fixture({ clips: [{ clip: 'missing.wav' }], maxInstances: 1 });
        fetchBinary.mockRejectedValue(new Error('404'));
        const emitter = (await events.load('steps.esaudioevent'))!, request = emitter.trigger();
        expect(await request.ready).toBe('rejected'); expect(request.reason).toBe('load-failed');
        expect(request.error).toContain('steps.esaudioevent: clips[0].clip (missing.wav)');
        expect(events.getStats()).toMatchObject({ active: 0, played: 0, rejected: 1, reasons: { 'load-failed': 1 } });
    });

    it('applies bus gain and sampled rates through the existing AudioAPI', async () => {
        const { events, audio, voices } = fixture({ bus: 'ui', volume: [.4, .4], playbackRate: [1.3, 1.3], priority: 7 });
        audio.setUIVolume(.5); const emitter = (await events.load('click.esaudioevent'))!, request = emitter.trigger();
        await request.ready; expect(voices[0].config).toMatchObject({ bus: 'ui', playbackRate: 1.3, priority: 7, volume: 0 });
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.2);
        request.setVolume(.8); expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.4);
    });

    it('updates spatial attenuation from the owning entity and refuses absent world positions', async () => {
        const { events, alive, positions, voices } = fixture({ spatial: { model: 1, refDistance: 10, maxDistance: 1000, rolloff: 1 } });
        const owner = 9 as Entity; alive.add(owner); positions.set(owner, { x: 20, y: 0, z: 0 });
        const unowned = (await events.load('space.esaudioevent'))!; expect(unowned.trigger().reason).toBe('missing-position');
        const emitter = (await events.load('space.esaudioevent', { owner }))!; await emitter.trigger().ready;
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.5);
        positions.set(owner, { x: 40, y: 0, z: 0 }); events.update(.1);
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.25);
        alive.delete(owner); events.update(.1); expect(emitter.disposed).toBe(true);
        expect(events.getStats().active).toBe(0);
    });

    it.each([{ clips: [] }, { clips: [{ clip: 'a.wav', weight: 0 }] }])('does no clip IO for unavailable pools %j', async ({ clips }) => {
        const { events, fetchBinary } = fixture({ clips }); const emitter = (await events.load('empty.esaudioevent'))!;
        expect(await emitter.trigger().ready).toBe('rejected'); expect(fetchBinary).not.toHaveBeenCalled();
        expect(events.getStats().active).toBe(0);
    });

    it('does not resurrect a voice when Stop All runs synchronously inside backend play', async () => {
        const { events, backend, audio, voices } = fixture(); const play = backend.play.getMockImplementation()!;
        backend.play.mockImplementation((buffer, config) => { const handle = play(buffer, config); audio.stopAll(); return handle; });
        const emitter = (await events.load('steps.esaudioevent'))!, request = emitter.trigger();
        expect(await request.ready).toBe('stopped'); await new Promise(done => setTimeout(done, 0));
        expect(voices[0].handle.isPlaying).toBe(false); expect(events.getStats().active).toBe(0);
    });

    it('shares admission across hot-reloaded generations while each emitter keeps its own definition', async () => {
        const { events, resources, setDocument } = fixture({ maxInstances: 1 });
        const old = (await events.load('steps.esaudioevent'))!, first = old.trigger(); await first.ready;
        setDocument({ version: 1, clips: [{ clip: 'new.wav' }], maxInstances: 1 }); resources.invalidate('steps.esaudioevent');
        const next = (await events.load('steps.esaudioevent'))!;
        expect(events.getStats().definitions).toBe(1); expect(next.trigger().reason).toBe('event-limit');
        first.stop(); const changed = next.trigger(); expect(changed.selection?.clip).toBe('new.wav'); await changed.ready;
        old.dispose(); expect(events.getStats().active).toBe(1); next.dispose(); expect(events.getStats().definitions).toBe(0);
    });

    it('drains every receipt and count even if one release fails', async () => {
        const { events, resources, audio } = fixture();
        const acquire = resources.acquireTyped.bind(resources);
        resources.acquireTyped = async <T>(type: string, ref: string) => {
            const lease = await acquire<T>(type, ref);
            return type !== 'audio' ? lease : { ...lease, release() { lease.release(); throw new Error('release failed'); } };
        };
        const emitter = (await events.load('steps.esaudioevent'))!;
        await Promise.all([emitter.trigger().ready, emitter.trigger().ready]);
        expect(() => events.stopAll()).toThrow('release failed');
        expect(events.getStats().active).toBe(0); expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('withdraws all event ownership when a backend stop throws', async () => {
        const { events, voices, audio } = fixture(); const emitter = (await events.load('steps.esaudioevent'))!;
        const requests = [emitter.trigger(), emitter.trigger()]; await Promise.all(requests.map(request => request.ready));
        vi.mocked(voices[0].handle.stop).mockImplementation(() => { throw new Error('stop failed'); });
        expect(() => audio.stopAll()).toThrow('stop failed');
        expect(requests.map(request => request.status)).toEqual(['stopped', 'stopped']);
        expect(voices[1].handle.isPlaying).toBe(false); expect(events.getStats().active).toBe(0);
        expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('cancels a dense pending burst without starting late audio or retaining decoded buffers', async () => {
        const { events, fetchBinary, backend, audio } = fixture(); const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(clip.promise);
        const emitter = (await events.load('steps.esaudioevent'))!;
        for (let i = 0; i < 512; ++i) emitter.trigger();
        await new Promise(done => setTimeout(done, 0));
        expect(events.getStats()).toMatchObject({ active: 512, pendingClips: 512 }); expect(fetchBinary).toHaveBeenCalledTimes(2);
        events.stopAll(); clip.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(events.getStats()).toMatchObject({ active: 0, pendingClips: 0, stopped: 512 });
        expect(backend.play).not.toHaveBeenCalled(); expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('uses real minigame streaming and rate controls without fetching PCM bytes', async () => {
        let ended: (() => void) | undefined, paused = true;
        const context = { src: '', loop: false, volume: 1, playbackRate: 1, startTime: 0, obeyMuteSwitch: true,
            get paused() { return paused; }, duration: 1, currentTime: 0,
            play() { paused = false; }, pause() { paused = true; }, stop() { paused = true; },
            destroy: vi.fn(), onEnded(callback: () => void) { ended = callback; }, onError() {},
        } satisfies MiniGameInnerAudioContext;
        const actual = new MiniGameAudioBackend({ createInnerAudioContext: () => context } as unknown as MiniGameGlobal);
        const { events, fetchBinary, audio } = fixture({ volume: [.4, .4], playbackRate: [1.25, 1.25], maxInstances: 1 }, actual);
        const emitter = (await events.load('steps.esaudioevent', { seed: 5 }))!, request = emitter.trigger();
        expect(await request.ready).toBe('playing'); expect(context.src).toBe('a.wav');
        expect(context.playbackRate).toBe(1.25); expect(context.volume).toBe(.4); expect(fetchBinary).not.toHaveBeenCalled();
        audio.suspend(); events.update(.1); expect(emitter.trigger().reason).toBe('event-limit');
        audio.resume(); expect(request.isPlaying).toBe(true);
        paused = true; ended?.(); expect(request.status).toBe('ended'); expect(events.getStats().active).toBe(0);
    });
});
