// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { tiktokPlayableProfile } from '../src/export/playableAdProfile';

describe('TikTok bridge', () => {
    it('uses late host installation and releases page visibility handlers', () => {
        const window: any = {}, callbacks = new Set<() => void>();
        const document = { hidden: false,
            addEventListener: (_: string, fn: () => void) => callbacks.add(fn),
            removeEventListener: (_: string, fn: () => void) => callbacks.delete(fn) };
        new Function('window', 'document', tiktokPlayableProfile.emitBridge!({ title: 'T', orientation: 'portrait' }))(window, document);
        expect(() => window.__ESTELLA_PLAYABLE__.cta()).not.toThrow();
        window.openAppStore = vi.fn(); window.__ESTELLA_PLAYABLE__.cta();
        expect(window.openAppStore).toHaveBeenCalledOnce();
        const active = vi.fn(), release = window.__ESTELLA_PLAYABLE__.onActive(active);
        expect(active).toHaveBeenLastCalledWith(true);
        document.hidden = true; callbacks.forEach(fn => fn()); expect(active).toHaveBeenLastCalledWith(false);
        document.hidden = false; callbacks.forEach(fn => fn()); expect(active).toHaveBeenLastCalledWith(true);
        release(); expect(callbacks.size).toBe(0);
    });
});
