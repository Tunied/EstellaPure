// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { mraidPlayableProfile, unityPlayableProfile, applovinPlayableProfile } from '../src/export/playableAdProfile';

function container(profile = mraidPlayableProfile, state = 'loading', visible = false) {
    const events = new Map<string, Set<(...args: any[]) => void>>();
    const mraid = { getState: () => state, isViewable: () => visible, open: vi.fn(),
        addEventListener: (name: string, fn: (...args: any[]) => void) => { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); },
        removeEventListener: (name: string, fn: (...args: any[]) => void) => events.get(name)?.delete(fn) };
    const window: any = { mraid };
    new Function('window', profile.emitBridge!({ title: 'T', orientation: 'portrait' }))(window);
    return { bridge: window.__ESTELLA_PLAYABLE__, mraid, events,
        ready(value: boolean) { state = 'default'; visible = value; events.get('ready')?.forEach(fn => fn()); },
        viewable(value: boolean) { visible = value; events.get('viewableChange')?.forEach(fn => fn(value)); } };
}

describe('MRAID lifecycle', () => {
    it.each([mraidPlayableProfile, unityPlayableProfile, applovinPlayableProfile])('$id waits for readiness and viewability and detaches callbacks', profile => {
        const c = container(profile), active = vi.fn(), release = c.bridge.onActive(active);
        expect(active).toHaveBeenLastCalledWith(false);
        c.viewable(true); expect(active).toHaveBeenLastCalledWith(false);
        c.ready(false); expect(active).toHaveBeenLastCalledWith(false);
        c.viewable(true); expect(active).toHaveBeenLastCalledWith(true);
        c.viewable(false); expect(active).toHaveBeenLastCalledWith(false);
        c.bridge.cta(); expect(c.mraid.open).toHaveBeenCalledOnce();
        release(); expect(c.events.get('ready')?.size).toBe(0); expect(c.events.get('viewableChange')?.size).toBe(0);
        const previous = active.mock.calls.length; c.viewable(true); expect(active).toHaveBeenCalledTimes(previous);
    });

    it('starts an already-ready visible host and supports independent subscriptions', () => {
        const c = container(mraidPlayableProfile, 'default', true), a = vi.fn(), b = vi.fn();
        const first = c.bridge.onActive(a), second = c.bridge.onActive(b);
        expect(a).toHaveBeenLastCalledWith(true); expect(b).toHaveBeenLastCalledWith(true);
        first(); c.viewable(false); expect(a).toHaveBeenLastCalledWith(true); expect(b).toHaveBeenLastCalledWith(false);
        second(); expect(c.events.get('viewableChange')?.size).toBe(0);
        c.viewable(true); const again = vi.fn(), third = c.bridge.onActive(again);
        expect(again).toHaveBeenLastCalledWith(true); third();
    });

    it('keeps a standalone browser preview active with no MRAID container', () => {
        const window: any = {};
        new Function('window', mraidPlayableProfile.emitBridge!({ title: 'T', orientation: 'portrait' }))(window);
        const active = vi.fn(); window.__ESTELLA_PLAYABLE__.onActive(active);
        expect(active).toHaveBeenCalledWith(true); expect(() => window.__ESTELLA_PLAYABLE__.cta()).not.toThrow();
    });
});
