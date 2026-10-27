// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, expectTypeOf } from 'vitest';
import { s, SchemaError, type Infer } from '../src/net/session/schema';
import { defineContract } from '../src/net/session/contract';

describe('schema', () => {
    it('accepts a good value and returns a clean copy', () => {
        const shape = s.object({ id: s.string({ max: 8 }), n: s.int({ min: 1, max: 9 }), tags: s.array(s.string(), { max: 2 }) });
        const input = { id: 'abc', n: 3, tags: ['x'], extra: 'dropped' };
        const out = shape.parse(input);
        expect(out).toEqual({ id: 'abc', n: 3, tags: ['x'] });
        expect(out).not.toBe(input);
        expectTypeOf<Infer<typeof shape>>().toEqualTypeOf<{ id: string; n: number; tags: string[] }>();
    });

    it('names the path of the first problem', () => {
        const shape = s.object({ order: s.object({ qty: s.int({ min: 1 }) }) });
        expect(() => shape.parse({ order: { qty: 0 } })).toThrow('order.qty: outside 1..');
        expect(() => shape.parse({ order: { qty: 1.5 } })).toThrow('order.qty: expected an integer');
        expect(() => shape.parse(null)).toThrow(SchemaError);
    });

    it('bounds strings, arrays and records so a request cannot be made huge', () => {
        expect(() => s.string({ max: 3 }).parse('abcd')).toThrow('longer than 3');
        expect(() => s.string().parse('x'.repeat(1025))).toThrow('longer than 1024');
        expect(() => s.array(s.int()).parse(new Array(300).fill(1))).toThrow('more than 256');
        expect(() => s.record(s.int(), { maxKeys: 2 }).parse({ a: 1, b: 2, c: 3 })).toThrow('more than 2 keys');
    });

    it('refuses keys that could poison a prototype', () => {
        expect(() => s.record(s.int()).parse(JSON.parse('{"__proto__": 1}'))).toThrow('key not allowed');
        expect(() => s.object({ ['__proto__']: s.int() })).toThrow('cannot be a key');
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('optional, nullable, enum and literal behave', () => {
        const shape = s.object({ a: s.optional(s.int()), b: s.nullable(s.string()), c: s.enum(['x', 'y']), d: s.literal(1) });
        expect(shape.parse({ b: null, c: 'x', d: 1 })).toEqual({ b: null, c: 'x', d: 1 });
        expect(() => shape.parse({ b: null, c: 'z', d: 1 })).toThrow('expected one of x, y');
        expect(() => shape.parse({ b: null, c: 'x', d: 2 })).toThrow('expected 1');
        expect(() => shape.parse({ c: 'x', d: 1 })).toThrow('b: expected a string');
        expectTypeOf<Infer<typeof shape>>().toEqualTypeOf<{ a?: number | undefined; b: string | null; c: 'x' | 'y'; d: 1 }>();
    });

    it('rejects NaN and Infinity where a number is expected', () => {
        expect(() => s.number().parse(Number.NaN)).toThrow();
        expect(() => s.number().parse(Infinity)).toThrow();
        expect(() => s.int().parse(2 ** 60)).toThrow();
    });
});

const contract = defineContract({
    requests: {
        trade: { req: s.object({ offer: s.string({ max: 16 }), qty: s.int({ min: 1, max: 9 }) }), res: s.object({ paid: s.int() }) },
        ping: { req: s.object({}), res: s.literal('pong') },
    },
    events: { radio: s.object({ from: s.string(), text: s.string({ max: 200 }) }) },
});

describe('defineContract', () => {
    it('fingerprint is stable and moves with the shape', () => {
        const again = defineContract({
            requests: {
                trade: { req: s.object({ offer: s.string({ max: 16 }), qty: s.int({ min: 1, max: 9 }) }), res: s.object({ paid: s.int() }) },
                ping: { req: s.object({}), res: s.literal('pong') },
            },
            events: { radio: s.object({ from: s.string(), text: s.string({ max: 200 }) }) },
        });
        expect(again.fingerprint).toBe(contract.fingerprint);
        const changed = defineContract({ requests: { ping: { req: s.object({}), res: s.literal('pong') } } });
        expect(changed.fingerprint).not.toBe(contract.fingerprint);
        expect(contract.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    });

    it('types the client from the definition', () => {
        type Client = ReturnType<typeof contract.client>;
        expectTypeOf<Parameters<Client['trade']>[0]>().toEqualTypeOf<{ offer: string; qty: number }>();
        expectTypeOf<ReturnType<Client['trade']>>().toEqualTypeOf<Promise<{ paid: number }>>();
        expectTypeOf<ReturnType<Client['ping']>>().toEqualTypeOf<Promise<'pong'>>();
    });
});
