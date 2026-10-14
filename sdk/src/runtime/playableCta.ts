// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The one call a playable ad's game code makes when the player takes the
 *        call to action, and the seam that keeps the ad network out of that code.
 *
 *        Every network wants a different function for "the player clicked through"
 *        — Meta wants `FbPlayableAd.onCTAClick()`, the mraid family wants
 *        `mraid.open(url)`, and each new one wants its own. None of them can be
 *        called directly from a game that also ships to the web, so the export
 *        injects a bridge (see the desktop `PlayableAdProfile`) and this function
 *        dispatches through it. A build with no network selected has no bridge and
 *        this is a no-op — the game is playable, the click just goes nowhere.
 *
 *        Deliberately its own module: importing a CTA call must not drag the whole
 *        playable runtime into a web build.
 */

/** What the exported page installs on `globalThis` — one method per interaction. */
export interface PlayableAdBridge {
    /** Hand the player off to the store, the way THIS network spells it. */
    cta?(url?: string): void;
    ready?(): void;
    gameEnd?(): void;
    retry?(): void;
    onActive?(listener: (active: boolean) => void): () => void;
}

const GLOBAL_KEY = '__ESTELLA_PLAYABLE__';

let warned = false;

export function playableAdBridge(): PlayableAdBridge | undefined {
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as PlayableAdBridge | undefined;
}

/**
 * Dispatch a user-gesture store click through the selected network.
 * MRAID accepts an explicit store URL; other hosts select their own destination.
 * Without a bridge, the scene remains playable and reports missing configuration.
 */
export function playableCta(url?: string): void {
    const cta = playableAdBridge()?.cta;
    if (cta) {
        cta(url);
        return;
    }
    if (!warned) {
        warned = true;
        console.warn('[playable] no ad-network bridge — the CTA went nowhere. '
            + 'Select an ad network in Project Settings → Packaging → Playable to install one.');
    }
}

/** Whether an ad-network bridge is installed — for a game that wants to hide its
 *  store button when there is nowhere to send the player. */
export function hasPlayableCta(): boolean {
    return typeof playableAdBridge()?.cta === 'function';
}

/** Notify the ad container when the game reaches a win or loss. */
export function playableGameEnd(): void { playableAdBridge()?.gameEnd?.(); }

/** Notify the ad container when the player explicitly restarts the game. */
export function playableRetry(): void { playableAdBridge()?.retry?.(); }
