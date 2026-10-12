import {afterEach,describe,it,expect,vi} from 'vitest';
import {AotEvents} from '../src/ecs/aot/AotEvents';
import type {PoolMemory} from '../src/ecs/ScriptPool';
const originalValue=Object.getOwnPropertyDescriptor(Object.prototype,'value');
afterEach(()=>{
    if(originalValue)Object.defineProperty(Object.prototype,'value',originalValue);
    else delete (Object.prototype as Record<string,unknown>).value;
});

function fixture(payloads:unknown[]=[]){
    const buffer=new ArrayBuffer(4096);let offset=8;
    const memory:PoolMemory={alloc(bytes){const at=offset;offset+=bytes;return{buffer,byteOffset:at,byteLength:bytes};},release(){}};
    const send=vi.fn(),events=new AotEvents(memory,()=>({read:()=>payloads,send}));
    return{buffer,send,events};
}
describe('compiled event own fields',()=>{
    it('preserves explicit prototype-named scalar fields as data',()=>{
        const {events,send}=fixture();events.send('Probe',['__proto__','constructor','toString'],[3,4,5]);
        const payload=send.mock.calls[0]![0];
        expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
        expect(JSON.stringify(payload)).toBe('{"__proto__":3,"constructor":4,"toString":5}');
    });
    it('creates nested own prototype fields without changing global prototypes',()=>{
        const key='__estellaAotEventOwnFieldProbe',prototype=Object.prototype as Record<string,unknown>;
        expect(Object.hasOwn(prototype,key)).toBe(false);
        try {
            const {events,send}=fixture();events.send('Probe',['__proto__.'+key,'nested.__proto__.value'],[7,9]);
            expect(Object.hasOwn(prototype,key)).toBe(false);
            expect(JSON.stringify(send.mock.calls[0]![0])).toBe('{"__proto__":{"'+key+'":7},"nested":{"__proto__":{"value":9}}}');
        }finally{delete prototype[key];delete prototype.value;}
    });
    it('round trips own nested fields and booleans through compiled rows',()=>{
        const payload=JSON.parse('{"__proto__":{"value":7},"nested":{"constructor":true}}');
        const {events,buffer,send}=fixture([payload]);
        const fields=['__proto__.value','nested.constructor'],rows=events.rowsFor('Probe',fields),values=[...new Float64Array(buffer,rows[0]![1],2)];
        expect(values).toEqual([7,1]);events.send('Probe',fields,values);
        expect(JSON.stringify(send.mock.calls[0]![0])).toBe('{"__proto__":{"value":7},"nested":{"constructor":1}}');events.release();
    });
    it('reads inherited values as absent without invoking inherited getters',()=>{
        const inherited=vi.fn(()=>13),base=Object.create(null);Object.defineProperty(base,'value',{get:inherited});
        const {events,buffer}=fixture([Object.create(base)]),rows=events.rowsFor('Probe',['value']);
        expect(new Float64Array(buffer,rows[0]![1],1)[0]).toBe(0);expect(inherited).not.toHaveBeenCalled();events.release();
    });
});
