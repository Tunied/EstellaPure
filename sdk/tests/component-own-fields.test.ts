// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect,vi} from 'vitest';
import {defineComponent,mergeIntoDefaults,Sprite} from '../src/ecs/component';
import {validateComponentData} from '../src/util/validation';
import {World} from '../src/ecs/world';
import {BuiltinBridge} from '../src/ecs/bridge/BuiltinBridge';
import type {CppRegistry} from '../src/wasm';
import {applyOverrides} from '../src/prefab/override';
import {diffEntities} from '../src/prefab/diff';
import {deepClone} from '../src/util/deepClone';

describe('component schemas and own authored fields',()=>{
    it('default/resource deep copying keeps __proto__ as independent data',()=>{
        const source=JSON.parse('{"__proto__":{"flag":1},"nested":{"values":[1,2]}}');
        const copy=deepClone(source);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(copy,'__proto__')).toBe(true);
        copy.__proto__.flag=9;expect(source.__proto__.flag).toBe(1);
    });
    it('a root __proto__ remains data without changing shared object prototypes',()=>{
        const key='__estellaOwnFieldsAudit';
        const patch=JSON.parse('{"__proto__":{"__estellaOwnFieldsAudit":7}}');
        try{
            const result=mergeIntoDefaults({position:{x:0,y:0}},patch);
            expect(Object.prototype.hasOwnProperty.call(Object.prototype,key)).toBe(false);
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(result,'__proto__')).toBe(true);
        }finally{Reflect.deleteProperty(Object.prototype,key);}
    });
    it('a nested __proto__ stays an own field and never becomes the vector prototype',()=>{
        const result=mergeIntoDefaults({position:{x:0,y:0}},JSON.parse('{"position":{"__proto__":{"probe":7},"x":3}}'));
        expect(Object.getPrototypeOf(result.position)).toBe(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(result.position,'__proto__')).toBe(true);
        expect(result.position.x).toBe(3);expect(result.position.y).toBe(0);
    });
    it('inherited Object members cannot masquerade as declared schema fields',()=>{
        const data={constructor:Object,toString:Object.prototype.toString};
        expect(validateComponentData('Probe',{count:0},data).map(e=>e.field)).toEqual(['constructor','toString']);
        expect(validateComponentData('Probe',{count:0},JSON.parse('{"__proto__":{"flag":1}}')).map(e=>e.field)).toEqual(['__proto__']);
    });
    it('replicated fields cannot name inherited defaults',()=>{
        expect(()=>defineComponent('OwnFieldReplicationProbe',{count:0},{replicatedFields:['constructor']})).toThrow(/unknown field/);
    });
    it('renderable metadata cannot name an inherited boolean',()=>{
        const defaults=Object.assign(Object.create({ghost:true}),{count:0});
        expect(()=>defineComponent('OwnFieldRenderableProbe',defaults,{renderableField:'ghost'})).toThrow(/not a boolean field/);
    });
    it('property and metadata overrides write __proto__ as authored data',()=>{
        const entity={prefabEntityId:'root',name:'root',visible:true,components:[{type:'Probe',data:{}}],metadata:{}};
        applyOverrides(entity,[{prefabEntityId:'root',type:'property',componentType:'Probe',propertyName:'__proto__',value:{probe:1}},{prefabEntityId:'root',type:'metadata_set',metadataKey:'__proto__',value:{probe:2}}]);
        for(const value of [entity.components[0].data,entity.metadata]){
            expect(Object.getPrototypeOf(value)).toBe(Object.prototype);expect(Object.prototype.hasOwnProperty.call(value,'__proto__')).toBe(true);
        }
    });
    it('metadata removal does not mistake inherited constructor for an instance value',()=>{
        const baseline={prefabEntityId:'root',name:'root',visible:true,components:[],metadata:{constructor:3}};
        const instance={prefabEntityId:'root',id:0,name:'root',parent:null,children:[],visible:true,components:[],metadata:{}};
        expect(diffEntities([baseline],[instance]).overrides).toContainEqual({prefabEntityId:'root',type:'metadata_removed',metadataKey:'constructor'});
    });
    it('prefab diff compares own key sets instead of matching an inherited __proto__',()=>{
        const baseline={prefabEntityId:'root',name:'root',visible:true,components:[{type:'Probe',data:{payload:JSON.parse('{"__proto__":{}}')}}]};
        const instance={prefabEntityId:'root',id:0,name:'root',parent:null,children:[],visible:true,components:[{type:'Probe',data:{payload:{other:{}}}}]};
        expect(diffEntities([baseline],[instance]).overrides).toContainEqual({prefabEntityId:'root',type:'property',componentType:'Probe',propertyName:'payload',value:{other:{}}});
    });
    it('nested merging preserves own enumerable symbols and defaults without aliases',()=>{
        const symbol=Symbol('probe'),defaults={vector:{x:0,y:0}},patch={vector:{x:2,[symbol]:3}};
        const merged=mergeIntoDefaults<{vector:{x:number;y?:number}}>(defaults,patch);
        expect((merged.vector as any)[symbol]).toBe(3);expect(merged.vector).toMatchObject({x:2,y:0});
        merged.vector.y=9;expect(defaults.vector.y).toBe(0);
    });
    it('script insertion validates __proto__ instead of losing it during filtering',()=>{
        const comp=defineComponent('OwnFieldScriptProbe',{count:0}),world=new World(),entity=world.spawn();
        expect(()=>world.insert(entity,comp,JSON.parse('{"__proto__":{"flag":1},"count":2}'))).toThrow(/__proto__/);
        expect(world.has(entity,comp)).toBe(false);
    });
    it('builtin filtering keeps only fields owned by its declared defaults',()=>{
        const addSprite=vi.fn(),bridge=new BuiltinBridge();
        bridge.connect({hasSprite:()=>false,addSprite,getSprite:()=>({}),removeSprite:()=>{}} as unknown as CppRegistry);
        bridge.insert(1 as never,Sprite,{constructor:Object} as never);
        const payload=addSprite.mock.calls[0][1];
        expect(Object.prototype.hasOwnProperty.call(payload,'constructor')).toBe(false);
    });
    it('explicit own constructor and __proto__ fields remain usable and type checked',()=>{
        const defaults=JSON.parse('{"constructor":0,"__proto__":{"x":0}}');
        const comp=defineComponent('OwnFieldExplicitProbe',defaults,{replicatedFields:['constructor']});
        const world=new World(),entity=world.spawn();
        world.insert(entity,comp,JSON.parse('{"constructor":3,"__proto__":{"x":4}}'));
        const data=world.get(entity,comp);
        expect(data.constructor).toBe(3);expect(Object.prototype.hasOwnProperty.call(data,'__proto__')).toBe(true);
        expect(data.__proto__.x).toBe(4);expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
        expect(validateComponentData('Probe',defaults,JSON.parse('{"__proto__":{"x":"wrong"}}')).map(e=>e.field)).toEqual(['__proto__.x']);
    });
});
