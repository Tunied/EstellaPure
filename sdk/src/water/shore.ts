// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shore.ts
 * @brief   Where a lake ends, and how the waves calm toward it: what the zone (zone.ts) bakes a lake's outline and shore with.
 */

/** A point on the body's plane. */
export interface Point2 { x: number; y: number }

/** The signed distance from (x, z) to the polygon's outline, positive inside it, negative outside. Self-intersecting outlines are not judged. */
export function polygonSdf(poly: readonly Point2[], x: number, z: number): number {
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]!, b = poly[i]!;
        const ex = b.x - a.x, ez = b.y - a.y;
        const len2 = ex * ex + ez * ez;
        let t = len2 > 0 ? ((x - a.x) * ex + (z - a.y) * ez) / len2 : 0;
        t = Math.min(Math.max(t, 0), 1);
        const dx = x - (a.x + t * ex), dz = z - (a.y + t * ez);
        best = Math.min(best, Math.hypot(dx, dz));
        if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside ? best : -best;
}

/** The share of the waves kept where the water is `reach` deep or far from the edge: none at the edge, all from `width` in; with no width, all of them everywhere. */
export function shoreDamp(reach: number, width: number): number {
    if (width <= 0) return 1;
    if (reach <= 0) return 0;
    const t = Math.min(reach / width, 1);
    return t * t * (3 - 2 * t);
}
