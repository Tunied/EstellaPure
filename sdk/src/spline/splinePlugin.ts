// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    splinePlugin.ts
 * @brief   The Spline component: a curve through a few points, authored once and read by whatever follows it.
 *
 * @details A `Spline` is data and nothing draws it: a river, a road or a camera rail reads it from the same entity and builds what it needs
 *          (see {@link SplineCurve}). The points are in the entity's own space, so moving or turning the entity moves the whole curve.
 *          There is nothing to run each frame, so the plugin only keeps the component known to a build that carries it.
 */
import type { App, Plugin } from '../app/app';
import { defineComponent, type ComponentDef } from '../ecs/component';
import type { SplinePoint } from './curve';

/** The fields of the `Spline` component. @experimental */
export interface SplineData {
    /** The points the curve passes through, in the entity's own space, in order, each with the width of whatever follows it there. */
    points: SplinePoint[];
    /** Whether the curve joins its end to its start. Needs three points. */
    closed: boolean;
}

/**
 * A curve through points. It is read by what follows it (a river's `WaterBody`, on the same entity).
 *
 * @experimental
 */
export const Spline: ComponentDef<SplineData> = defineComponent<SplineData>('Spline', {
    points: [{ x: -10, y: 0, z: 0, width: 4 }, { x: 10, y: 0, z: 0, width: 4 }] as SplinePoint[],
    closed: false,
}, {
    fields: {
        points: { category: 'Shape', tooltip: 'The points the curve passes through, in order, in the entity\'s own space. Each carries the width of whatever follows the curve there.' },
        closed: { category: 'Shape', tooltip: 'Join the end of the curve to its start (three points or more).' },
    },
});

export class SplinePlugin implements Plugin {
    name = 'spline';
    build(_app: App): void {
        // Data only: nothing runs each frame.
    }
}

export const splinePlugin: Plugin = new SplinePlugin();
