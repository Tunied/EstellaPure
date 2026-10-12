// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect,vi} from 'vitest';
import {validateComponentData,assetFieldNames} from '../src/util/validation';
import {defineComponent,Sprite} from '../src/ecs/component';
import {World} from '../src/ecs/world';
import {BuiltinBridge} from '../src/ecs/bridge/BuiltinBridge';
import type {CppRegistry} from '../src/wasm';

describe('component asset validation reads current metadata',()=>{
    it('list and Set metadata preserve the same type errors and asset exceptions',()=>{
        const fields=[{field:'texture'}],defaults={texture:0,count:0,nested:{texture:0}};
        const data={texture:'@uuid:texture',count:'bad',nested:{texture:'bad'}};
        const listErrors=validateComponentData('Probe',defaults,data,fields);
        expect(listErrors.map(e=>e.field)).toEqual(['count','nested.texture']);
        expect(listErrors).toEqual(validateComponentData('Probe',defaults,data,new Set(['texture'])));
        expect(assetFieldNames({assetFields:fields})).toEqual(new Set(['texture']));
    });
    it('metadata edits take effect without changing the component identity',()=>{
        const fields=[{field:'texture',type:'texture' as const}],comp=defineComponent('CurrentAssetMetadataProbe',{texture:0,other:0},{assetFields:fields});
        const w=new World(),entity=w.spawn();
        w.insert(entity,comp,{texture:'@uuid:texture'} as never);
        fields[0].field='other';
        expect(()=>w.insert(entity,comp,{texture:'@uuid:texture'} as never)).toThrow(/texture/);
        w.insert(entity,comp,{other:'@uuid:other'} as never);
        expect(w.get(entity,comp).other).toBe('@uuid:other');
        fields.length=0;
        expect(()=>w.insert(entity,comp,{other:'@uuid:other'} as never)).toThrow(/other/);
    });
    it('builtin asset strings stay legal while unrelated strings are rejected',()=>{
        const addSprite=vi.fn(),bridge=new BuiltinBridge();
        bridge.connect({hasSprite:()=>false,addSprite,getSprite:()=>({}),removeSprite:()=>{}} as unknown as CppRegistry);
        bridge.insert(1 as never,Sprite,{texture:'@uuid:texture'} as never);
        expect(addSprite.mock.calls[0][1].texture).toBe('@uuid:texture');
        expect(()=>bridge.insert(1 as never,Sprite,{layer:'bad'} as never)).toThrow(/layer/);
        expect(addSprite).toHaveBeenCalledTimes(1);
    });
    it('metadata array replacement immediately updates strict script insertion',()=>{
        const comp=defineComponent('ReplacedAssetMetadataProbe',{source:0},{assetFields:[]}),w=new World(),entity=w.spawn();
        expect(()=>w.insert(entity,comp,{source:'@uuid:source'} as never)).toThrow(/source/);
        Object.defineProperty(comp,'assetFields',{value:[{field:'source',type:'texture'}],configurable:true});
        w.insert(entity,comp,{source:'@uuid:source'} as never);
        expect(w.get(entity,comp).source).toBe('@uuid:source');
    });
    it('only string/number asset mismatches are exempt',()=>{
        const fields=[{field:'texture'}];
        expect(validateComponentData('Probe',{texture:0},{texture:false},fields).map(e=>e.field)).toEqual(['texture']);
        expect(validateComponentData('Probe',{texture:0},{texture:{}},fields).map(e=>e.field)).toEqual(['texture']);
        expect(validateComponentData('Probe',{texture:''},{texture:7},fields)).toEqual([]);
    });
    it('pooled asset references survive live writes, growth, delete and slot reuse',()=>{
        const comp=defineComponent('PooledAssetReferenceProbe',{texture:0,count:0},{assetFields:[{field:'texture',type:'texture'}]}),w=new World();
        const entity=w.spawn();w.insert(entity,comp,{texture:'@uuid:first',count:7} as never);
        const view=w.get(entity,comp),address=w.addressResolver(comp),epoch=w.scriptLayoutEpoch();
        expect(view.texture).toBe('@uuid:first');expect(address(entity)).toBeUndefined();
        (view as unknown as {texture:unknown}).texture=11;
        w.set(entity,comp,view);
        expect(address(entity)).toBeDefined();expect(w.scriptLayoutEpoch()).toBeGreaterThan(epoch);
        (view as unknown as {texture:unknown}).texture='@uuid:second';
        w.set(entity,comp,view);
        expect(address(entity)).toBeUndefined();
        for(let i=0;i<70;i++)w.insert(w.spawn(),comp,{texture:i,count:i});
        expect(view.texture).toBe('@uuid:second');expect(view.count).toBe(7);
        w.despawn(entity);const next=w.spawn();w.insert(next,comp,{texture:13,count:3});
        expect(w.get(next,comp).texture).toBe(13);expect(address(next)).toBeDefined();
    });
    it('adding asset metadata to an existing numeric pool preserves later references',()=>{
        const fields:{field:string;type:'texture'}[]=[],comp=defineComponent('PooledLateAssetMetadataProbe',{texture:0},{assetFields:fields}),w=new World(),entity=w.spawn();
        w.insert(entity,comp,{texture:5});const at=w.addressResolver(comp);expect(at(entity)).toBeDefined();
        fields.push({field:'texture',type:'texture'});w.set(entity,comp,{texture:'@uuid:late'} as never);
        expect(w.get(entity,comp).texture).toBe('@uuid:late');expect(at(entity)).toBeUndefined();
        w.set(entity,comp,{texture:9});expect(w.get(entity,comp).texture).toBe(9);expect(at(entity)).toBeDefined();
    });
    it('a row becomes addressable only after all portable refs resolve',()=>{
        const comp=defineComponent('PooledMultipleAssetReferences',{first:0,second:0},{assetFields:[{field:'first',type:'texture'},{field:'second',type:'texture'}]}),w=new World(),entity=w.spawn();
        w.insert(entity,comp,{first:'@uuid:first',second:'@uuid:second'} as never);
        const data=w.get(entity,comp) as unknown as {first:unknown;second:unknown},address=w.addressResolver(comp);
        data.first=5;w.set(entity,comp,data as never);expect(address(entity)).toBeUndefined();expect(data.second).toBe('@uuid:second');
        data.second=7;w.set(entity,comp,data as never);expect(address(entity)).toBeDefined();
    });
});
