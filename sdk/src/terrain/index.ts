// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Terrain, Terrains, TerrainsRes, TerrainPlugin, terrainPlugin, paintWeights, type TerrainData,
} from './terrainPlugin';
export {
    erodeHeightfield, erosionJob, heightfieldFromPixels, proceduralHeightfield, sampleHeight, terrainNormal,
    type Eroded, type ErosionParams, type Heightfield, type ProceduralParams,
} from './heightfield';
export {
    buildChunkMesh, cellsAtLod, chunkCenter, lodCount, type TerrainShape, type TerrainPaint,
} from './mesh';

// Importing this subpath INSTALLS terrain — see tilemap/index.ts.
import { registerTerrainSupport } from './terrainSupport';

registerTerrainSupport();
