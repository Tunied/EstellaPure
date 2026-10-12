// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ComponentData } from './types';
import { cloneJsonValue } from '../util/cloneJsonValue';

export function cloneComponents(components: ComponentData[]): ComponentData[] {
    return components.map(c => ({
        type: c.type,
        data: cloneJsonValue(c.data),
    }));
}

export function cloneComponentData(data: Record<string, unknown>): Record<string, unknown> {
    return cloneJsonValue(data);
}

export function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return cloneJsonValue(metadata);
}
