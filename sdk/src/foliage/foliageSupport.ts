// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  foliageSupport.ts — what a build that ships foliage tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { FoliagePlugin } from './foliagePlugin';

export function registerFoliageSupport(): void {
    addEntryPlugin('foliage', () => new FoliagePlugin());
}
