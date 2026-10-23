// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    WaterBody, WaterForm, Waters, WatersRes, WaterPlugin, waterPlugin, type WaterBodyData, type WaterSample,
} from './waterPlugin';
export { WAVE_SET, waveFade, waveHeight, waveSlope, type WaveParams } from './waves';
export { UnderwaterPlugin, registerUnderwaterEffect } from './underwater';
export { RippleField } from './ripples';
export { Floating, FloatingPlugin, floatingForce, wakeStrength, type FloatingBody, type FloatingData, type FloatingForce } from './floating';
export { buildRiverMesh, currentShare } from './riverMesh';
export { buildBoxMesh, buildOceanMesh, buildRectMesh, oceanReach, oceanSnap, type RectOptions } from './waterMesh';
export { ShoreField, UNKNOWN_DEPTH, polygonSdf, shoreDamp, type GroundDepth, type Point2 } from './shore';

// Importing this subpath INSTALLS water — see tilemap/index.ts.
import { registerWaterSupport } from './waterSupport';

registerWaterSupport();
