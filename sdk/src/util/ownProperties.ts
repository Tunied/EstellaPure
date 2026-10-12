// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** ES-compatible own-field lookup for schema records, including null prototypes. */
export function hasOwn(value: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

/** Write a data member on a fresh record without invoking __proto__'s setter. */
export function setOwn(value: Record<string, unknown>, key: string, data: unknown): void {
    if (key === '__proto__') {
        Object.defineProperty(value, key, { value: data, enumerable: true, writable: true, configurable: true });
    } else value[key] = data;
}
