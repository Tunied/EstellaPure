// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AssetScope, type AssetLease } from '../asset/AssetLease';
import type { SceneAssetResult } from '../asset/Assets';
import { discoverSceneAssets, type RefResolver } from '../asset/discoverAssets';
import type { EntityAssetScopes } from '../asset/entityAssetScopes';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { SceneData } from '../scene/scene';
import { spinePairKey } from '../asset/spinePairKey';

/** Resources retained before a spawn; attachment transfers them to entity scopes. */
export interface PreparedSpawnOwnership {
    attach(world: World, entities: ReadonlyMap<number, Entity>): void;
    release(): void;
}

/** Project successful acquisitions onto immutable authored entities once, at bake time. */
export function prepareSpawnOwnership(
    scene: SceneData, result: SceneAssetResult, owners: EntityAssetScopes | undefined,
    resolveRef?: RefResolver,
): (() => PreparedSpawnOwnership) | undefined {
    if (!owners || !result.acquisitions?.length) return undefined;
    const index = new Map<string, Map<string, AssetLease>>();
    for (const { type, path, lease } of result.acquisitions) {
        let paths = index.get(type);
        if (!paths) index.set(type, paths = new Map());
        paths.set(path, lease);
    }
    const sources = new Map<number, readonly AssetLease[]>();
    for (const entity of scene.entities) {
        const refs = discoverSceneAssets({ ...scene, entities: [entity] }, resolveRef);
        const selected = new Set<AssetLease>();
        // Ref-bound loaders acquire the authored name; handle-bound loaders use
        // the resolved path. Both are spellings of an actual acquisition.
        for (const buckets of [refs.byType, refs.rawByType]) {
            for (const [type, paths] of buckets) {
                const acquired = index.get(type === 'bitmap-font' ? 'font' : type);
                for (const path of paths) {
                    const lease = acquired?.get(path);
                    if (lease) selected.add(lease);
                }
            }
        }
        for (const pair of refs.spines) {
            const lease = index.get('spine')?.get(spinePairKey(pair.skeleton, pair.atlas));
            if (lease) selected.add(lease);
        }
        if (selected.size) sources.set(entity.id, [...selected]);
    }
    if (!sources.size) return undefined;
    return () => {
        const retained = new Map<number, AssetScope>();
        const release = (): void => {
            for (const scope of retained.values()) scope.releaseAll();
            retained.clear();
        };
        try {
            for (const [id, leases] of sources) {
                const scope = new AssetScope(); retained.set(id, scope);
                for (const source of leases) {
                    const lease = source.retain();
                    if (!lease) throw new Error(`Cannot spawn retired prefab: resource "${source.key}" was released`);
                    scope.add(lease);
                }
            }
        } catch (error) { release(); throw error; }
        return {
            attach(world, entities) {
                for (const [id, scope] of retained) {
                    const entity = entities.get(id);
                    if (entity !== undefined && world.valid(entity)) owners.ensure(world, entity).absorb(scope);
                }
                // Unspawned entities release their receipts; absorbed scopes are empty.
                release();
            },
            release,
        };
    };
}
