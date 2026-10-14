// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Platform services: the ads takeover ceremony.
 *
 * The contract under test is the part every game hand-rolls wrong: the game
 * clock pauses and the audio device suspends for exactly the span of the ad,
 * restored in EVERY exit path — and a game the developer paused before the ad
 * stays paused after it.
 */
import { describe, it, expect } from 'vitest';
import { AdsAPI, createMockAdProvider, type AdProvider } from '../src/services/ads';
import { createTakeover, type TakeoverHost } from '../src/services/takeover';

function recordingHost(): TakeoverHost & { events: string[]; paused: boolean } {
    const h = {
        events: [] as string[],
        paused: false,
        setPaused(p: boolean) { h.paused = p; h.events.push(p ? 'pause' : 'unpause'); },
        isPaused() { return h.paused; },
        suspendAudio() { h.events.push('audio-off'); },
        resumeAudio() { h.events.push('audio-on'); },
    };
    return h;
}

describe('AdsAPI takeover ceremony', () => {
    it('pauses the clock and suspends audio for exactly the span of the ad', async () => {
        const host = recordingHost();
        const ads = new AdsAPI(createTakeover(host));
        ads.setProvider(createMockAdProvider({ durationMs: 1 }));

        const r = await ads.showRewarded('unit-1');
        expect(r.completed).toBe(true);
        expect(host.events).toEqual(['pause', 'audio-off', 'audio-on', 'unpause']);
        expect(host.paused).toBe(false);
        expect(ads.showing).toBe(false);
    });

    it('restores state when the ad errors (no fill twice)', async () => {
        const host = recordingHost();
        const ads = new AdsAPI(createTakeover(host));
        const failing: AdProvider = {
            createRewardedAd: () => ({
                preload: () => Promise.reject(new Error('no fill')),
                show: () => Promise.reject(new Error('no fill')),
                destroy: () => {},
            }),
            createInterstitialAd: () => { throw new Error('unused'); },
        };
        ads.setProvider(failing);

        await expect(ads.showRewarded('unit-1')).rejects.toThrow('no fill');
        expect(host.events).toEqual(['pause', 'audio-off', 'audio-on', 'unpause']);
        expect(host.paused).toBe(false);
        expect(ads.showing).toBe(false);
    });

    it('a game the developer paused stays paused after the ad', async () => {
        const host = recordingHost();
        host.paused = true;
        const ads = new AdsAPI(createTakeover(host));
        ads.setProvider(createMockAdProvider({ durationMs: 1 }));

        await ads.showRewarded('unit-1');
        // The ceremony restored what it found: no pause/unpause events at all.
        expect(host.events).toEqual(['audio-off', 'audio-on']);
        expect(host.paused).toBe(true);
    });

    it('reports an abandoned video as not completed', async () => {
        const ads = new AdsAPI(createTakeover(recordingHost()));
        ads.setProvider(createMockAdProvider({ durationMs: 1, completed: false }));
        const r = await ads.showRewarded('unit-1');
        expect(r.completed).toBe(false);
    });

    it('rejects loud when no ad source exists, and says how to get one', async () => {
        const ads = new AdsAPI(createTakeover(recordingHost()));
        expect(ads.available).toBe(false);
        await expect(ads.showRewarded('unit-1')).rejects.toThrow(/no ad source/);
    });

    it('caches units per id and drops them when the provider changes', async () => {
        let created = 0;
        const counting: AdProvider = {
            createRewardedAd: () => {
                created++;
                return { preload: () => Promise.resolve(), show: async () => ({ completed: true }), destroy: () => {} };
            },
            createInterstitialAd: () => { throw new Error('unused'); },
        };
        const ads = new AdsAPI(createTakeover(recordingHost()));
        ads.setProvider(counting);
        await ads.showRewarded('a');
        await ads.showRewarded('a');
        expect(created).toBe(1);
        ads.setProvider(counting);
        await ads.showRewarded('a');
        expect(created).toBe(2);
    });
});


describe('AdsAPI overlapping requests', () => {
    for (const first of ['rewarded', 'interstitial'] as const) {
        it(`keeps the active ${first} and rejects both competing formats without creating units`, async () => {
            const host = recordingHost();
            const ads = new AdsAPI(createTakeover(host));
            let finish!: () => void;
            let created = 0;
            const pending = new Promise<void>((resolve) => { finish = resolve; });
            ads.setProvider({
                createRewardedAd: () => {
                    created++;
                    return { preload: async () => {}, show: async () => { await pending; return { completed: true }; }, destroy() {} };
                },
                createInterstitialAd: () => {
                    created++;
                    return { preload: async () => {}, show: () => pending, destroy() {} };
                },
            });
            const active = first === 'rewarded' ? ads.showRewarded('first') : ads.showInterstitial('first');
            await expect(ads.showRewarded('other')).rejects.toThrow('already showing');
            await expect(ads.showInterstitial('other')).rejects.toThrow('already showing');
            expect(created).toBe(1);
            expect(ads.showing).toBe(true);
            expect(host.paused).toBe(true);
            expect(host.events).toEqual(['pause', 'audio-off']);
            finish();
            await active;
            expect(ads.showing).toBe(false);
            expect(host.events).toEqual(['pause', 'audio-off', 'audio-on', 'unpause']);
            await ads.showRewarded('other');
            expect(created).toBe(2);
        });
    }

    it('accepts another request after a rejected active ad closes', async () => {
        const host = recordingHost();
        const ads = new AdsAPI(createTakeover(host));
        let fail!: (reason: Error) => void;
        let attempts = 0;
        ads.setProvider({
            createRewardedAd: () => ({ preload: async () => {}, show: () => {
                if (++attempts === 1) return new Promise<{ completed: boolean }>((_, reject) => { fail = reject; });
                return Promise.resolve({ completed: true });
            }, destroy() {} }),
            createInterstitialAd: () => { throw new Error('must not create competing unit'); },
        });
        const active = ads.showRewarded('first');
        const rejected = expect(active).rejects.toThrow('no fill');
        await expect(ads.showInterstitial('other')).rejects.toThrow('already showing');
        fail(new Error('no fill'));
        await rejected;
        expect(ads.showing).toBe(false);
        expect(host.paused).toBe(false);
        expect((await ads.showRewarded('first')).completed).toBe(true);
    });
});
