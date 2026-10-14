// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { SaveManager, migrateSaveData, type SaveStorage } from '../src/scene/saveGame';

describe('migrateSaveData', () => {
    const migrations = {
        1: (d: any) => ({ ...d, level: d.stage ?? 1 }),       // v1 -> v2: rename stage→level
        2: (d: any) => ({ ...d, coins: d.coins ?? 0 }),       // v2 -> v3: add coins
    };

    it('applies the chain from the save version to current', () => {
        const out = migrateSaveData(1, { stage: 5 }, 3, migrations) as any;
        expect(out).toEqual({ stage: 5, level: 5, coins: 0 });
    });

    it('no-op when already current', () => {
        expect(migrateSaveData(3, { coins: 9 }, 3, migrations)).toEqual({ coins: 9 });
    });

    it('runs only the needed tail of the chain', () => {
        expect(migrateSaveData(2, { level: 2 }, 3, migrations)).toEqual({ level: 2, coins: 0 });
    });

    it('throws on a missing migration step', () => {
        expect(() => migrateSaveData(1, {}, 3, { 2: (d) => d })).toThrow(/migration for version 1/);
    });

    it('throws when the save is newer than current (no downgrade)', () => {
        expect(() => migrateSaveData(5, {}, 3, migrations)).toThrow(/newer than/);
    });
});

function memStorage(): SaveStorage & { _map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        _map: map,
        getJSON<T>(key: string, def?: T): T | undefined {
            const raw = map.get(key);
            return raw === undefined ? def : (JSON.parse(raw) as T);
        },
        setJSON<T>(key: string, value: T): void { map.set(key, JSON.stringify(value)); },
        remove(key: string): void { map.delete(key); },
        has(key: string): boolean { return map.has(key); },
    };
}

describe('SaveManager', () => {
    it('saveAsync writes the versioned slot before awaiting the storage acknowledgment', async () => {
        const storage = memStorage(); let finish!: () => void;
        storage.flush = vi.fn(function(this: unknown) {
            expect(this).toBe(storage);
            return new Promise<void>(resolve => { finish = resolve; });
        });
        const manager = new SaveManager({ version: 2, storage, now: () => 7 });
        let completed = false;
        const pending = manager.saveAsync('s', { level: 3 }).then(() => { completed = true; });
        expect(manager.load('s')).toEqual({ level: 3 });expect(manager.savedAt('s')).toBe(7);
        await Promise.resolve();expect(completed).toBe(false);finish();await pending;expect(completed).toBe(true);
    });
    it('saveAsync preserves write and flush failures and supports synchronous storage', async () => {
        const storage = memStorage(), manager = new SaveManager({ version: 1, storage });
        await manager.saveAsync('s', { level: 1 });expect(manager.load('s')).toEqual({ level: 1 });
        const flush = storage.flush = vi.fn(async () => { throw new Error('offline'); });
        await expect(manager.saveAsync('s', { level: 2 })).rejects.toThrow('offline');
        expect(manager.load('s')).toEqual({ level: 2 });flush.mockClear();
        storage.setJSON = () => { throw new Error('write unavailable'); };
        await expect(manager.saveAsync('s', { level: 3 })).rejects.toThrow('write unavailable');
        expect(flush).not.toHaveBeenCalled();
    });
    it('round-trips data with version + savedAt', () => {
        const storage = memStorage();
        const mgr = new SaveManager({ version: 1, storage, now: () => 1234 });
        mgr.save('slot0', { hp: 10 });
        expect(mgr.load<{ hp: number }>('slot0')).toEqual({ hp: 10 });
        expect(mgr.savedAt('slot0')).toBe(1234);
        // envelope shape persisted under the prefixed key
        expect(JSON.parse(storage._map.get('save:slot0')!)).toEqual({ version: 1, data: { hp: 10 }, savedAt: 1234 });
    });

    it('migrates an older save on load', () => {
        const storage = memStorage();
        // Write a v1 save directly.
        new SaveManager({ version: 1, storage, now: () => 0 }).save('s', { stage: 3 });
        // Load with a current-version-2 manager + migration.
        const mgr = new SaveManager({
            version: 2, storage,
            migrations: { 1: (d: any) => ({ level: d.stage }) },
        });
        expect(mgr.load('s')).toEqual({ level: 3 });
    });

    it('has / remove / missing slot', () => {
        const storage = memStorage();
        const mgr = new SaveManager({ version: 1, storage });
        expect(mgr.load('none')).toBeNull();
        expect(mgr.savedAt('none')).toBeNull();
        expect(mgr.has('none')).toBe(false);
        mgr.save('a', { x: 1 });
        expect(mgr.has('a')).toBe(true);
        mgr.remove('a');
        expect(mgr.has('a')).toBe(false);
    });

    it('honors a custom key prefix', () => {
        const storage = memStorage();
        new SaveManager({ version: 1, storage, keyPrefix: 'game/', now: () => 0 }).save('1', { a: 1 });
        expect(storage._map.has('game/1')).toBe(true);
    });
});
