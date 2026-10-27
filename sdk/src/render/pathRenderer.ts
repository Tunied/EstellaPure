// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pathRenderer.ts
 * @brief Drawing a path on an entity: the points in, a MeshRenderer's geometry out.
 *
 * The geometry belongs to the entity's MeshRenderer, so a path sorts, batches and clips like any other renderable and a scene saves it as the
 * mesh geometry it is. To change a path, call {@link setPath} again with the new points: the mesh is rebuilt and uploaded, which costs the
 * tessellation of the path and nothing while it stands still.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import type { Vec2 } from '../types';
import { MeshRenderer } from '../ecs/component';
import { MeshRenderers } from './meshRenderer';
import { buildPathGeometry, type PathStyle } from './vectorPath';

/**
 * Draws `points` as a path on `entity`, giving it a MeshRenderer if it has none. An empty result (a stroke of one point) clears what was drawn.
 * @experimental
 */
export function setPath(app: App, entity: Entity, points: readonly Vec2[], style: PathStyle): void {
    const world = app.world;
    if (!world.has(entity, MeshRenderer)) world.insert(entity, MeshRenderer, { enabled: true });
    const api = app.getResource(MeshRenderers);
    const geometry = buildPathGeometry(points, style);
    if (geometry.indices.length === 0) api.clearGeometry(entity);
    else api.setGeometry(entity, geometry);
}

/** Stops drawing the path on `entity` (its MeshRenderer stays). @experimental */
export function clearPath(app: App, entity: Entity): void {
    app.getResource(MeshRenderers).clearGeometry(entity);
}
