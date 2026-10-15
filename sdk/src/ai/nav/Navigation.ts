// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Navigation.ts
 * @brief   `Nav` resource — holds the active {@link NavSurface} and routes over it.
 *
 * Published by NavPlugin; game code reads it as `Res(Nav)` (or
 * `app.getResource(Nav)`) to swap the surface or query a route directly. It does
 * not say which kind of surface is installed, because nothing above it should
 * have to branch on that.
 */

import { defineResource } from '../../ecs/resource';
import type { Vec3 } from '../../types';
import type { NavPoint, NavQueryOptions, NavSurface, NavPathResult } from './NavSurface';

export class Navigation {
    /** Where agents may walk, or null until something builds and installs it. */
    surface: NavSurface | null = null;

    /** Soft planning time budget per NavAgentSystem tick, in ms. At least one
     * query may run; a synchronous query cannot be interrupted. <=0 disables it. */
    planningBudgetMs = 2;
    /** Maximum agent plans per tick; <=0 disables the count limit. */
    maxPlansPerFrame = 16;
    /** Last agent-planning tick only; excludes movement, avoidance and baking. */
    readonly planningStats = { completed: 0, pending: 0, elapsedMs: 0 };
    private pathRevision_ = 0;

    /** Revision used by agents to retire cached plans after an explicit update. */
    get pathRevision(): number { return this.pathRevision_; }

    /** Replan agents after editing a custom surface or its links/costs in place.
     * Built-in grid topology and replacing the surface are detected automatically. */
    invalidatePaths(): void { this.pathRevision_++; }

    setSurface(surface: NavSurface | null): void {
        this.surface = surface;
    }

    hasSurface(): boolean {
        return this.surface !== null;
    }

    /**
     * Plan a world-space route, or null if there is no surface or no way. See
     * {@link NavSurface.findWorldPath} for what the waypoints carry.
     */
    findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): Vec3[] | null {
        return this.surface ? this.surface.findWorldPath(from, to, opts) : null;
    }

    /** Explain a built-in route; custom surfaces without diagnostics report unknown. */
    queryWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): NavPathResult {
        if (!this.surface) return { path: null, status: 'unavailable', reason: 'no-surface' };
        if (this.surface.queryWorldPath) return this.surface.queryWorldPath(from, to, opts);
        return { path: this.surface.findWorldPath(from, to, opts), status: 'unknown', reason: 'diagnostics-unavailable' };
    }
}

export const Nav = defineResource<Navigation>(null!, 'Nav');
