// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  terrainSupport.ts — what a build that ships terrain tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { registerBuiltinShaderTemplate } from '../render/builtinShaders';
import { TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SHADER_TEMPLATE } from './terrainShader';
import { TerrainPlugin } from './terrainPlugin';
import { TerrainLayerAssetLoader } from './layers';

export function registerTerrainSupport(): void {
    registerBuiltinShaderTemplate(TERRAIN_SHADER_TEMPLATE);
    registerBuiltinShaderTemplate(TERRAIN_LAYERS_SHADER_TEMPLATE);
    addEntryPlugin('terrain', () => new TerrainPlugin());
    addAssetLoader('terrain', () => new TerrainLayerAssetLoader());
}
