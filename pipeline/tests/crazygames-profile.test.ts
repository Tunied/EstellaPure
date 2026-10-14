// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { crazyGamesAdProvider, crazyGamesStorage, initializeCrazyGames, CRAZYGAMES_STORAGE_KEY, type CrazyGamesSdk } from '../src/runtime/crazyGamesProfile';
import { parseManifest } from '../src/project/format';
import { projectExportOptions } from '../src/export/projectExportOptions';

function fixture() {
    const values = new Map<string, string>();
    const callbacks: Array<Parameters<CrazyGamesSdk['ad']['requestAd']>[1]> = [];
    const listeners = new Set<(settings: { muteAudio?: boolean }) => void>();
    const sdk: CrazyGamesSdk = {
        init: vi.fn(async () => {}),
        ad: { requestAd: vi.fn((_type, callback) => { callbacks.push(callback); }) },
        data: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
        game: { loadingStart: vi.fn(), loadingStop: vi.fn(), settings: { muteAudio: true },
            addSettingsChangeListener: listener => { listeners.add(listener); }, removeSettingsChangeListener: listener => { listeners.delete(listener); } },
    };
    return { sdk, values, callbacks, listeners };
}

describe('CrazyGames channel adapter', () => {
    it('preserves the named Web channel and rejects misspellings', async () => {
        const manifest = parseManifest({ name: 'Game', packaging: { profiles: { cg: { platform: 'web', platforms: { web: { channel: 'crazygames' } } } } } });
        expect((await projectExportOptions(process.cwd(), manifest, 'web', 'cg')).webChannel).toBe('crazygames');
        expect(() => parseManifest({ name: 'Game', packaging: { platforms: { web: { channel: 'crazygams' } } } })).toThrow('web.channel');
    });
    it('initializes before loading events, then reports loading stop once', async () => {
        const { sdk } = fixture(); const session = await initializeCrazyGames(sdk, vi.fn());
        expect(sdk.init).toHaveBeenCalledTimes(1); expect(sdk.game.loadingStart).toHaveBeenCalledTimes(1);
        expect(sdk.game.loadingStop).not.toHaveBeenCalled(); session.loaded(); session.loaded();
        expect(sdk.game.loadingStop).toHaveBeenCalledTimes(1); expect(session.provider).not.toBeNull();
    });
    it('SDK failure exposes neither ads nor a local-save fallback', async () => {
        const { sdk } = fixture(); sdk.init = async () => { throw new Error('blocked'); };
        const session = await initializeCrazyGames(sdk, vi.fn());
        expect(session.provider).toBeNull(); expect(() => session.storage.setStorageItem('save', '1')).toThrow('unavailable');
        session.loaded(); expect(sdk.game.loadingStart).not.toHaveBeenCalled(); expect(sdk.game.loadingStop).not.toHaveBeenCalled();
    });
    it('times out without activating a provider on late SDK initialization', async () => {
        vi.useFakeTimers();
        try {
            const { sdk } = fixture(); let finish!: () => void;
            sdk.init = () => new Promise<void>(resolve => { finish = resolve; });
            const pending = initializeCrazyGames(sdk, vi.fn(), 50); await vi.advanceTimersByTimeAsync(51);
            const session = await pending; finish(); await Promise.resolve();
            expect(session.provider).toBeNull(); expect(() => session.storage.getStorageItem('save')).toThrow('unavailable');
        } finally { vi.useRealTimers(); }
    });
    it('grants rewards only after adFinished and ignores repeated callbacks', async () => {
        const { sdk, callbacks } = fixture(); const ad = crazyGamesAdProvider(sdk).createRewardedAd('ignored');
        let finished = false; const showing = ad.show().then(result => { finished = true; return result; });
        expect(sdk.ad.requestAd).toHaveBeenCalledWith('rewarded', expect.any(Object));
        callbacks[0].adStarted(); await Promise.resolve(); expect(finished).toBe(false);
        callbacks[0].adFinished(); callbacks[0].adError(new Error('late')); callbacks[0].adFinished();
        expect(await showing).toEqual({ completed: true });
    });
    it('maps midgame completion and ad errors without inventing a reward', async () => {
        const { sdk, callbacks } = fixture(); const provider = crazyGamesAdProvider(sdk);
        const commercial = provider.createInterstitialAd('ignored').show(); callbacks[0].adFinished(); await commercial;
        expect(sdk.ad.requestAd).toHaveBeenCalledWith('midgame', expect.any(Object));
        const reward = provider.createRewardedAd('ignored').show(); const rejected = expect(reward).rejects.toThrow('failed');
        callbacks[1].adError({ code: 'no-fill' }); callbacks[1].adFinished(); await rejected;
    });
    it('preserves synchronous request errors and rejects destroyed units', async () => {
        const { sdk } = fixture(); sdk.ad.requestAd = () => { throw new Error('request rejected'); };
        const ad = crazyGamesAdProvider(sdk).createRewardedAd('ignored');
        await expect(ad.show()).rejects.toThrow('request rejected'); ad.destroy();
        await expect(ad.preload()).rejects.toThrow('destroyed'); await expect(ad.show()).rejects.toThrow('destroyed');
    });
    it('destroying an active unit does not prematurely end its takeover', async () => {
        const { sdk, callbacks } = fixture(); const ad = crazyGamesAdProvider(sdk).createInterstitialAd('ignored');
        let done = false; const pending = ad.show().then(() => { done = true; }); ad.destroy();
        await Promise.resolve(); expect(done).toBe(false); callbacks[0].adFinished(); await pending;
    });
    it('applies initial mute and removes the listener before allowing stale emissions', async () => {
        const { sdk, listeners } = fixture(); const session = await initializeCrazyGames(sdk, vi.fn());
        const muted: boolean[] = []; const off = session.onAudioMute(value => muted.push(value));
        const listener = [...listeners][0]; listener({ muteAudio: false }); off(); listener({ muteAudio: true });
        expect(muted).toEqual([true, false]); expect(listeners.size).toBe(0);
    });
});

