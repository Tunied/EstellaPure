// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../ecs/world';
import type { Assets } from './Assets';
import { AssetRefCounter } from './AssetRefCounter';

const subscribed = new WeakSet<World>();

/** One World observer, resolving its current asset resource at notification time. */
export function bindAssetReferenceTracking(
    world: World, assets: Assets, current: () => Assets | null | undefined,
): void {
    if (!assets.getRefCounter()) assets.setRefCounter(new AssetRefCounter());
    if (subscribed.has(world)) return;
    subscribed.add(world);
    world.onDespawn(entity => current()?.getRefCounter()?.removeAllRefsForEntity(entity));
}
