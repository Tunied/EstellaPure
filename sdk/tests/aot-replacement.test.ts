import {afterEach,describe,it,expect,vi} from 'vitest';
import {App} from '../src/app/app';
import {defineComponent} from '../src/ecs/component';
import {defineSystem} from '../src/ecs/system';
import {Query,Mut} from '../src/ecs/query';
import {setPlatform} from '../src/platform/base';
import type {PlatformAdapter} from '../src/platform/types';
import {FakeEngine} from './fakeEngine';
import {buildFadeModule,fadeManifest,useBytesPlatform} from './helpers/aotFade';
import {emccPath} from '../../build-tools/utils/emscripten.js';
import {createMockModule} from './mocks/wasm';

const EMCC=emccPath();useBytesPlatform();afterEach(useBytesPlatform);
class TrackedEngine extends FakeEngine {
    readonly live=new Set<number>();
    override _malloc(size:number):number {const at=super._malloc(size);this.live.add(at);return at;}
    override _free(at?:number):void {expect(this.live.delete(at!)).toBe(true);}
}
function fixture(){
    const app=App.new(),host=new TrackedEngine(),Fade=defineComponent('Fade',{alpha:1,step:0.1});
    app.addSystem(defineSystem([Query(Mut(Fade))],q=>{for(const [,row] of q)row.alpha-=row.step;},{name:'Fade'}));
    const wasm=new Uint8Array(buildFadeModule(EMCC!)).buffer;
    return{app,host,Fade,opts:{host,manifest:fadeManifest(),wasm}};
}
describe.skipIf(!EMCC)('compiled runtime replacement ownership',()=>{
    it('retires old arenas on every replacement and releases all ownership on quit',async()=>{
        const f=fixture();
        try {
            for(let round=0;round<4;round++){
                await f.app.useCompiledSystems(f.opts);
                expect(f.host.live.size).toBe(0);
                await f.app.tick(1/60);expect(f.host.live.size).toBeGreaterThan(0);
            }
        }finally{f.app.quit({keepRenderer:true});}
        expect(f.host.live.size).toBe(0);
    });
    it('preserves pooled rows, held views and addresses when the allocator is unchanged',async()=>{
        const f=fixture();await f.app.useCompiledSystems(f.opts);
        const entity=f.app.world.spawn();f.app.world.insert(entity,f.Fade,{alpha:1,step:0.1});
        const held=f.app.world.get(entity,f.Fade),address=f.app.world.addressResolver(f.Fade)(entity);
        try{
            await f.app.tick(1/60);const live=f.host.live.size;
            await f.app.useCompiledSystems(f.opts);await f.app.tick(1/60);
            expect(held.alpha).toBeCloseTo(0.8);expect(f.app.world.get(entity,f.Fade)).toBe(held);
            expect(f.app.world.addressResolver(f.Fade)(entity)).toBe(address);expect(f.host.live.size).toBe(live);
        }finally{f.app.quit({keepRenderer:true});}expect(f.host.live.size).toBe(0);
    });
    it('rejects moving existing rows to a different allocator and retains the active runtime',async()=>{
        const f=fixture();await f.app.useCompiledSystems(f.opts);
        const entity=f.app.world.spawn();f.app.world.insert(entity,f.Fade,{alpha:1,step:0.1});
        try{
            await expect(f.app.useCompiledSystems({...f.opts,host:new TrackedEngine()})).rejects.toThrow(/before the first pooled component/);
            await f.app.tick(1/60);expect(f.app.world.get(entity,f.Fade).alpha).toBeCloseTo(0.9);expect(f.app.compiledSystems.calls).toBe(1);
        }finally{f.app.quit({keepRenderer:true});}expect(f.host.live.size).toBe(0);
    });
    it('serializes asynchronous installations and keeps the old runtime active until commit',async()=>{
        const f=fixture(),gates:Array<()=>void>=[],entered:Array<()=>void>=[];
        const firstEntered=new Promise<void>(r=>entered.push(r)),secondEntered=new Promise<void>(r=>entered.push(r));let calls=0;
        setPlatform({instantiateWasm:async(source:ArrayBuffer,imports:WebAssembly.Imports)=>{
            const n=calls++;entered[n]?.();await new Promise<void>(r=>gates[n]=r);return WebAssembly.instantiate(source,imports);
        }} as unknown as PlatformAdapter);
        const first=f.app.useCompiledSystems({...f.opts,manifest:{...f.opts.manifest,systems:[{...f.opts.manifest.systems[0]!,name:'First'}]}});
        const second=f.app.useCompiledSystems({...f.opts,manifest:{...f.opts.manifest,systems:[{...f.opts.manifest.systems[0]!,name:'Second'}]}});
        try {
            await firstEntered;expect(calls).toBe(1);gates[0]!();await first;await secondEntered;
            expect(f.app.compiledSystems.installed).toEqual(['First']);gates[1]!();await second;
            expect(f.app.compiledSystems.installed).toEqual(['Second']);expect(calls).toBe(2);
        }finally{gates.forEach(r=>r());f.app.quit({keepRenderer:true});}
    });
    it('cancels current and queued installs on quit without changing the retired world allocator',async()=>{
        const f=fixture();let begin!:()=>void,resume!:()=>void,calls=0;
        const started=new Promise<void>(r=>begin=r),gate=new Promise<void>(r=>resume=r);
        setPlatform({instantiateWasm:async(source:ArrayBuffer,imports:WebAssembly.Imports)=>{calls++;begin();await gate;return WebAssembly.instantiate(source,imports);}} as unknown as PlatformAdapter);
        const first=f.app.useCompiledSystems(f.opts).catch(e=>e),second=f.app.useCompiledSystems(f.opts).catch(e=>e);
        await started;f.app.quit({keepRenderer:true});resume();
        expect((await first).message).toMatch(/cancelled by App.quit/);expect((await second).message).toMatch(/cancelled by App.quit/);
        expect(calls).toBe(1);expect(f.app.compiledSystemCount).toBe(0);expect(f.host.live.size).toBe(0);
        const entity=f.app.world.spawn();f.app.world.insert(entity,f.Fade,{alpha:1,step:0.1});
        expect(f.host.live.size).toBe(0);f.app.quit({keepRenderer:true});
    });
    it('keeps the previous allocator after a refused module before rows exist',async()=>{
        const f=fixture();await f.app.useCompiledSystems(f.opts);const other=new TrackedEngine();
        try{
            await expect(f.app.useCompiledSystems({...f.opts,host:other,wasm:new Uint8Array([0]).buffer})).rejects.toThrow();
            const entity=f.app.world.spawn();f.app.world.insert(entity,f.Fade,{alpha:1,step:0.1});await f.app.tick(1/60);
            expect(f.app.world.get(entity,f.Fade).alpha).toBeCloseTo(0.9);expect(other.live.size).toBe(0);
        }finally{f.app.quit({keepRenderer:true});}expect(f.host.live.size).toBe(0);
    });
    it('shares allocator identity across the public module installation wrappers',async()=>{
        const f=fixture(),module=createMockModule();
        Object.assign(module,{wasmMemory:f.host.memory,_malloc:(n:number)=>f.host._malloc(n),_free:(at:number)=>f.host._free(at)});
        Object.defineProperty(module,'HEAPU8',{get:()=>f.host.HEAPU8});f.app.connectCpp(module.getRegistry(),module);
        try{
            expect(await f.app.installCompiledSystems(f.opts.wasm,f.opts.manifest)).toBe(1);
            const entity=f.app.world.spawn();f.app.world.insert(entity,f.Fade,{alpha:1,step:0.1});await f.app.tick(1/60);
            expect(await f.app.installCompiledSystems(f.opts.wasm,f.opts.manifest)).toBe(1);await f.app.tick(1/60);
            expect(f.app.world.get(entity,f.Fade).alpha).toBeCloseTo(0.8);
        }finally{f.app.quit({keepRenderer:true});}expect(f.host.live.size).toBe(0);
    });
    it('retains the new runtime if retiring the old arena reports an error',async()=>{
        const f=fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});let thrown=false;
        const free=f.host._free.bind(f.host);f.host._free=at=>{free(at);if(!thrown){thrown=true;throw Error('retirement failed');}};
        try{
            await f.app.useCompiledSystems(f.opts);await f.app.tick(1/60);
            await f.app.useCompiledSystems(f.opts);expect(f.host.live.size).toBe(0);
            await f.app.tick(1/60);expect(f.app.compiledSystems.calls).toBe(1);
        }finally{f.app.quit({keepRenderer:true});warn.mockRestore();}expect(f.host.live.size).toBe(0);
    });
    it('cannot resurrect dispatch when old retirement reenters quit',async()=>{
        const f=fixture();await f.app.useCompiledSystems(f.opts);await f.app.tick(1/60);
        const free=f.host._free.bind(f.host);let quit=false;
        f.host._free=at=>{free(at);if(!quit){quit=true;f.app.quit({keepRenderer:true});}};
        await expect(f.app.useCompiledSystems(f.opts)).rejects.toThrow(/cancelled by App.quit/);
        expect(f.app.compiledSystemCount).toBe(0);expect(f.host.live.size).toBe(0);
    });
});
