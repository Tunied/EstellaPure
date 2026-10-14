// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { TrainingSave } from '../../examples/mobile-controls/src/trainingSave';
function fixture(raw?: string) {
    let value = raw;
    const storage = { getString: vi.fn(() => value), setString: vi.fn((_key: string, next: string) => { value = next; }) };
    return { storage, change: (next: string) => { value = next; }, current: () => value };
}
it('loads before saving and restores earned credits on a new session', () => {
    const { storage } = fixture(), first=new TrainingSave(storage);
    expect(first.load()).toBe(0); first.save(1);
    expect(first.message).toContain('cloud backup pending');
    expect(new TrainingSave(storage).load()).toBe(1);
});
it('never overwrites corrupt, future-version or invalid credit records', () => {
    for(const raw of ['bad','null','{"version":2,"credits":5}','{"version":1,"credits":-1}','{"version":1,"credits":1.5}']) {
        const { storage, current }=fixture(raw), save=new TrainingSave(storage);
        expect(save.load()).toBe(0);save.save(1);
        expect(storage.setString).not.toHaveBeenCalled();expect(current()).toBe(raw);
        expect(save.message).toContain('Save unavailable');
    }
});
it('keeps session progress explicit after storage failures and can retry an unchanged record', () => {
    const { storage }=fixture(), save=new TrainingSave(storage);save.load();
    storage.setString.mockImplementationOnce(()=>{throw new Error('quota');});save.save(1);
    expect(save.message).toContain('Save failed');save.save(2);
    expect(new TrainingSave(storage).load()).toBe(2);
});
it('refuses to overwrite external progress changes and never writes before a successful load', () => {
    const { storage, change }=fixture(), save=new TrainingSave(storage);
    save.save(1);expect(storage.setString).not.toHaveBeenCalled();save.load();
    change('{"version":1,"credits":20}');save.save(2);save.save(3);
    expect(storage.setString).not.toHaveBeenCalled();expect(save.message).toContain('changed');
});
it('surfaces unreadable storage as session-only progress without writing fallback', () => {
    const {storage}=fixture();storage.getString.mockImplementation(()=>{throw new Error('disabled');});
    const save=new TrainingSave(storage);expect(save.load()).toBe(0);save.save(1);
    expect(storage.setString).not.toHaveBeenCalled();expect(save.message).toContain('session');
});
it('reports async saving only after acknowledgment and preserves pending status for newer writes',async()=>{
    const {storage}=fixture();let first!:()=>void,second!:()=>void;
    const flush=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{first=resolve;}))
        .mockImplementationOnce(()=>new Promise<void>(resolve=>{second=resolve;}));
    const save=new TrainingSave({...storage,flush});save.load();const a=save.saveAsync(1),b=save.saveAsync(2);
    first();await a;expect(save.message).toBe('Saving progress...');second();await b;expect(save.message).toContain('acknowledged');
});
it('does not acknowledge failed async writes or unreadable progress',async()=>{
    const {storage}=fixture(),flush=vi.fn(async()=>{throw new Error('offline');}),save=new TrainingSave({...storage,flush});save.load();
    await save.saveAsync(1);expect(save.message).toContain('Save failed');
    storage.getString.mockImplementation(()=>{throw new Error('unavailable');});save.load();flush.mockClear();await save.saveAsync(2);
    expect(flush).not.toHaveBeenCalled();
});
