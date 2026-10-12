// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
const cancelled = new WeakSet<object>();

/** Keep cancellation until the next UI pointer sample, even across a frame-edge clear. */
export function cancelPrimaryPointer(input: object): void { cancelled.add(input); }
export function takePrimaryPointerCancellation(input: object): boolean { return cancelled.delete(input); }
