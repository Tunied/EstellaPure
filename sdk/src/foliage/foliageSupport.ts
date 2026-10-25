// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  foliageSupport.ts — what a build that ships foliage tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { registerBuiltinShaderTemplate } from '../render/builtinShaders';
import { FOLIAGE_SHADER_TEMPLATE } from './foliageShader';
import { FoliagePlugin } from './foliagePlugin';
import { PlacedFoliagePlugin } from './placedFoliage';

export function registerFoliageSupport(): void {
    registerBuiltinShaderTemplate(FOLIAGE_SHADER_TEMPLATE);
    addEntryPlugin('foliage', () => new FoliagePlugin());
    addEntryPlugin('placedFoliage', () => new PlacedFoliagePlugin());
}
