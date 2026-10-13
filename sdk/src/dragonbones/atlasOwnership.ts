// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
const pending = new WeakMap<object, () => void>();
const bound = new WeakMap<object, Map<number, () => void>>();

export function ownAtlas(info: object, release: () => void): void { pending.set(info, release); }
export function bindAtlasOwner(info: object, manager: object, handle: number): void {
    const release = pending.get(info);
    if (!release) return;
    pending.delete(info);
    let owners = bound.get(manager);
    if (!owners) bound.set(manager, owners = new Map());
    const previous = owners.get(handle);
    owners.set(handle, release);
    previous?.();
}
export function releaseAtlasOwner(manager: object, handle: number): void {
    const owners = bound.get(manager), release = owners?.get(handle);
    owners?.delete(handle);
    release?.();
}
export function releaseAllAtlasOwners(manager: object): void {
    const owners = bound.get(manager);
    bound.delete(manager);
    if (owners) for (const release of owners.values()) release();
}
export function releaseUnusedAtlases(infos: Iterable<object>): void {
    for (const info of infos) {
        const release = pending.get(info);
        pending.delete(info);
        release?.();
    }
}
