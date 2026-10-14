// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { mintegralPlayableProfile, isPlayableZipFileName } from '../src/export/playableAdProfile';

function host(withContainer = true) {
    const window = {
        install: withContainer ? vi.fn() : undefined,
        gameReady: withContainer ? vi.fn() : undefined,
        gameEnd: withContainer ? vi.fn() : undefined,
        gameRetry: withContainer ? vi.fn() : undefined,
        gameStart: undefined as (() => void) | undefined,
        gameClose: undefined as (() => void) | undefined,
        __ESTELLA_PLAYABLE__: undefined as {
            cta(): void; ready(): void; gameEnd(): void; retry(): void;
            onActive(listener: (active: boolean) => void): () => void;
        } | undefined,
    };
    new Function('window', mintegralPlayableProfile.emitBridge!({ title: 'Demo', orientation: 'portrait' }))(window);
    return window;
}

describe('Mintegral profile', () => {
    it('uses a same-basename ZIP and rejects unsafe archive paths', () => {
        expect(mintegralPlayableProfile.zipFileName).toBe('index.zip');
        expect(isPlayableZipFileName('custom_1.zip')).toBe(true);
        for (const name of ['../escape.zip', 'C:\\escape.zip', '/escape.zip', 'CON.zip', 'LPT1.zip', 'archive.html', '', null]) {
            expect(isPlayableZipFileName(name)).toBe(false);
        }
    });

    it('waits for host start, announces loaded resources once, and releases listeners', () => {
        const window = host(), active = vi.fn(), bridge = window.__ESTELLA_PLAYABLE__!;
        const release = bridge.onActive(active);
        expect(active).toHaveBeenLastCalledWith(false);
        bridge.ready(); bridge.ready(); expect(window.gameReady).toHaveBeenCalledTimes(1);
        window.gameStart!(); expect(active).toHaveBeenLastCalledWith(true);
        window.gameClose!(); expect(active).toHaveBeenLastCalledWith(false);
        release(); const calls = active.mock.calls.length;
        window.gameStart!(); expect(active).toHaveBeenCalledTimes(calls);
    });

    it('uses the host install/end/retry APIs without synthesizing a win on CTA', () => {
        const window = host(), bridge = window.__ESTELLA_PLAYABLE__!;
        bridge.cta(); expect(window.install).toHaveBeenCalledTimes(1);
        expect(window.gameEnd).not.toHaveBeenCalled();
        bridge.gameEnd(); bridge.retry();
        expect(window.gameEnd).toHaveBeenCalledTimes(1); expect(window.gameRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps a local preview active when no ad container exists', () => {
        const bridge = host(false).__ESTELLA_PLAYABLE__!, active = vi.fn();
        bridge.onActive(active); expect(active).toHaveBeenLastCalledWith(true);
        expect(() => { bridge.ready(); bridge.cta(); bridge.gameEnd(); bridge.retry(); }).not.toThrow();
    });
});
