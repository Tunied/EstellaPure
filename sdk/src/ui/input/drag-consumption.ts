// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';

/** @internal A control owns its drag; enclosing scroll views still accept wheel input. */
export const UIConsumesDrag = defineComponent('UIConsumesDrag', {}, { transient: true });
