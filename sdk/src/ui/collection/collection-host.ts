// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../../ecs/resource';
import type { Entity } from '../../types';
import type { ListView } from './list-view';
import type { ScrollContainer } from './scroll-container';

/** @internal Per-app collection wiring; never captured through a plugin singleton. */
export interface CollectionHost {
    registerListView(list: ListView<unknown>): void;
    unregisterListView(list: ListView<unknown>): void;
    attachScrollContainer(entity: Entity, container: ScrollContainer): void;
    detachScrollContainer(entity: Entity): void;
}
/** @internal Installed by UIBehaviorPlugin before collection widget adoption. */
export const UICollections = defineResource<CollectionHost>(null!, 'UICollections');
