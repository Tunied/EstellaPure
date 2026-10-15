// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity, Vec2 } from '../../types';
import { worldEngineApi, type EngineApi } from '../../ecs/bridge/engineApi';

/** Invert the rendered 2D basis, including shear. Undefined permits a legacy
 * fallback; null rejects a missing, singular or nonfinite transform. */
export function createLocalTransformReader(world: World) {
    let owner: EngineApi | null = null, pointer = 0;
    let matrixHeap: Float32Array | null = null;
    const dispose = (): void => {
        const oldPointer = pointer, oldOwner = owner;
        pointer = 0; owner = null; matrixHeap = null;
        if (oldPointer) oldOwner?._free?.(oldPointer);
    };
    const read = (entity: Entity, x: number, y: number, translate: boolean): Vec2 | null | undefined => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const api = worldEngineApi(world), registry = world.getCppRegistry();
        if (owner !== api) { dispose(); owner = api; }
        if (!api?.transform_copyFlatRenderMatrix || !api.HEAPU8 || !api._malloc || !api._free || !registry) return undefined;
        if (!pointer) {
            pointer = api._malloc(64);
            if (!pointer) throw new Error('Could not allocate UI transform scratch.');
        }
        if (!api.transform_copyFlatRenderMatrix(registry, entity, pointer)) return null;
        const heap = api.HEAPU8;
        if (matrixHeap?.buffer !== heap.buffer) matrixHeap = new Float32Array(heap.buffer);
        const at = (heap.byteOffset + pointer) / 4;
        const a = matrixHeap[at], b = matrixHeap[at + 1], c = matrixHeap[at + 4], d = matrixHeap[at + 5];
        const det = a * d - b * c;
        if (!Number.isFinite(det) || det === 0) return null;
        if (translate) { x -= matrixHeap[at + 12]; y -= matrixHeap[at + 13]; }
        const localX = (d * x - c * y) / det, localY = (a * y - b * x) / det;
        return Number.isFinite(localX) && Number.isFinite(localY) ? { x: localX, y: localY } : null;
    };
    return {
        point: (entity: Entity, x: number, y: number) => read(entity, x, y, true),
        vector: (entity: Entity, x: number, y: number) => read(entity, x, y, false),
        dispose,
    };
}
