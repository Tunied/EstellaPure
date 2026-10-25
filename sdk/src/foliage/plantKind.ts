// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plantKind.ts
 * @brief   What a kind of plant is made of, as data: the shape both a `PlacedFoliage` and a world's recipes name plants by.
 *
 * @details Types and a constant only, so the world-generation module can describe a plant without carrying the code that grows it.
 */

/** One part of a kind: what is drawn, and with what. Paths are the project's. */
export interface PlacedPart {
    mesh: string;
    /** A cheaper mesh with the same parts, drawn past the kind's `lodDistance`; empty draws the mesh to the end. */
    lod1Mesh: string;
    material: string;
    texture: string;
    tint: [number, number, number, number];
    /** False for a part that is blended (glass, a decal): it is drawn after what is solid. */
    opaque: boolean;
    /**
     * How far its normals are turned to face up, 0 to 1 (default 0): for a flat card that stands for a crown, which lit by its own normal is bright
     * on the side the sun is on and a dark slab on the other. A crown is lit as a rounded thing, and facing up is how a card is.
     */
    soft?: number;
}

/** A kind of plant: its parts, and how far it is drawn. */
export interface PlacedKind {
    parts: PlacedPart[];
    /** Past this the cheaper mesh stands in. */
    lodDistance: number;
    /** Past this the kind is not drawn as itself. */
    drawDistance: number;
    /**
     * The hierarchical level of detail: what stands for the kind from `drawDistance` out to `farDistance`, once the plants themselves are too small to
     * draw: parts of their own (a tree's crossed cards, with the atlas they were baked to), merged a cell at a time like the plants are. Empty has none.
     */
    far: PlacedPart[];
    farDistance: number;
    /**
     * The share of the plants its far version draws, above 0 to 1 (default 1): the others are left out and the ones kept grown to make up their cover, so
     * ground cover far off costs a share of what it does near, and the ground's own texture carries the rest. A kind with no cards of its own may use its
     * cheaper mesh as its far version, thinned.
     */
    farKeep?: number;
}

/**
 * A kind a world's recipes name (`WorldRules.plants`): the same, with the colourings the art gives it and how far it is sunk into the ground.
 *
 * `tints` are linear multipliers on the parts' colour, which a place takes one of by a slow noise (`tintScale` world units to a stand), so a wood has
 * warm and cool stands and not a speckle. Absent, the kind is as made.
 */
export interface PlantKind extends PlacedKind {
    tints?: [number, number, number][];
    tintScale?: number;
    /** How far a plant is sunk into the ground, in world units: a stone's buried underside. */
    sink?: number;
    /** World units to a unit of the plant's mesh: 100 for plants modelled in metres in a world of centimetres. A recipe's `scale` is then a size relative to the model. Default 1. */
    unit?: number;
}

/** Numbers a record takes in `PlacedFoliage.records`: the kind's index, x, y, z in the entity's space, the turn about the vertical in radians, and the scale. */
export const PLACED_STRIDE = 6;
