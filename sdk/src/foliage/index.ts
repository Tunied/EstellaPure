// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Foliage, FoliageField, FoliageRes, FoliagePlugin, foliagePlugin, type FoliageData,
} from './foliagePlugin';
export {
    PlacedFoliage, PlacedFoliageField, PlacedFoliageRes, PlacedFoliagePlugin, placedFoliagePlugin,
    type PlacedFoliageData,
} from './placedFoliage';
export { PlantGrowth, PlantGrowthRes, plantGrowthOf } from './plantGrowth';
export { PLACED_STRIDE, type PlacedKind, type PlacedPart, type PlantKind } from './plantKind';
export {
    scatterCell, buildGrassMesh, buildInstancedMesh, buildPlacedMesh, buildBillboardMesh, rng,
    type Plant, type Ground, type ScatterParams, type BladeParams, type CardRect,
} from './builder';

// Importing this subpath INSTALLS foliage — see tilemap/index.ts. It stands on a Terrain when the scene has one and
// needs none to stand on a flat floor, so it does not pull terrain's plugin in.
import { registerFoliageSupport } from './foliageSupport';

registerFoliageSupport();
