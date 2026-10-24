// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    WorldGen, WorldZone, PlacedObject, ZoneShapeKind, WorldGens, WorldGenRes, WorldGenPlugin, worldGenPlugin,
    type WorldGenData, type WorldZoneData, type PlacedObjectData, type WorldGenStatus,
} from './worldgenPlugin';
export {
    registerWorldRules, worldRules, bandWeight,
    type WorldRules, type BiomeDef, type BiomeCondition, type BiomeRecipe, type Recipe, type RecipeMember, type PlacementLayer,
} from './rules';
export { WorldPlan, type Placement, type Group, type Rejection } from './plan';
export { Zones, zoneDistance, zoneWeight, zoneBounds, type ZoneDef, type ZoneShape } from './zones';
export { PlacementDiffs, type PlacementChange, type PlacementDiffsData } from './diffs';
export {
    Environment, fbm, hash01, hashString, type FieldValues, type FieldFn, type NoiseField, type EnvironmentInputs,
} from './fields';

// Importing this subpath INSTALLS generated worlds — see tilemap/index.ts. Their ground is the terrain's when the scene has one.
import { registerWorldGenSupport } from './worldgenSupport';

registerWorldGenSupport();
