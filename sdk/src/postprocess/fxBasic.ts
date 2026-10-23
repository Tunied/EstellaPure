// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The `esengine/fx-basic` subpath. Importing it INSTALLS the shader sources of the basic post-process effects — see
 * effectSources.ts. A package that uses none of them imports nothing and carries none.
 */
import { registerBasicEffectSources } from './sources/basic';

registerBasicEffectSources();

export {};
