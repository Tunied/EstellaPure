// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  terrainSupport.ts — what a build that ships terrain tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { TerrainPlugin } from './terrainPlugin';

export function registerTerrainSupport(): void {
    addEntryPlugin('terrain', () => new TerrainPlugin());
}
