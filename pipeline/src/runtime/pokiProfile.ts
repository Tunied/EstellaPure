// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AdProvider } from 'esengine';

/** Structural subset of the official HTML5 SDK; loaded by the host page. */
export interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  rewardedBreak(): Promise<boolean>;
  commercialBreak(): Promise<void>;
}

/** Ad units use the existing Ads service for pause/audio and overlap protection. */
export function pokiAdProvider(sdk: PokiSdk): AdProvider {
  const unit = <T>(show: () => Promise<T>) => {
    let destroyed = false;
    return {
      preload: async () => { if (destroyed) throw new Error('Poki ad unit destroyed'); },
      show: () => destroyed ? Promise.reject(new Error('Poki ad unit destroyed')) : show(),
      destroy: () => { destroyed = true; },
    };
  };
  return {
    createRewardedAd: () => unit(async () => ({ completed: (await sdk.rewardedBreak()) === true })),
    createInterstitialAd: () => unit(() => sdk.commercialBreak()),
  };
}

/** SDK failure never prevents the game loading, as required by Poki. */
export async function initializePoki(
  sdk: PokiSdk | undefined,
  warn: (message: string, error?: unknown) => void,
  timeoutMs = 10000,
): Promise<{ provider: AdProvider | null; loaded(): void }> {
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!sdk) warn('[Poki] SDK unavailable; continuing without ads');
  else {
    try {
      await Promise.race([
        sdk.init(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Poki SDK initialization timed out')), timeoutMs); }),
      ]);
      initialized = true;
    } catch (error) { warn('[Poki] SDK initialization failed; continuing without ads', error); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  let loaded = false;
  return {
    provider: initialized && sdk ? pokiAdProvider(sdk) : null,
    loaded() {
      if (loaded || !sdk) return;
      loaded = true;
      try { sdk.gameLoadingFinished(); }
      catch (error) { warn('[Poki] loading notification failed', error); }
    },
  };
}
