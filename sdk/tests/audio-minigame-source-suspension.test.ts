// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import type { MiniGameGlobal, MiniGameInnerAudioContext } from '../src/platform/minigame/api';

const contexts: ReturnType<typeof context>[] = [];
function context() {
    const ctx = { src: '', startTime: 0, loop: false, volume: 1, playbackRate: 1, paused: true,
        currentTime: 0, duration: 1, obeyMuteSwitch: false, ended: () => {},
        play: vi.fn(() => { ctx.paused = false; }), pause: vi.fn(() => { ctx.paused = true; }),
        stop: vi.fn(() => { ctx.paused = true; }), destroy: vi.fn(() => { ctx.paused = true; }),
        onEnded: vi.fn((fn: () => void) => { ctx.ended = fn; }), onError: vi.fn() };
    return ctx;
}
vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateAudioBackend: () => new MiniGameAudioBackend({
        createInnerAudioContext: () => {
            const ctx = context(); contexts.push(ctx); return ctx as unknown as MiniGameInnerAudioContext;
        },
    } as unknown as MiniGameGlobal),
    platformOnMemoryWarning: () => () => {},
}));
const { App } = await import('../src/app/app');
const { AudioPlugin } = await import('../src/audio/AudioPlugin');
const { Audio } = await import('../src/audio/Audio');
const { AudioSource } = await import('../src/audio/AudioComponents');
const apps: ReturnType<typeof App.new>[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); contexts.length = 0; });
async function scene() {
    const app = App.new().addPlugin(new AudioPlugin()); apps.push(app);
    const audio = app.getResource(Audio); await audio.preload('loop.wav');
    const entity = app.world.spawn(); app.world.insert(entity, AudioSource, { clip: 'loop.wav', playing: true, volume: .8 });
    await app.tick(1 / 60); return { app, audio, entity };
}
it('ticks during device suspension retain source state, budget and bus ownership', async () => {
    const { app, audio, entity } = await scene(); audio.setMaxVoices(1); audio.suspend();
    for (let i = 0; i < 20; i++) await app.tick(1 / 60);
    expect(app.world.get(entity, AudioSource).playing).toBe(true);
    expect(app.world.get(entity, AudioSource).finished).toBe(false);
    audio.setSFXVolume(.5);
    expect(audio.playSFX('loop.wav', { priority: -1 })?.isPlaying).toBe(false);
    audio.resume(); await app.tick(1 / 60); audio.setSFXVolume(.25);
    expect(contexts).toHaveLength(1); expect(contexts[0].volume).toBeCloseTo(.2);
    expect(contexts[0].play).toHaveBeenCalledTimes(2);
    contexts[0].ended(); await app.tick(1 / 60);
    expect(app.world.get(entity, AudioSource).finished).toBe(true);
});
it('despawning a suspended source retires its context without automatic restart', async () => {
    const { app, audio, entity } = await scene(); const ctx = contexts[0];
    audio.suspend(); app.world.despawn(entity); audio.resume(); await app.tick(1 / 60);
    expect(ctx.stop).toHaveBeenCalledOnce(); expect(ctx.destroy).toHaveBeenCalledOnce();
    expect(ctx.play).toHaveBeenCalledOnce();
});
