// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Spline, SplinePlugin, splinePlugin, type SplineData } from './splinePlugin';
export { SplineCurve, type SplinePoint, type SplineNearest } from './curve';

// Importing this subpath INSTALLS splines — see tilemap/index.ts.
import { registerSplineSupport } from './splineSupport';

registerSplineSupport();
