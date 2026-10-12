// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect,vi} from 'vitest';
import {App} from '../src/app/app';
import {defineComponent} from '../src/ecs/component';
import {ScriptPool, type PoolBlock, type PoolMemory} from '../src/ecs/ScriptPool';
import {AotContext} from '../src/ecs/aot/AotContext';
import {AotResources} from '../src/ecs/aot/AotResources';
import {AotEvents} from '../src/ecs/aot/AotEvents';

function memory(){
    const live=new Set<PoolBlock>();
    const provider:PoolMemory={alloc(bytes){const block={buffer:new ArrayBuffer(bytes),byteOffset:0,byteLength:bytes};live.add(block);return block;},release(block){if(!live.delete(block))throw Error('duplicate release');}};
    return{live,provider};
}

describe('script pool lifetime',()=>{
    it('frozen held views do not prevent entity removal or pool release',()=>{
        const m=memory(),app=App.new(),comp=defineComponent('FrozenPoolViewProbe',{value:0});
        app.world.useScriptPoolMemory(m.provider);const entity=app.world.spawn();app.world.insert(entity,comp,{value:7});
        const held=Object.freeze(app.world.get(entity,comp));app.quit({keepRenderer:true});
        expect(app.world.entityCount()).toBe(0);expect(m.live.size).toBe(0);expect(held.value).toBe(7);
    });
    it('retired AOT arenas, resources and event payloads cannot allocate again',()=>{
        const m=memory(),context=new AotContext(m.provider),resources=new AotResources(m.provider,()=>({value:7}),new Map([['Probe',['value']]])),events=new AotEvents(m.provider,()=>({read:()=>[{value:7}],send:()=>{}}));
        resources.addressOf('Probe');events.rowsFor('Probe',['value']);
        context.build(new Uint32Array(),0,new Uint32Array(),new Uint32Array(),[]);
        expect(m.live.size).toBe(3);context.dispose();resources.dispose();events.dispose();expect(m.live.size).toBe(0);
        expect(()=>resources.addressOf('Probe')).toThrow(/disposed/);expect(()=>events.rowsFor('Probe',['value'])).toThrow(/disposed/);
        expect(()=>context.build(new Uint32Array(),0,new Uint32Array(),new Uint32Array(),[])).toThrow(/disposed/);expect(m.live.size).toBe(0);
    });
    it('quit releases current row, sparse and owner blocks after growth',()=>{
        const m=memory(),app=App.new(),comp=defineComponent('QuitPoolProbe',{value:0});
        app.world.useScriptPoolMemory(m.provider);
        for(let i=0;i<70;i++)app.world.insert(app.world.spawn(),comp,{value:i});
        expect(m.live.size).toBe(3);app.quit({keepRenderer:true});expect(m.live.size).toBe(0);
        app.quit({keepRenderer:true});expect(m.live.size).toBe(0);
    });
    it('a deleted row view cannot mutate the next entity that reuses its slot',()=>{
        const pool=new ScriptPool([{name:'value',kind:'number'}],1);
        const old=pool.put(1 as never,{value:0},{value:7}).view;
        pool.put(3 as never,{value:0},{value:4});
        expect(pool.get(1 as never)).toBe(old);
        pool.delete(1 as never);const next=pool.put(2 as never,{value:0},{value:9}).view;
        old.value=100;expect(next.value).toBe(9);expect(old.value).toBe(100);
    });
    it('disposing a pool detaches held views and refuses reuse of freed storage',()=>{
        const m=memory(),pool=new ScriptPool([{name:'value',kind:'number'}],1,m.provider);
        const view=pool.put(1 as never,{value:0},{value:7}).view;
        pool.dispose();expect(m.live.size).toBe(0);expect(view.value).toBe(7);
        view.value=99;expect(view.value).toBe(99);expect(pool.address(1 as never)).toBeUndefined();
        expect(()=>pool.put(2 as never,{value:0})).toThrow(/disposed/);
        expect(()=>pool.span()).toThrow(/disposed/);pool.dispose();expect(m.live.size).toBe(0);
    });
    it.each([2,3])('rolls back partial construction when allocation %i fails',failAt=>{
        const m=memory(),alloc=m.provider.alloc;let calls=0;
        m.provider.alloc=bytes=>{if(++calls===failAt)throw Error('OOM');return alloc(bytes);};
        expect(()=>new ScriptPool([{name:'value',kind:'number'}],1,m.provider)).toThrow('OOM');expect(m.live.size).toBe(0);
    });
    it('failed growth gives back its partial block and leaves existing rows usable',()=>{
        const m=memory(),pool=new ScriptPool([{name:'value',kind:'number'}],1,m.provider);
        const view=pool.put(0 as never,{value:0},{value:7}).view,alloc=m.provider.alloc;let calls=0;
        m.provider.alloc=bytes=>{if(++calls===2)throw Error('OOM');return alloc(bytes);};
        expect(()=>pool.put(1 as never,{value:0},{value:9})).toThrow('OOM');expect(m.live.size).toBe(3);expect(view.value).toBe(7);
        m.provider.alloc=alloc;expect(pool.put(1 as never,{value:0},{value:9}).view.value).toBe(9);pool.dispose();expect(m.live.size).toBe(0);
    });
    it('an address resolver follows a newly created pool after quit',()=>{
        const m=memory(),app=App.new(),comp=defineComponent('ResetPoolAddressProbe',{value:0});
        app.world.useScriptPoolMemory(m.provider);const first=app.world.spawn();app.world.insert(first,comp,{value:7});
        const address=app.world.addressResolver(comp);expect(address(first)).toBeDefined();app.quit({keepRenderer:true});expect(address(first)).toBeUndefined();
        app.world.useScriptPoolMemory(m.provider);const next=app.world.spawn();app.world.insert(next,comp,{value:9});
        expect(address(next)).toBeDefined();app.quit({keepRenderer:true});expect(m.live.size).toBe(0);
    });
    it('quit survives reentrant and throwing frees while releasing every block once',()=>{
        const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),m=memory(),app=App.new(),comp=defineComponent('QuitFreeFailureProbe',{value:0});
        app.world.useScriptPoolMemory(m.provider);app.world.insert(app.world.spawn(),comp,{value:7});
        const release=m.provider.release;let calls=0;
        m.provider.release=block=>{release(block);app.quit({keepRenderer:true});if(++calls===1)throw Error('release failure');};
        try{app.quit({keepRenderer:true});expect(calls).toBe(3);expect(m.live.size).toBe(0);app.quit({keepRenderer:true});expect(calls).toBe(3);}
        finally{warn.mockRestore();}
    });
});
