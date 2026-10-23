// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  waterSupport.ts — what a build that ships water tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { WaterPlugin } from './waterPlugin';
import { FloatingPlugin } from './floating';

export function registerWaterSupport(): void {
    addEntryPlugin('water', () => new WaterPlugin());
    addEntryPlugin('floating', () => new FloatingPlugin());
}
