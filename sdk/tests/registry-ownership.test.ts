// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {App,createWebApp} from '../src/app/app';
import {createHeadlessApp} from '../src/runtime/webAppFactory';
import {AppContext,setDefaultContext} from '../src/ecs/context';
import {createMockModule} from './mocks/wasm';
import {setPlatform} from '../src/platform/base';
import {nodeAdapter} from '../src/platform/node';

// Ownership tests isolate graphics bootstrap; actual editor runs exercise it.
vi.mock('../src/app/corePlugin',async importOriginal=>({...await importOriginal<typeof import('../src/app/corePlugin')>(),corePlugin:{build(){}}}));
beforeEach(()=>{setDefaultContext(new AppContext());setPlatform(nodeAdapter);});

function fixture(){
    const module=createMockModule(),registry=module.getRegistry();
    const release=vi.fn(),shutdown=vi.fn();registry.delete=release;
    Object.assign(module,{Registry:function(){return registry;},initRenderer:vi.fn(()=>true),shutdownRenderer:shutdown});
    return{module,registry,release,shutdown};
}

describe('App registry ownership',()=>{
    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory deletes its own registry once even when preserving the renderer',(_name,factory)=>{
        const f=fixture(),app=factory(f.module);
        f.release.mockImplementation(()=>expect(app.world.hasCpp).toBe(false));
        app.world.spawn();app.quit({keepRenderer:true});app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();expect(app.world.entityCount()).toBe(0);
    });

    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory releases ownership when plugin construction throws',(_name,factory)=>{
        const f=fixture(),cleanup=vi.fn(),failure=new Error('plugin build failed');
        expect(()=>factory(f.module,{plugins:[{build(){},cleanup},{build(){throw failure;}}]})).toThrow(failure);
        expect(cleanup).toHaveBeenCalledTimes(1);expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();
    });

    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory releases a registry rejected by strict binding verification',(_name,factory)=>{
        const f=fixture();Object.assign(f.registry,{addSprite:undefined});
        expect(()=>factory(f.module)).toThrow(/Sprite/);expect(f.release).toHaveBeenCalledTimes(1);
    });

    it('web initialization failure releases the registry and retains the original renderer error',()=>{
        const f=fixture(),failure=new Error('renderer failed');Object.assign(f.module,{initRenderer(){throw failure;}});
        expect(()=>createWebApp(f.module)).toThrow(failure);expect(f.release).toHaveBeenCalledTimes(1);
    });

    it.each(['default','gl-context','glx'] as const)('%s renderer refusal aborts before project plugins and releases only its registry',kind=>{
        const f=fixture(),build=vi.fn();
        Object.assign(f.module,{initRenderer:vi.fn(()=>false),initRendererWithContext:vi.fn(()=>false)});
        const renderSurface=kind==='default'?{kind:'default' as const}:{kind:'gl-context' as const,handle:73,glx:kind==='glx'};
        expect(()=>createWebApp(f.module,{renderSurface,plugins:[{build}]})).toThrow(/WebGL2 renderer initialization failed/);
        expect(build).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.shutdown).not.toHaveBeenCalled();
        if(kind!=='default')expect(f.module.initRendererWithContext).toHaveBeenCalledWith(73);
    });

    it.each(['default','gl-context','glx'] as const)('%s successful renderer initializes plugins and preserves the shared renderer on quit',kind=>{
        const f=fixture(),build=vi.fn();
        Object.assign(f.module,{initRendererWithContext:vi.fn(()=>true)});
        const renderSurface=kind==='default'?{kind:'default' as const}:{kind:'gl-context' as const,handle:73,glx:kind==='glx'};
        const app=createWebApp(f.module,{renderSurface,plugins:[{build}]});
        expect(build).toHaveBeenCalledTimes(1);app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();
    });

    it('a failed verification retains its diagnostic even when registry deletion throws',()=>{
        const f=fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});Object.assign(f.registry,{addSprite:undefined});f.release.mockImplementation(()=>{throw Error('destructor failure');});
        try{expect(()=>createHeadlessApp(f.module)).toThrow(/Sprite/);expect(f.release).toHaveBeenCalledTimes(1);}
        finally{warn.mockRestore();}
    });

    it('an external borrowed registry survives quit and can connect to another App',()=>{
        const f=fixture(),app=App.new();app.connectCpp(f.registry,f.module);app.world.spawn();app.quit({keepRenderer:true});
        expect(f.release).not.toHaveBeenCalled();const next=App.new();next.connectCpp(f.registry,f.module);
        expect(next.world.valid(next.world.spawn())).toBe(true);next.quit({keepRenderer:true});expect(f.release).not.toHaveBeenCalled();
    });

    it('owned registry disposal is reentrant, attempted once, and cannot reconnect during quit',()=>{
        const f=fixture(),app=App.new(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
        app.connectCpp(f.registry,f.module,{ownedRegistry:true});
        f.release.mockImplementation(()=>{expect(app.world.hasCpp).toBe(false);app.quit({keepRenderer:true});expect(()=>app.connectCpp(f.registry,f.module)).toThrow(/while App.quit/);throw Error('destructor failure');});
        try{app.quit({keepRenderer:true});app.quit({keepRenderer:true});expect(f.release).toHaveBeenCalledTimes(1);expect(app.world.hasCpp).toBe(false);}
        finally{warn.mockRestore();}
    });

    it('replacing a live owned registry is rejected before touching either instance',()=>{
        const f=fixture(),other=fixture(),app=App.new();app.connectCpp(f.registry,f.module,{ownedRegistry:true});
        expect(()=>app.connectCpp(other.registry,other.module)).toThrow(/before replacing/);
        expect(app.world.getCppRegistry()).toBe(f.registry);expect(f.release).not.toHaveBeenCalled();expect(other.release).not.toHaveBeenCalled();
        app.quit({keepRenderer:true});app.connectCpp(other.registry,other.module,{ownedRegistry:true});app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(other.release).toHaveBeenCalledTimes(1);
    });
});
