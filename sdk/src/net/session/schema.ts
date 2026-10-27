// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    schema.ts
 * @brief   Small runtime validators that also give the TypeScript type. A server
 *          never trusts what a client sent, so each request is parsed against the
 *          same definition the client's types came from — written once.
 */

/** Thrown by `parse` with the path of the first thing that was wrong. */
export class SchemaError extends Error {
    constructor(readonly path: string, message: string) {
        super(path ? `${path}: ${message}` : message);
        this.name = 'SchemaError';
    }
}

export interface Schema<T> {
    /** Returns a clean copy of `value` typed as `T`, or throws {@link SchemaError}. */
    parse(value: unknown, path?: string): T;
    /** A stable text form, so two builds can tell whether they agree on the shape. */
    describe(): string;
}

/** The TypeScript type a schema parses to. */
export type Infer<S> = S extends Schema<infer T> ? T : never;

const fail = (path: string, message: string): never => { throw new SchemaError(path, message); };
const at = (path: string, key: string | number): string => (path ? `${path}.${key}` : String(key));

const NO_PROTO = new Set(['__proto__', 'constructor', 'prototype']);

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type Flat<T> = { [K in keyof T]: T[K] };
type ObjectOf<S extends Shape> =
    Flat<{ [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }>;

export const s = {
    string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Schema<string> {
        const max = opts.max ?? 1024;
        return {
            parse(v, path = '') {
                if (typeof v !== 'string') return fail(path, 'expected a string');
                if (v.length < (opts.min ?? 0)) return fail(path, `shorter than ${opts.min}`);
                if (v.length > max) return fail(path, `longer than ${max}`);
                if (opts.pattern && !opts.pattern.test(v)) return fail(path, 'does not match the required pattern');
                return v;
            },
            describe: () => `string(${opts.min ?? 0}..${max}${opts.pattern ? `,/${opts.pattern.source}/` : ''})`,
        };
    },

    int(opts: { min?: number; max?: number } = {}): Schema<number> {
        const min = opts.min ?? Number.MIN_SAFE_INTEGER;
        const max = opts.max ?? Number.MAX_SAFE_INTEGER;
        return {
            parse(v, path = '') {
                if (typeof v !== 'number' || !Number.isSafeInteger(v)) return fail(path, 'expected an integer');
                if (v < min || v > max) return fail(path, `outside ${min}..${max}`);
                return v;
            },
            describe: () => `int(${min}..${max})`,
        };
    },

    number(opts: { min?: number; max?: number } = {}): Schema<number> {
        const min = opts.min ?? -Infinity;
        const max = opts.max ?? Infinity;
        return {
            parse(v, path = '') {
                if (typeof v !== 'number' || !Number.isFinite(v)) return fail(path, 'expected a finite number');
                if (v < min || v > max) return fail(path, `outside ${min}..${max}`);
                return v;
            },
            describe: () => `number(${min}..${max})`,
        };
    },

    boolean(): Schema<boolean> {
        return {
            parse: (v, path = '') => (typeof v === 'boolean' ? v : fail(path, 'expected a boolean')),
            describe: () => 'boolean',
        };
    },

    literal<const T extends string | number | boolean | null>(value: T): Schema<T> {
        return {
            parse: (v, path = '') => (v === value ? (v as T) : fail(path, `expected ${JSON.stringify(value)}`)),
            describe: () => `literal(${JSON.stringify(value)})`,
        };
    },

    /** One of a fixed list of strings. */
    enum<const T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> {
        const set = new Set<string>(values);
        return {
            parse: (v, path = '') => (typeof v === 'string' && set.has(v) ? (v as T[number]) : fail(path, `expected one of ${values.join(', ')}`)),
            describe: () => `enum(${values.join('|')})`,
        };
    },

    array<T>(item: Schema<T>, opts: { max?: number } = {}): Schema<T[]> {
        const max = opts.max ?? 256;
        return {
            parse(v, path = '') {
                if (!Array.isArray(v)) return fail(path, 'expected an array');
                if (v.length > max) return fail(path, `more than ${max} items`);
                return v.map((x, i) => item.parse(x, at(path, i)));
            },
            describe: () => `array(${item.describe()},max ${max})`,
        };
    },

    /** An object with exactly these keys; any other key in the input is dropped. */
    object<S extends Shape>(shape: S): Schema<ObjectOf<S>> {
        const keys = Object.keys(shape);
        for (const k of keys) if (NO_PROTO.has(k)) throw new Error(`[schema] "${k}" cannot be a key`);
        return {
            parse(v, path = '') {
                if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'expected an object');
                const input = v as Record<string, unknown>;
                const out: Record<string, unknown> = {};
                for (const k of keys) {
                    const value = shape[k]!.parse(Object.prototype.hasOwnProperty.call(input, k) ? input[k] : undefined, at(path, k));
                    if (value !== undefined) out[k] = value;
                }
                return out as ObjectOf<S>;
            },
            describe: () => `{${keys.map((k) => `${k}:${shape[k]!.describe()}`).join(',')}}`,
        };
    },

    /** An object used as a map from string keys to one kind of value. */
    record<T>(value: Schema<T>, opts: { maxKeys?: number } = {}): Schema<Record<string, T>> {
        const maxKeys = opts.maxKeys ?? 256;
        return {
            parse(v, path = '') {
                if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'expected an object');
                const keys = Object.keys(v);
                if (keys.length > maxKeys) return fail(path, `more than ${maxKeys} keys`);
                const out: Record<string, T> = {};
                for (const k of keys) {
                    if (NO_PROTO.has(k)) return fail(at(path, k), 'key not allowed');
                    out[k] = value.parse((v as Record<string, unknown>)[k], at(path, k));
                }
                return out;
            },
            describe: () => `record(${value.describe()},max ${maxKeys})`,
        };
    },

    optional<T>(inner: Schema<T>): Schema<T | undefined> {
        return {
            parse: (v, path = '') => (v === undefined ? undefined : inner.parse(v, path)),
            describe: () => `optional(${inner.describe()})`,
        };
    },

    nullable<T>(inner: Schema<T>): Schema<T | null> {
        return {
            parse: (v, path = '') => (v === null ? null : inner.parse(v, path)),
            describe: () => `nullable(${inner.describe()})`,
        };
    },

    /** Anything JSON can carry. Use sparingly: nothing about it is checked. */
    unknown(): Schema<unknown> {
        return { parse: (v) => v, describe: () => 'unknown' };
    },
};
