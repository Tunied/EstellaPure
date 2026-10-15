// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { worldEngineApi } from '../ecs/bridge/engineApi';
import { withMalloc } from '../wasm/wasmScratch';
import { ENTITY_POSE_2D_WORDS } from '../wasm/constants.generated';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';

/** Transfer composed candidates in one batch. The native host shares its arena;
 * standalone wasm modules copy only the populated pose rows between heaps. */
export function batchStaticPoses2D(world: World, module: PhysicsWasmModule, entities: readonly Entity[],
                                 ppu: number, enabled: (entity: Entity) => boolean): boolean {
    const core = worldEngineApi(world), registry = world.getCppRegistry();
    if (!core?.registry_readWorldPoses2D || !core._malloc || !core._free || !core.HEAPU32 || !core.HEAPU8
        || !module._physics_setBodyTransforms || !registry) return false;
    if (!entities.length) return true;
    const bytes = ENTITY_POSE_2D_WORDS * 4;
    return withMalloc({ _malloc: core._malloc.bind(core), _free: core._free.bind(core) }, entities.length * (4 + bytes), ptr => {
        if (!ptr) return false;
        let count = 0;
        for (const entity of entities) if (enabled(entity)) core.HEAPU32![(ptr >>> 2) + count++] = entity;
        if (!count) return true;
        const output = ptr + entities.length * 4;
        const rows = core.registry_readWorldPoses2D!(registry, ptr, count, output);
        if (!Number.isInteger(rows) || rows < 0 || rows > count) throw new Error('Invalid world pose batch length');
        if (!rows) return true;
        if (core.HEAPU8!.buffer === module.HEAPU8.buffer) {
            module._physics_setBodyTransforms!(output, rows, ppu);
            return true;
        }
        return withMalloc(module, rows * bytes, target => {
            if (!target) return false;
            module.HEAPU8.set(core.HEAPU8!.subarray(output, output + rows * bytes), target);
            module._physics_setBodyTransforms!(target, rows, ppu);
            return true;
        });
    });
}
