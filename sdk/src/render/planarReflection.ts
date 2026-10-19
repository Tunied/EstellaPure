// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import type { Entity } from '../types';
import { engineApi } from '../ecs/bridge/engineApi';
import { PlanarReflection } from '../ecs/component';

/** The latest capture for one surface in one view. @experimental */
export interface PlanarReflectionStatus {
    state: 'inactive' | 'budget-excluded' | 'unavailable' | 'ready';
    width?: number;
    height?: number;
    draws?: number;
    bytes?: number;
    rejected?: number;
    updated?: boolean;
}

/** View 0 is the manual/editor view; game views use their runtime camera entity. @experimental */
export function planarReflectionStatus(app: App, entity: Entity, view: Entity = 0): PlanarReflectionStatus {
    const read = engineApi(app)?.renderer_getPlanarReflectionStatus;
    if (!read) return { state: 'unavailable' };
    return JSON.parse(read(view >>> 0, entity >>> 0)) as PlanarReflectionStatus;
}

/** Refreshes an OnDemand capture through the same component mutation path as authoring. @experimental */
export function refreshPlanarReflection(app: App, entity: Entity): void {
    const value = app.world.get(entity, PlanarReflection);
    app.world.set(entity, PlanarReflection, { ...value, revision: (value.revision + 1) >>> 0 });
}
