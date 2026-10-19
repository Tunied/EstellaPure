// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';
import type { Color, Entity } from '../../types';

/** Canonical RGBA value plus ordinary editable UI children. @beta */
export interface UIColorPickerData {
    color: Color;
    alphaEnabled: boolean;
    format: number;
    rememberColors: boolean;
    historyLimit: number;
    history: Color[];
    sv: Entity;
    alphaRamp: Entity;
    cursor: Entity;
    hue: Entity;
    alpha: Entity;
    fields: Entity[];
    hex: Entity;
    historyRoot: Entity;
    rememberButton: Entity;
    preview: Entity;
}

/** HSV is an editing coordinate system; values retain the engine's Color semantics. @beta */
export const UIColorPicker = defineComponent<UIColorPickerData>('UIColorPicker', {
    color: { r: 0.216, g: 0.565, b: 0.878, a: 1 }, alphaEnabled: true, format: 0,
    rememberColors: true, historyLimit: 8, history: [], sv: 0 as Entity,
    alphaRamp: 0 as Entity, cursor: 0 as Entity,
    hue: 0 as Entity, alpha: 0 as Entity, fields: [], hex: 0 as Entity,
    historyRoot: 0 as Entity, rememberButton: 0 as Entity, preview: 0 as Entity,
}, {
    entityFields: ['sv', 'alphaRamp', 'cursor', 'hue', 'alpha', 'fields', 'hex', 'historyRoot', 'rememberButton', 'preview'],
    fields: { format: { enum: [{ label: 'HSV + HEX', value: 0 }, { label: 'RGB + HEX', value: 1 }] },
        historyLimit: { min: 0, max: 32, step: 1 } },
});