describe('CrazyGames SDK data envelope', () => {
    it('persists strings, reads a fresh SDK state and never clears unrelated SDK data', () => {
        const { sdk, values } = fixture(); values.set('publisher.other', 'keep');
        const storage = crazyGamesStorage(sdk.data); storage.setStorageItem('esengine:score', '42'); storage.setStorageItem('asset-cache', 'keep');
        expect(crazyGamesStorage(sdk.data).getStorageItem('esengine:score')).toBe('42');
        storage.clearStorage('esengine:'); expect(storage.getStorageItem('esengine:score')).toBeNull();
        expect(storage.getStorageItem('asset-cache')).toBe('keep'); expect(values.get('publisher.other')).toBe('keep');
        storage.removeStorageItem('asset-cache'); expect(storage.getStorageItem('asset-cache')).toBeNull();
    });
    it('supports prototype-like keys without changing the object prototype', () => {
        const { sdk } = fixture(); const storage = crazyGamesStorage(sdk.data);
        storage.setStorageItem('__proto__', 'safe'); storage.setStorageItem('constructor', 'also safe');
        expect(storage.getStorageItem('__proto__')).toBe('safe'); expect(storage.getStorageItem('constructor')).toBe('also safe');
        expect(storage.getStorageItem('toString')).toBeNull();
    });
    for (const corrupt of ['bad JSON', '[]', '{"score":10}', 'null']) {
        it(`does not overwrite corrupt data: ${corrupt}`, () => {
            const { sdk, values } = fixture(); values.set(CRAZYGAMES_STORAGE_KEY, corrupt);
            expect(() => crazyGamesStorage(sdk.data).setStorageItem('score', '1')).toThrow();
            expect(values.get(CRAZYGAMES_STORAGE_KEY)).toBe(corrupt);
        });
    }
    it('rejects an oversized UTF-8 envelope before touching the SDK', () => {
        const { sdk, values } = fixture(); const storage = crazyGamesStorage(sdk.data); storage.setStorageItem('score', '1');
        const before = values.get(CRAZYGAMES_STORAGE_KEY);
        expect(() => storage.setStorageItem('large', '汉'.repeat(340000))).toThrow('1 MB');
        expect(values.get(CRAZYGAMES_STORAGE_KEY)).toBe(before);
    });
    it('surfaces disabled saving instead of silently writing localStorage', () => {
        const { sdk } = fixture(); sdk.data.setItem = () => { throw new Error('Progress Save disabled'); };
        expect(() => crazyGamesStorage(sdk.data).setStorageItem('save', '1')).toThrow('Progress Save disabled');
    });
});
