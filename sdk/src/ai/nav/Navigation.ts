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

/** Ownership of one replacement surface; build it separately from the live one. */
export interface NavSurfaceUpdate {
    readonly version: number;
    readonly pending: boolean;
    readonly cancelled: boolean;
    /** Install only if this is still the current request. */
    commit(surface: NavSurface | null): boolean;
    /** Retain the previous surface and reject future commits from this request.
     * The producer owns stopping its underlying work. */
    cancel(): boolean;
}

export class Navigation {
    private surface_: NavSurface | null = null;
    private surfaceUpdate_: NavSurfaceUpdate | null = null;
    private surfaceUpdateVersion_ = 0;

    /** Where agents may walk, or null until something builds and installs it. */
    get surface(): NavSurface | null { return this.surface_; }
    set surface(surface: NavSurface | null) {
        this.surfaceUpdate_?.cancel();
        this.surface_ = surface;
    }

    /** Soft planning time budget per NavAgentSystem tick, in ms. At least one
     * query may run; a synchronous query cannot be interrupted. <=0 disables it. */
    planningBudgetMs = 2;
    /** Maximum agent plans per tick; <=0 disables the count limit. */
    maxPlansPerFrame = 16;
    /** Last agent tick; pending includes agents held for a surface update.
     * Time excludes movement, avoidance and baking. */
    readonly planningStats = { completed: 0, pending: 0, elapsedMs: 0 };
    private pathRevision_ = 0;

    /** Revision used by agents to retire cached plans after an explicit update. */
    get pathRevision(): number { return this.pathRevision_; }

    /** Agents retain destinations and wait while a replacement is pending. */
    get surfaceUpdatePending(): boolean { return this.surfaceUpdate_ !== null; }

    /** Stage an async producer's result without exposing a half-built surface.
     * Starting another request cancels the previous one's right to commit.
     * This schedules no worker; the producer owns computation and yielding. */
    beginSurfaceUpdate(): NavSurfaceUpdate {
        this.surfaceUpdate_?.cancel();
        let cancelled = false;
        const update: NavSurfaceUpdate = {
            version: ++this.surfaceUpdateVersion_,
            get pending() { return current(); },
            get cancelled() { return cancelled; },
            commit: surface => {
                if (!current()) return false;
                this.surfaceUpdate_ = null;
                this.surface_ = surface;
                this.invalidatePaths();
                return true;
            },
            cancel: () => {
                if (!current()) return false;
                cancelled = true;
                this.surfaceUpdate_ = null;
                return true;
            },
        };
        const current = () => this.surfaceUpdate_ === update;
        this.surfaceUpdate_ = update;
        return Object.freeze(update);
    }

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
        if (this.surfaceUpdatePending) return null;
        return this.surface ? this.surface.findWorldPath(from, to, opts) : null;
    }

    /** Explain a built-in route; custom surfaces without diagnostics report unknown. */
    queryWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): NavPathResult {
        if (this.surfaceUpdatePending) return { path: null, status: 'unavailable', reason: 'building' };
        if (!this.surface) return { path: null, status: 'unavailable', reason: 'no-surface' };
        if (this.surface.queryWorldPath) return this.surface.queryWorldPath(from, to, opts);
        return { path: this.surface.findWorldPath(from, to, opts), status: 'unknown', reason: 'diagnostics-unavailable' };
    }
}

export const Nav = defineResource<Navigation>(null!, 'Nav');
