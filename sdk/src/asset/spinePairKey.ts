// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** The identity of a Spine asset: its skeleton and atlas references together. */
export function spinePairKey(skeleton: string, atlas: string): string {
    return `${skeleton}:${atlas}`;
}
