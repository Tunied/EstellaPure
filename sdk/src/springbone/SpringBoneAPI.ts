// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { Entity } from '../types';
import { defineResource } from '../ecs/resource';

/**
 * Per-app secondary-motion API. Wraps the C++ registry-scoped spring-bone system, so two App instances (editor tabs) simulate
 * independent chains.
 *
 * Consumed as a resource: declare `Res(SpringBone)` as a system param, or grab it with `app.getResource(SpringBone)`.
 */
export class SpringBoneAPI {
    private readonly module_: NonNullable<EngineApi>;
    private readonly registry_: CppRegistry;

    /** @param module whichever engine core is present (see ecs/engineApi.ts). */
    constructor(module: NonNullable<EngineApi>, registry: CppRegistry) {
        this.module_ = module;
        this.registry_ = registry;
    }

    /** Advance every chain: step the springs toward the pose the animation gave, then turn the bones to match. */
    update(dt: number): void {
        this.module_.springbone_update?.(this.registry_, dt);
    }

    /** Put a chain back at its animated pose on its next frame: a teleport, a respawn, a pose set by hand. */
    reset(root: Entity): void {
        this.module_.springbone_reset?.(this.registry_, root as number);
    }
}

/** Resource handle for the per-app spring-bone API. */
export const SpringBoneRes = defineResource<SpringBoneAPI>(null!, 'SpringBone');
