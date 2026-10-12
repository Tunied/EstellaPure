// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { setOwn } from './ownProperties';

/** Copy authored JSON data without serializing ordinary records to text first.
 * Exotic values keep JSON's conversion rules, including toJSON's property key. */
export function cloneJsonValue<T>(value: T): T {
    const ancestors = new Set<object>();
    const clone = (value: unknown, key: string, root = false, depth = 0): unknown => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
        const fallback = (): unknown => root
            ? JSON.parse(JSON.stringify(value))
            : JSON.parse(JSON.stringify({ [key]: value }))[key];
        if (typeof value !== 'object') return fallback(); // BigInt keeps JSON's rejection.
        // Let the native serializer handle deep documents rather than spend a
        // larger JS call stack on a tree JSON itself can still represent.
        if (depth >= 64) return fallback();
        const proto = Object.getPrototypeOf(value);
        const array = Array.isArray(value);
        if ('toJSON' in value || (proto !== Object.prototype && proto !== null && !(array && proto === Array.prototype))) return fallback();
        if (ancestors.has(value)) return fallback(); // Preserve the circular-data error.
        ancestors.add(value);
        try {
            if (array) {
                const length = value.length;
                const result = new Array(length);
                for (let i = 0; i < length; i++) result[i] = clone(value[i], String(i), false, depth + 1) ?? null;
                return result;
            }
            const result: Record<string, unknown> = {};
            for (const name of Object.keys(value)) {
                const next = clone((value as Record<string, unknown>)[name], name, false, depth + 1);
                if (next === undefined) continue;
                setOwn(result, name, next);
            }
            return result;
        } finally { ancestors.delete(value); }
    };
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return JSON.parse(JSON.stringify(value)) as T;
    return clone(value, '', true) as T;
}
