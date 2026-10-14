// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { TrainingSession, type TrainingAds } from '../../examples/mobile-controls/src/pokiTraining';

function harness() {
    const events: string[] = [];
    const ads: TrainingAds = { available: true,
        showRewarded: async () => { events.push('rewarded'); return { completed: true }; },
        showInterstitial: async () => { events.push('commercial'); },
    };
    const session = new TrainingSession(ads, {
        gameplayStart: () => events.push('start'), gameplayStop: () => events.push('stop'),
        reset: () => events.push('reset'), changed: () => {},
    });
    return { session, ads, events };
}

describe('authored Poki training flow', () => {
    it('routes both ad types through the selected Web channel', async () => {
        const ids: string[] = [];
        const session = new TrainingSession({ available: true,
            showRewarded: async id => { ids.push(id); return { completed: true }; },
            showInterstitial: async id => { ids.push(id); },
        }, { gameplayStart() {}, gameplayStop() {}, reset() {}, changed() {} }, 'crazygames');
        await session.begin(); session.pause(); await session.begin(); await session.reward();
        expect(ids).toEqual(['crazygames', 'crazygames']);
    });
    it('menu hits and construction emit no gameplay; first intent starts once', async () => {
        const { session, events } = harness(); session.hit(); session.hit();
        expect(session.hits).toBe(0); expect(events).toEqual([]);
        await session.begin(); await session.begin();
        expect(events).toEqual(['start']);
    });
    it('pause is idempotent and resume signals a commercial before gameplay', async () => {
        const { session, events } = harness(); await session.begin(); session.pause(); session.pause(); session.hit();
        expect(session.hits).toBe(0); await session.begin();
        expect(events).toEqual(['start', 'stop', 'commercial', 'start']);
    });
    it('three actual hits finish once and explicit replay resets after the break', async () => {
        const { session, events } = harness(); await session.begin();
        session.hit(); session.hit(); session.hit(); session.hit();
        expect(session.phase).toBe('finished'); expect(session.hits).toBe(3);
        await session.begin(); expect(session.hits).toBe(0);
        expect(events).toEqual(['start', 'stop', 'commercial', 'reset', 'start']);
    });
    for (const outcome of ['success', 'abandoned', 'error'] as const) {
        it(`restores playing after a ${outcome} rewarded break; rewards only completion`, async () => {
            const { session, ads, events } = harness();
            ads.showRewarded = async () => { events.push('rewarded'); if (outcome === 'error') throw new Error('no fill'); return { completed: outcome === 'success' }; };
            await session.begin(); await session.reward();
            expect(session.phase).toBe('playing'); expect(session.credits).toBe(outcome === 'success' ? 1 : 0);
            expect(events).toEqual(['start', 'stop', 'rewarded', 'start']);
        });
    }
    it('a menu reward emits no gameplay start/stop', async () => {
        const { session, events } = harness(); await session.reward();
        expect(events).toEqual(['rewarded']); expect(session.phase).toBe('menu'); expect(session.credits).toBe(1);
    });
    it('paused/finished rewards preserve their game state', async () => {
        const { session, events } = harness(); await session.begin(); session.pause(); await session.reward();
        expect(session.phase).toBe('paused'); expect(events).toEqual(['start', 'stop', 'rewarded']);
        await session.begin(); session.hit(); session.hit(); session.hit(); const before = events.length;
        await session.reward(); expect(session.phase).toBe('finished'); expect(events.slice(before)).toEqual(['rewarded']);
    });
    it('ignores overlapping actions and hits while an ad is pending', async () => {
        const { session, ads, events } = harness(); let close!: (result: { completed: boolean }) => void;
        ads.showRewarded = () => { events.push('rewarded'); return new Promise(resolve => { close = resolve; }); };
        await session.begin(); const pending = session.reward();
        await session.reward(); await session.begin(); session.pause(); session.hit();
        expect(session.phase).toBe('ad'); expect(events).toEqual(['start', 'stop', 'rewarded']); expect(session.hits).toBe(0);
        close({ completed: true }); await pending; expect(events).toEqual(['start', 'stop', 'rewarded', 'start']);
    });
    it('hidden gameplay stops once and foreground requires a new resume intent', async () => {
        const { session, events } = harness(); await session.begin(); session.visibility(true); session.visibility(true);
        await session.begin(); expect(events).toEqual(['start', 'stop']);
        session.visibility(false); expect(session.phase).toBe('paused'); expect(events).toEqual(['start', 'stop']);
        await session.begin(); expect(events).toEqual(['start', 'stop', 'commercial', 'start']);
    });
    it('a rewarded completion in the background grants the reward without restarting gameplay', async () => {
        const { session, ads, events } = harness(); let close!: (result: { completed: boolean }) => void;
        ads.showRewarded = () => { events.push('rewarded'); return new Promise(resolve => { close = resolve; }); };
        await session.begin(); const pending = session.reward(); session.visibility(true); close({ completed: true }); await pending;
        expect(session.credits).toBe(1); expect(session.phase).toBe('paused'); expect(events).toEqual(['start', 'stop', 'rewarded']);
    });
    it('a commercial completion in the background waits for player intent', async () => {
        const { session, ads, events } = harness(); let close!: () => void;
        ads.showInterstitial = () => { events.push('commercial'); return new Promise(resolve => { close = resolve; }); };
        await session.begin(); session.pause(); const pending = session.begin(); session.visibility(true); close(); await pending;
        expect(session.phase).toBe('paused'); expect(events).toEqual(['start', 'stop', 'commercial']);
    });
    it('missing ads never prevent gameplay and never grant a reward', async () => {
        const { session, ads, events } = harness(); Object.defineProperty(ads, 'available', { value: false });
        await session.begin(); session.pause(); await session.begin(); await session.reward();
        expect(session.phase).toBe('playing'); expect(session.credits).toBe(0); expect(events).toEqual(['start', 'stop', 'start']);
    });
    it('commercial rejection resumes gameplay without leaving an ad phase', async () => {
        const { session, ads, events } = harness(); ads.showInterstitial = async () => { events.push('commercial'); throw new Error('no fill'); };
        await session.begin(); session.pause(); await session.begin();
        expect(session.phase).toBe('playing'); expect(events).toEqual(['start', 'stop', 'commercial', 'start']);
    });
});


describe('Poki training scene lifetime', () => {
    it('scene cleanup stops playing once and rejects later actions', async () => {
        const { session, events } = harness(); await session.begin();
        session.dispose(); session.dispose(); await session.begin(); await session.reward(); session.hit();
        expect(events).toEqual(['start', 'stop']); expect(session.credits).toBe(0);
    });
    it('a reward finishing after scene cleanup cannot restart gameplay or mutate credits', async () => {
        const { session, ads, events } = harness(); let close!: (result: { completed: boolean }) => void;
        ads.showRewarded = () => { events.push('rewarded'); return new Promise(resolve => { close = resolve; }); };
        await session.begin(); const pending = session.reward(); session.dispose(); close({ completed: true }); await pending;
        expect(events).toEqual(['start', 'stop', 'rewarded']); expect(session.credits).toBe(0);
    });
});
