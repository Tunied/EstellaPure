// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect} from 'vitest';
import {cloneJsonValue} from '../src/util/cloneJsonValue';

describe('authored JSON copy',()=>{
    it('copies nested records and arrays without aliases, including repeated references',()=>{
        const child={axis:[1,2]},source={left:child,right:child};
        const copy=cloneJsonValue(source);expect(copy).toEqual(JSON.parse(JSON.stringify(source)));
        copy.left.axis[0]=9;expect(source.left.axis[0]).toBe(1);expect(copy.right.axis[0]).toBe(1);
    });
    it('preserves JSON omission, array holes, nonfinite numbers and signed zero rules',()=>{
        const source={undefined,fn:()=>1,symbol:Symbol(),array:[,undefined,()=>1,Symbol(),NaN,Infinity,-0],n:NaN};
        expect(cloneJsonValue(source)).toEqual(JSON.parse(JSON.stringify(source)));
        expect(Object.is(cloneJsonValue(source).array[6],-0)).toBe(false);
    });
    it('keeps dates, boxed values and key-dependent toJSON conversion',()=>{
        const keyed={toJSON(key:string){return key;}};
        const source={date:new Date('2020-01-01'),number:new Number(3),map:new Map(),item:keyed,array:[keyed,keyed]};
        expect(cloneJsonValue(source)).toEqual(JSON.parse(JSON.stringify(source)));
        expect(cloneJsonValue(keyed)).toBe('');
    });
    it('does not interpret authored __proto__ as a prototype setter',()=>{
        const source=JSON.parse('{"__proto__":{"unsafe":1},"constructor":{"x":2}}');
        const copy=cloneJsonValue(source);expect(copy).toEqual(source);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);expect(({} as any).unsafe).toBeUndefined();
    });
    it('rejects cycles and BigInt instead of sharing unrepresentable values',()=>{
        const source:any={};source.self=source;
        expect(()=>cloneJsonValue(source)).toThrow(TypeError);expect(()=>cloneJsonValue({n:1n})).toThrow(TypeError);
    });
    it('rejects an unrepresentable root but omits a nested toJSON result of undefined',()=>{
        const missing={toJSON:()=>undefined};
        expect(()=>cloneJsonValue(missing)).toThrow(SyntaxError);
        expect(cloneJsonValue({missing,array:[missing]})).toEqual({array:[null]});
    });
    it('omits inherited enumerable fields and preserves null-prototype data',()=>{
        const source=Object.assign(Object.create(null),{a:1});
        expect(cloneJsonValue(source)).toEqual(JSON.parse(JSON.stringify(source)));
        expect(cloneJsonValue(Object.create({inherited:1}))).toEqual({});
    });
    it('copies deep JSON documents without exhausting the JS recursion stack',()=>{
        let source:any={leaf:1};for(let i=0;i<2500;i++)source={next:source};
        expect(JSON.stringify(cloneJsonValue(source))).toBe(JSON.stringify(source));
    });
    it('captures array length before reading index getters, as JSON does',()=>{
        const make=()=>{const values=[1];Object.defineProperty(values,0,{get:()=>{values.push(2);return 1;}});return values;};
        expect(cloneJsonValue(make())).toEqual(JSON.parse(JSON.stringify(make())));
    });
});
