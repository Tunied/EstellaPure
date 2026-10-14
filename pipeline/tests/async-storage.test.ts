// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { createAsyncStorage } from '../src/runtime/asyncStorage';
import { Storage, SaveManager, extendPlatform, getPlatform } from 'esengine';
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function fixture(raw='') {
    const source={load:vi.fn(async()=>raw),save:vi.fn(async(_data:string)=>{})};
    const storage=createAsyncStorage(source,{maxBytes:3*1024*1024});
    return {source,storage,adapter:storage.adapter};
}
it('persists real SDK save slots through the async adapter and migrates them after reloading',async()=>{
    let remote='';
    const source={load:async()=>remote,save:async(data:string)=>{remote=data;}};
    const platform=getPlatform(), original={getStorageItem:platform.getStorageItem,setStorageItem:platform.setStorageItem,
        removeStorageItem:platform.removeStorageItem,clearStorage:platform.clearStorage,flushStorage:platform.flushStorage};
    try {
        const first=createAsyncStorage(source,{maxBytes:1024});await first.load();extendPlatform(first.adapter);
        const saves=new SaveManager({version:1});await saves.saveAsync('training',{stage:3});
        expect(first.dirty).toBe(false);expect(Storage.has('save:training')).toBe(true);
        const second=createAsyncStorage(source,{maxBytes:1024});await second.load();extendPlatform(second.adapter);
        const restored=new SaveManager({version:2,migrations:{1:(old)=>({level:(old as {stage:number}).stage})}});
        expect(restored.load('training')).toEqual({level:3});
        source.save=async()=>{throw new Error('cloud rejected');};
        await expect(restored.saveAsync('training',{level:4})).rejects.toThrow('cloud rejected');
        expect(restored.load('training')).toEqual({level:4});expect(second.dirty).toBe(true);
    } finally {extendPlatform(original);}
});
it('awaits load before exposing reads or writes, sharing concurrent load calls', async()=>{
    const {source,storage,adapter}=fixture(), loaded=deferred<string>();source.load.mockReturnValue(loaded.promise);
    const a=storage.load(),b=storage.load();expect(a).toBe(b);
    expect(()=>adapter.getStorageItem('key')).toThrow('load must succeed');
    expect(()=>adapter.setStorageItem('key','bad')).toThrow('load must succeed');
    await expect(adapter.flushStorage!()).rejects.toThrow('load must succeed');
    loaded.resolve('{"version":1,"items":{"key":"old"}}');await a;
    expect(adapter.getStorageItem('key')).toBe('old');expect(source.load).toHaveBeenCalledOnce();
    await storage.load();expect(source.load).toHaveBeenCalledOnce();expect(source.save).not.toHaveBeenCalled();
});
it('preserves failed or unsupported data and permits retrying failed loads',async()=>{
    for(const raw of ['bad','null','{"version":2,"items":{}}','{"version":1,"items":[]}','{"version":1,"items":{"key":2}}','{"version":1,"items":{},"publisher":"keep"}']) {
        const {source,storage,adapter}=fixture(raw);
        await expect(storage.load()).rejects.toThrow();expect(()=>adapter.setStorageItem('key','new')).toThrow('unavailable');
        expect(source.save).not.toHaveBeenCalled();source.load.mockResolvedValue('');await storage.load();expect(adapter.getStorageItem('key')).toBe(null);
    }
});
it('serializes concurrent flushes and retains changes made during a save',async()=>{
    const {source,storage,adapter}=fixture();await storage.load();
    const first=deferred<void>();source.save.mockReturnValueOnce(first.promise);
    adapter.setStorageItem('key','one');const a=adapter.flushStorage!();await Promise.resolve();
    adapter.setStorageItem('key','two');const b=adapter.flushStorage!();
    expect(source.save).toHaveBeenCalledOnce();expect(storage.dirty).toBe(true);
    first.resolve();await Promise.all([a,b]);expect(source.save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(source.save.mock.calls[0][0]).items.key).toBe('one');
    expect(JSON.parse(source.save.mock.calls[1][0]).items.key).toBe('two');expect(storage.dirty).toBe(false);
});
it('propagates failed writes without rolling back local progress, and retries the newest revision',async()=>{
    const {source,storage,adapter}=fixture();await storage.load();adapter.setStorageItem('key','one');
    source.save.mockRejectedValueOnce(new Error('offline'));
    await expect(adapter.flushStorage!()).rejects.toThrow('offline');expect(storage.dirty).toBe(true);
    adapter.setStorageItem('key','two');await adapter.flushStorage!();
    expect(JSON.parse(source.save.mock.calls[1][0]).items.key).toBe('two');expect(storage.dirty).toBe(false);
});
it('does not save unchanged values or empty clears and preserves unrelated keys',async()=>{
    const {source,storage,adapter}=fixture('{"version":1,"items":{"esengine:a":"1","publisher":"keep","__proto__":"safe"}}');await storage.load();
    adapter.setStorageItem('esengine:a','1');adapter.removeStorageItem('absent');adapter.clearStorage('absent:');await adapter.flushStorage!();
    expect(source.save).not.toHaveBeenCalled();expect(adapter.getStorageItem('__proto__')).toBe('safe');
    adapter.clearStorage('esengine:');await adapter.flushStorage!();
    expect(JSON.parse(source.save.mock.calls[0][0]).items).toEqual({publisher:'keep',['__proto__']:'safe'});
    expect(adapter.getStorageItem('__proto__')).toBe('safe');
});
it('rejects an oversized UTF-8 envelope before mutating state or calling the host',async()=>{
    const {source,storage,adapter}=fixture();await storage.load();
    expect(()=>adapter.setStorageItem('key','界'.repeat(1048576))).toThrow('byte limit');
    expect(adapter.getStorageItem('key')).toBe(null);expect(storage.dirty).toBe(false);expect(source.save).not.toHaveBeenCalled();
});
it('batches automatic writes and never spins on failures or throwing diagnostics',async()=>{
    const source={load:vi.fn(async()=>''),save:vi.fn(async(_data:string):Promise<void>=>{throw new Error('offline');})}, warn=vi.fn(()=>{throw new Error('logger failed');});
    const storage=createAsyncStorage(source,{maxBytes:1024,autoSave:true,warn});await storage.load();
    storage.adapter.setStorageItem('a','1');storage.adapter.setStorageItem('b','2');
    await vi.waitFor(()=>expect(warn).toHaveBeenCalledOnce());await new Promise(resolve=>setTimeout(resolve,20));
    expect(source.save).toHaveBeenCalledOnce();expect(storage.dirty).toBe(true);
    source.save.mockResolvedValue(undefined);await storage.adapter.flushStorage!();expect(storage.dirty).toBe(false);
});
it('automatically sends newer progress after an older request finishes',async()=>{
    const first=deferred<void>(), source={load:vi.fn(async()=>''),save:vi.fn(async(_data:string)=>{})};
    source.save.mockReturnValueOnce(first.promise);
    const storage=createAsyncStorage(source,{maxBytes:1024,autoSave:true});await storage.load();
    storage.adapter.setStorageItem('key','one');await vi.waitFor(()=>expect(source.save).toHaveBeenCalledOnce());
    storage.adapter.setStorageItem('key','two');expect(source.save).toHaveBeenCalledOnce();
    first.resolve();await vi.waitFor(()=>expect(storage.dirty).toBe(false));
    expect(source.save).toHaveBeenCalledTimes(2);expect(JSON.parse(source.save.mock.calls[1][0]).items.key).toBe('two');
});
