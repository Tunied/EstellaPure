// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';

function setup() {
    const values = new Map<string, string>();
    const info = vi.fn(() => ({ keys: [...values.keys()] }));
    const host = {
        getStorageSync: (key: string) => values.get(key) ?? '',
        setStorageSync: (key: string, value: string) => values.set(key, value),
        removeStorageSync: (key: string) => values.delete(key),
        getStorageInfoSync: info,
    };
    const profile: MiniGameProfile = { id: 'storage-test', hostLabel: 'Storage test', global: host as unknown as MiniGameGlobal };
    return { adapter: new MiniGamePlatformAdapter(profile), info, values, profile };
}
it('preserves an explicitly stored empty string and distinguishes missing keys', () => {
    const { adapter } = setup();
    adapter.setStorageItem('empty', '');
    expect(adapter.getStorageItem('empty')).toBe('');
    expect(adapter.getStorageItem('missing')).toBe(null);
    adapter.removeStorageItem('empty');
    expect(adapter.getStorageItem('empty')).toBe(null);
});
it('reads normal values without querying the key list', () => {
    const { adapter, info } = setup();
    adapter.setStorageItem('value', '{"volume":0}');
    expect(adapter.getStorageItem('value')).toBe('{"volume":0}');
    expect(info).not.toHaveBeenCalled();
});
it('retains stored values when a new adapter is created for the same host', () => {
    const { adapter, profile } = setup();
    adapter.setStorageItem('empty', '');
    adapter.setStorageItem('zero', '0');
    const restarted = new MiniGamePlatformAdapter(profile);
    expect(restarted.getStorageItem('empty')).toBe('');
    expect(restarted.getStorageItem('zero')).toBe('0');
});
it('returns absence if the host refuses the ambiguous key lookup', () => {
    const { adapter, info } = setup();
    info.mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(adapter.getStorageItem('missing')).toBe(null);
});
