// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  worldgenSupport.ts — what a build that ships generated worlds tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { WorldGenPlugin } from './worldgenPlugin';
import { WorldRulesAssetLoader } from './rulesAsset';

export function registerWorldGenSupport(): void {
    addEntryPlugin('worldgen', () => new WorldGenPlugin());
    addAssetLoader('worldgen', () => new WorldRulesAssetLoader());
}
