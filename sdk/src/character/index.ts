// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The `esengine/character-shaders` subpath. Importing it INSTALLS the Hair, Skin and Eye built-in shaders a character model's materials use. A package whose content
 * uses none of them imports nothing and carries none.
 */
import { registerCharacterShaders } from './characterSupport';

registerCharacterShaders();

export { CHARACTER_SHADER_TEMPLATES } from './characterShaders';
