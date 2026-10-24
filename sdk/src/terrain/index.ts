// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Terrain, TerrainExtent, Terrains, TerrainsRes, TerrainPlugin, terrainPlugin, paintWeights, type TerrainData,
} from './terrainPlugin';
export {
    erodeHeightfield, erosionJob, heightfieldFromPixels, proceduralHeightfield, sampleHeight, terrainNormal,
    type Eroded, type ErosionParams, type Heightfield, type ProceduralParams,
} from './heightfield';
export { FieldSource, NoiseSource, noised, type NoiseParams, type Splat, type TerrainSource } from './source';
export { boxDistance, levelRange, nodeKey, parentOf, selectNodes, type QuadtreeParams, type TerrainNode } from './quadtree';
export { makePage, PageTable, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS, type Page, type PageImage } from './pages';
export { buildPatchMesh } from './patch';

// Importing this subpath INSTALLS terrain — see tilemap/index.ts.
import { registerTerrainSupport } from './terrainSupport';

registerTerrainSupport();
