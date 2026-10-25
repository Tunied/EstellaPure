// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    movers.ts
 * @brief   What the ground is made for: every moving 3D body and every character, where they stand in the world.
 */
import type { App } from '../app/app';
import { getComponent, Transform, type TransformData } from '../ecs/component';
import type { ChunkSource } from '../residency/chunks';

/** Where what collides with the ground is: every moving 3D body and every character. */
export function movers(app: App): ChunkSource[] {
    const world = app.world;
    world.ensureTransformsComposed();
    const out: ChunkSource[] = [];
    // By name: a project without 3D physics has neither component, and the terrain must not carry the solver to look for them.
    const rigid = getComponent('RigidBody3D'), character = getComponent('CharacterController3D');
    if (rigid) {
        for (const e of world.getEntitiesWithComponents([rigid, Transform])) {
            const body = world.get(e, rigid) as { enabled: boolean; bodyType: number };
            if (!body.enabled || body.bodyType === 0) continue;
            const p = (world.get(e, Transform) as TransformData).worldPosition;
            out.push({ x: p.x, y: p.y, z: p.z });
        }
    }
    if (character) {
        for (const e of world.getEntitiesWithComponents([character, Transform])) {
            const p = (world.get(e, Transform) as TransformData).worldPosition;
            out.push({ x: p.x, y: p.y, z: p.z });
        }
    }
    return out;
}
