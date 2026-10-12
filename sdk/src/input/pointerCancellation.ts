// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
const cancelled = new WeakSet<object>();
const versions = new WeakMap<object, number>();

/** Keep cancellation until the next UI pointer sample, even across a frame-edge clear. */
export function cancelPrimaryPointer(input: object): void {
    cancelled.add(input);
    versions.set(input, primaryPointerCancellationVersion(input) + 1);
}
export function takePrimaryPointerCancellation(input: object): boolean { return cancelled.delete(input); }
/** Independent consumers can observe the same cancellation after pointer sampling. */
export function primaryPointerCancellationVersion(input: object): number { return versions.get(input) ?? 0; }
