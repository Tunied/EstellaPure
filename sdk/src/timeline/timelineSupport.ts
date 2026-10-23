// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  timelineSupport.ts — what a build that ships timelines tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts. The plugin an app installs, and the loader
 * that reads a `.estimeline`: the asset layer no longer constructs it for every package.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { TimelinePlugin } from './TimelinePlugin';
import { TimelineAssetLoader } from '../asset/loaders/TimelineAssetLoader';

export function registerTimelineSupport(): void {
    addEntryPlugin('timeline', () => new TimelinePlugin());
    addAssetLoader('timeline', () => new TimelineAssetLoader() as never);
}
