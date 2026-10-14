// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { initializePoki, pokiAdProvider, type PokiSdk } from '../src/runtime/pokiProfile';
import { parseManifest } from '../src/project/format';
import { projectExportOptions, withExportProfile } from '../src/export/projectExportOptions';

const sdkOf = (): PokiSdk => ({ init: vi.fn(async () => {}), gameLoadingFinished: vi.fn(), rewardedBreak: vi.fn(async () => true), commercialBreak: vi.fn(async () => {}) });

describe('Poki Web channel', () => {
  it('preserves channel settings and named profile overrides for Web only', async () => {
    const manifest = parseManifest({ name: 'Game', packaging: { platforms: { web: { channel: 'poki' } }, profiles: { local: { platform: 'web', platforms: { web: { channel: 'standalone' } } } } } });
    expect((await projectExportOptions(process.cwd(), manifest, 'web')).webChannel).toBe('poki');
    expect((await projectExportOptions(process.cwd(), manifest, 'desktop')).webChannel).toBeUndefined();
    expect((await projectExportOptions(process.cwd(), manifest, 'web', 'local')).webChannel).toBeUndefined();
    expect(withExportProfile(manifest, 'local').packaging?.platforms?.web?.channel).toBe('standalone');
  });
  it('rejects misspelled channels rather than silently exporting standalone', () => {
    expect(() => parseManifest({ name: 'Game', packaging: { platforms: { web: { channel: 'pokki' } } } })).toThrow('web.channel');
  });
  it('initializes once and sends loading finished once, only when the caller is ready', async () => {
    const sdk = sdkOf(); const warn = vi.fn();
    const session = await initializePoki(sdk, warn);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.gameLoadingFinished).not.toHaveBeenCalled();
    expect(session.provider).not.toBeNull();
    session.loaded(); session.loaded();
    expect(sdk.gameLoadingFinished).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
  it('continues after blocked initialization without exposing an ad source', async () => {
    const sdk = sdkOf(); sdk.init = async () => { throw new Error('blocked'); };
    const warn = vi.fn(); const session = await initializePoki(sdk, warn);
    expect(session.provider).toBeNull(); session.loaded();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sdk.gameLoadingFinished).toHaveBeenCalledTimes(1);
  });
  it('continues when the SDK script is missing', async () => {
    const warn = vi.fn(); const session = await initializePoki(undefined, warn);
    expect(session.provider).toBeNull(); expect(warn).toHaveBeenCalledTimes(1);
    session.loaded();
  });
  it('bounds hanging initialization and ignores later resolution', async () => {
    vi.useFakeTimers();
    try {
      const sdk = sdkOf(); let done!: () => void;
      sdk.init = () => new Promise<void>((resolve) => { done = resolve; });
      const warn = vi.fn(); const pending = initializePoki(sdk, warn, 50);
      await vi.advanceTimersByTimeAsync(51);
      const session = await pending;
      expect(session.provider).toBeNull(); done(); await Promise.resolve();
      expect(session.provider).toBeNull(); expect(warn).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('keeps a loading notification error from stopping gameplay boot', async () => {
    const sdk = sdkOf(); sdk.gameLoadingFinished = () => { throw new Error('notification'); };
    const warn = vi.fn(); const session = await initializePoki(sdk, warn);
    expect(() => session.loaded()).not.toThrow(); expect(warn).toHaveBeenCalledTimes(1);
  });
  it('maps rewarded success and abandoned/no-fill results without inventing rewards', async () => {
    const sdk = sdkOf(); const provider = pokiAdProvider(sdk);
    expect(await provider.createRewardedAd('unused').show()).toEqual({ completed: true });
    sdk.rewardedBreak = async () => false;
    expect(await provider.createRewardedAd('unused').show()).toEqual({ completed: false });
    sdk.rewardedBreak = async () => { throw new Error('no fill'); };
    await expect(provider.createRewardedAd('unused').show()).rejects.toThrow('no fill');
  });
  it('retains the commercial promise until closing and rejects destroyed units', async () => {
    const sdk = sdkOf(); let close!: () => void;
    sdk.commercialBreak = () => new Promise<void>((resolve) => { close = resolve; });
    const ad = pokiAdProvider(sdk).createInterstitialAd('unused');
    let settled = false; const showing = ad.show().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); close(); await showing;
    ad.destroy(); await expect(ad.show()).rejects.toThrow('destroyed'); await expect(ad.preload()).rejects.toThrow('destroyed');
  });
});
