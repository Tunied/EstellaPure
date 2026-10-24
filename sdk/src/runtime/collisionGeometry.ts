// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    collisionGeometry.ts
 * @brief   Static triangles made while the game runs, for the physics world to collide with: tiles of terrain, and the like.
 *
 * @details A system that makes ground or walls as it goes (the terrain round what moves on it) puts its triangles here under keys of
 *          its own; the 3D physics world, when there is one, keeps one static body a piece and follows the pieces as they are set,
 *          replaced and deleted. Neither side knows the other: a server without physics still makes the pieces, and physics needs no
 *          terrain module. A piece is replaced whole, by setting a new object under its key.
 */
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';

/** One piece of static geometry, in world units. */
export interface CollisionPiece {
    /** The entity the piece belongs to: what a contact or a ray that hits it reports. */
    owner: Entity;
    /** Where the piece's positions are measured from, in the world. */
    origin: readonly [number, number, number];
    /** `vertexCount * 3` floats, relative to `origin`. */
    positions: Float32Array;
    /** Three a triangle, counter-clockwise seen from the side that faces out. */
    indices: Uint32Array;
    friction: number;
    restitution: number;
    /** The collision layer (0 to 15). */
    layer: number;
}

/** The pieces now, by key. */
export class CollisionGeometry {
    private readonly pieces_ = new Map<string, CollisionPiece>();
    /** Bumped on every change, so a reader can skip a frame where nothing changed. */
    revision = 0;

    set(key: string, piece: CollisionPiece): void {
        this.pieces_.set(key, piece);
        this.revision++;
    }

    delete(key: string): void {
        if (this.pieces_.delete(key)) this.revision++;
    }

    get(key: string): CollisionPiece | undefined {
        return this.pieces_.get(key);
    }

    /** Deletes every piece whose key starts with `prefix`. */
    deleteAll(prefix: string): void {
        for (const key of [...this.pieces_.keys()]) if (key.startsWith(prefix)) this.delete(key);
    }

    entries(): IterableIterator<[string, CollisionPiece]> {
        return this.pieces_.entries();
    }

    get size(): number {
        return this.pieces_.size;
    }
}

export const CollisionGeometryRes = defineResource<CollisionGeometry>(new CollisionGeometry(), 'CollisionGeometry');

/** The app's collision geometry, installed on first use. */
export function collisionGeometryOf(app: App): CollisionGeometry {
    if (!app.hasResource(CollisionGeometryRes)) app.insertResource(CollisionGeometryRes, new CollisionGeometry());
    return app.getResource(CollisionGeometryRes);
}
