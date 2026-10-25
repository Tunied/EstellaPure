// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    physics3dRuntime.ts
 * @brief   The 3D physics world's live state, as a resource: the module, the bodies built, the world's configuration.
 *
 * @details Apart from the plugin that fills it so that what only reads it (water's floating, a planet's gravity) need not import the plugin.
 */
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';
import type { Physics3DWasmModule } from './Physics3DModule';
import type { Physics3DConfig, PieceMap } from './Physics3DSystem';
import type { Joint3DMap } from './Physics3DJoints';

/** The live module and the promise that resolves it, for a caller that must wait. */
export interface Physics3DRuntime {
    module: Physics3DWasmModule | null;
    initPromise: Promise<unknown> | null;
    /** Entity -> body id, so a scene teardown can drop the world's population. */
    bodies: Map<Entity, number>;
    /** Entity -> character id. Characters are not bodies and are kept apart. */
    characters: Map<Entity, number>;
    /** Entity -> the joint it declared, with the bodies it was built between. */
    joints: Joint3DMap;
    /** Key -> the body built for that piece of the app's collision geometry. */
    pieces: PieceMap;
    /** The world's configuration (gravity, the scale of a world unit), for what applies forces to it. Null until the plugin is built. */
    config: Physics3DConfig | null;
}

export const Physics3DRuntime = defineResource<Physics3DRuntime>(
    { module: null, initPromise: null, bodies: new Map(), characters: new Map(),
      joints: new Map(), pieces: new Map(), config: null },
    'Physics3DRuntime',
);
