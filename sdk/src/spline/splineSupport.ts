// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  splineSupport.ts — what a build that ships splines tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { SplinePlugin } from './splinePlugin';

export function registerSplineSupport(): void {
    addEntryPlugin('spline', () => new SplinePlugin());
}
