// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    WaterBody, WaterForm, Waters, WatersRes, WaterPlugin, waterPlugin, type WaterBodyData, type WaterSample,
} from './waterPlugin';
export { WAVE_SET, waveFade, waveHeight, waveSlope, type WaveParams } from './waves';
export { buildOceanMesh, buildRectMesh, oceanReach, oceanSnap } from './waterMesh';

// Importing this subpath INSTALLS water — see tilemap/index.ts.
import { registerWaterSupport } from './waterSupport';

registerWaterSupport();
