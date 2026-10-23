// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  characterSupport.ts — what a build that ships the character shaders tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { registerBuiltinShaderTemplate } from '../render/builtinShaders';
import { CHARACTER_SHADER_TEMPLATES } from './characterShaders';

export function registerCharacterShaders(): void {
    for (const template of CHARACTER_SHADER_TEMPLATES) registerBuiltinShaderTemplate(template);
}
