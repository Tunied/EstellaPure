// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  plants.mjs — the rules the trees, shrubs, stones, grass, flowers and reeds of the Terrain & Water project are laid out by.
 *
 * The plants are the lakewood set (assets/plants), made in metres and set here in this world's centimetres. The rules are the engine's world rules
 * (the generated-world page): biomes that are weights over fields, recipes that are a group round an anchor, layers that are passes which keep clear
 * of one another, and the plants the recipes name, each its parts, a cheaper mesh, a far version and the colourings the art gives it. This script
 * writes them as `assets/worlds/plants.esworld`; the scene's `WorldGen` lays the world out from the file as the eye moves, and the editor edits it.
 *
 * The fields the biomes read are the ground's (`height`, `up`, `shoreDistance`, `waterDepth`), the seeded noise (`moisture`, `rock`, and patches of
 * our own: `turf`, `bloom`, `reeds`) and the terrain's paint (`paint.grass`, `paint.rock`, a field for each of its layers). Nothing is a line: a biome's
 * edge is a band over which its weight rises, so a meadow thins toward the water and a wood gives way to a meadow, and a steep place holds no trees
 * because the wood's weight falls with the ground's `up`, not because a number in a function said so.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** The plants are in metres, the world in centimetres. */
const M = 100;

/** The renderers of a prefab's parts, in order. */
function partsOf(project, file) {
  const full = path.join(project, file);
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, 'utf8')).entities
    .flatMap((e) => e.components.filter((c) => c.type === 'MeshRenderer').map((c) => c.data));
}

const asPart = (d, lod1Mesh = '') => ({
  mesh: d.mesh, lod1Mesh, material: d.material ?? '', texture: d.texture ?? '',
  tint: [d.color?.r ?? 1, d.color?.g ?? 1, d.color?.b ?? 1, d.color?.a ?? 1], opaque: d.opaque !== false,
});

/**
 * The art's colour variation (color-variation.json): linear multipliers on a plant's colour, three to a group, which a place takes one of by a slow noise,
 * so a wood has warm and cool stands and not a speckle. Flowers are absolute colours and stay as made.
 */
const TINTS = {
  oak: [[0.94, 1, 0.9], [1, 1, 1], [1.05, 0.98, 0.87]],
  birch: [[0.94, 1, 0.93], [1, 1, 1], [1.04, 1.04, 0.9]],
  willow: [[0.9, 1, 1.03], [1, 1, 1], [1.05, 1, 0.94]],
  shrub: [[0.94, 1, 0.92], [1, 1, 1], [1.08, 1.03, 0.9]],
  grass: [[0.9, 1, 0.85], [1, 1, 1], [1.12, 1.02, 0.8]],
  reed: [[0.9, 1, 0.9], [1, 1, 1], [1.1, 1.02, 0.83]],
};

/** The kinds of plant: the prefab each is made of, how far it is drawn (metres: the cheaper mesh from `lod`, nothing past `draw`, the far version out to `far`). */
const KINDS = {
  oak: { prefab: 'tree-oak', lod: 60, draw: 160, far: 2000, tints: TINTS.oak },
  birch: { prefab: 'tree-birch', lod: 60, draw: 160, far: 2000, tints: TINTS.birch },
  willow: { prefab: 'tree-willow', lod: 60, draw: 160, far: 2000, tints: TINTS.willow },
  hazel: { prefab: 'shrub-hazel', lod: 40, draw: 120, tints: TINTS.shrub },
  coppice: { prefab: 'shrub-woodland-coppice', lod: 40, draw: 120, tints: TINTS.shrub },
  'granite-crown': { prefab: 'granite-crown', lod: 90, draw: 330, sink: 8 },
  'granite-bank': { prefab: 'granite-bank', lod: 90, draw: 330, sink: 8 },
  'granite-split': { prefab: 'granite-split', lod: 90, draw: 330, sink: 8 },
  'grass-fine': { prefab: 'grass-fine', lod: 30, draw: 90, tints: TINTS.grass },
  'grass-meadow': { prefab: 'grass-meadow', lod: 30, draw: 90, tints: TINTS.grass },
  'flower-ivory': { prefab: 'flower-ivory', lod: 40, draw: 90 },
  'flower-amber': { prefab: 'flower-amber', lod: 40, draw: 90 },
  'flower-blue': { prefab: 'flower-blue', lod: 40, draw: 90 },
  reed: { prefab: 'reed-lakeside', lod: 40, draw: 90, tints: TINTS.reed },
};

/** The `plants` table of the rules: each kind's parts read from its prefab, with the cheaper mesh and the far cards beside it. */
function plants(project) {
  const out = {};
  for (const [name, k] of Object.entries(KINDS)) {
    const base = `assets/plants/models/${k.prefab}`;
    const parts = partsOf(project, `${base}/${k.prefab}.esprefab`), near = partsOf(project, `${base}/lod1/${k.prefab}.esprefab`);
    const cards = partsOf(project, `${base}/far/${k.prefab}.esprefab`);
    const cheaper = near.length === parts.length;
    out[name] = {
      parts: parts.map((d, j) => asPart(d, cheaper ? near[j].mesh : '')),
      lodDistance: cheaper ? k.lod * M : 0, drawDistance: k.draw * M,
      far: cards.map((d) => asPart(d)), farDistance: cards.length ? (k.far ?? 0) * M : 0,
      ...(k.tints ? { tints: k.tints, tintScale: 1300 } : {}),
      ...(k.sink ? { sink: k.sink } : {}),
      // The art is in metres and this world in centimetres.
      unit: M,
    };
  }
  return out;
}

/**
 * The rules, as `registerWorldRules` takes them (and as an `.esworld` file holds them). Distances are centimetres; `footprint` is what a trunk or a clump
 * takes of the ground and `canopy` how far it spreads. A biome is a kind of place, and says what stands in it in every layer: a candidate takes a
 * biome by weight, then the recipe that biome has in the layer, so how thick a layer is here is the biome's `density` for it.
 */
export function plantRules({ project, lakeLevel, snow }) {
  const tree = (plant) => ({ id: plant, plant, footprint: 50, canopy: 500, minUp: 0.8 });
  const shrub = (plant, count) => ({ id: plant, plant, count, ring: [250, 800], scale: [0.7, 1.2], footprint: 80, canopy: 150, minUp: 0.8 });
  const grass = (plant, count, ring, scale = [1, 1.9], extra = {}) => ({ id: `${plant}.${ring[0]}`, plant, count, ring, scale, footprint: 20, minUp: 0.8, ...extra });
  const grove = (anchor, other) => ({
    id: `grove-${anchor}`, version: 1, tags: ['tree'],
    anchor: { ...tree(anchor), id: 'elder', scale: [1.0, 1.35] },
    members: [
      { ...tree(anchor), id: 'kin', count: [1, 3], ring: [300, 750], scale: [0.7, 1.25] },
      { ...tree(other), id: 'other', count: [1, 3], ring: [300, 750], scale: [0.7, 1.25] },
      shrub('hazel', [1, 3]), shrub('coppice', [1, 2]),
      grass('grass-fine', [3, 7], [100, 900], [1, 1.9], { chance: 0.8 }), grass('grass-meadow', [2, 5], [100, 900], [1, 1.9], { chance: 0.8 }),
    ],
  });
  const lone = (anchor) => ({
    id: `lone-${anchor}`, version: 1, tags: ['tree'], anchor: { ...tree(anchor), id: 'elder', scale: [0.9, 1.3], minUp: 0.92 },
    members: [shrub('hazel', [0, 2]), shrub('coppice', [0, 1])],
  });
  const rock = (id) => ({
    id: `rocks-${id}`, version: 1, tags: ['stone'], anchor: { id, plant: `granite-${id}`, scale: [0.8, 1.6], footprint: 120, canopy: 160, minUp: 0.6 },
    members: [{ id: 'small', plant: 'granite-split', count: [1, 4], ring: [120, 420], scale: [0.35, 0.7], footprint: 40, minUp: 0.6 }],
  });
  const drift = (colour) => ({
    id: `drift-${colour}`, version: 1, tags: ['flower'], anchor: { id: 'bloom', plant: `flower-${colour}`, scale: [1, 1.4], footprint: 10, minUp: 0.85 },
    members: [
      { id: 'more', plant: `flower-${colour}`, count: [5, 14], ring: [40, 220], scale: [0.8, 1.4], footprint: 12, minUp: 0.85 },
      grass('grass-fine', [2, 5], [40, 200], [1, 1.6], { footprint: 12 }),
    ],
  });
  return {
    id: 'terrain-water:plants', versions: [1],
    // The slow noise the rules read by name: damp ground, rocky ground, and the patches the meadow's cover, flowers and reeds come in.
    noise: {
      moisture: { scale: 4200, octaves: 3 }, rock: { scale: 700, octaves: 3 },
      turf: { scale: 1400, octaves: 2 }, bloom: { scale: 1100, octaves: 2 }, reeds: { scale: 900, octaves: 2 },
    },
    plants: plants(project),
    biomes: [
      // The wood: damp ground away from the water, gentle, in the band the trees grow in. Steeper, higher or drier ground lowers its weight and it gives way to
      // meadow by itself; under the trees there is grass and the odd drift of flowers.
      { id: 'wood', transition: 300,
        conditions: [
          { field: 'moisture', min: 0.3, blend: 0.15 }, { field: 'shoreDistance', min: 600, blend: 500 }, { field: 'up', min: 0.78, blend: 0.12 },
          { field: 'height', min: 760, max: snow - 300, blend: 250 }, { field: 'paint.grass', min: 0.1, blend: 0.2 },
        ],
        recipes: [
          { recipe: 'grove-oak', layer: 'groves', density: 0.6 }, { recipe: 'grove-birch', layer: 'groves', density: 0.5 },
          { recipe: 'tufts', layer: 'cover', density: 0.4 }, { recipe: 'drift-ivory', layer: 'drifts', density: 0.1 },
        ] },
      // The meadow rises from the water's edge over a band, so its grass and flowers thin out toward it and do not stop at a line.
      { id: 'meadow', transition: 200,
        conditions: [
          { field: 'shoreDistance', min: 120, blend: 900 }, { field: 'up', min: 0.9, blend: 0.06 },
          { field: 'height', min: 780, max: snow - 700, blend: 250 }, { field: 'paint.grass', min: 0.35, blend: 0.25 },
        ],
        recipes: [
          { recipe: 'lone-oak', layer: 'groves', density: 0.08 }, { recipe: 'lone-birch', layer: 'groves', density: 0.06 },
          { recipe: 'tufts', layer: 'cover', density: 0.35 },
          { recipe: 'drift-ivory', layer: 'drifts', density: 0.1 }, { recipe: 'drift-amber', layer: 'drifts', density: 0.1 }, { recipe: 'drift-blue', layer: 'drifts', density: 0.1 },
        ] },
      // Turf and blooms are the meadow's patches: the same ground where a slow noise is high, thick with tufts or with flowers, so the cover comes in
      // drifts with bare ground between them.
      { id: 'turf', transition: 300,
        conditions: [
          { field: 'shoreDistance', min: 120, blend: 900 }, { field: 'up', min: 0.9, blend: 0.06 }, { field: 'height', min: 780, max: snow - 700, blend: 250 },
          { field: 'paint.grass', min: 0.35, blend: 0.25 }, { field: 'turf', min: 0.35, blend: 0.15 },
        ],
        recipes: [{ recipe: 'tufts', layer: 'cover', density: 1 }] },
      { id: 'blooms', transition: 300,
        conditions: [
          { field: 'shoreDistance', min: 300, blend: 900 }, { field: 'up', min: 0.92, blend: 0.05 }, { field: 'height', min: 780, max: 2600, blend: 300 },
          { field: 'paint.grass', min: 0.45, blend: 0.25 }, { field: 'bloom', min: 0.42, blend: 0.13 },
        ],
        recipes: [
          { recipe: 'drift-ivory', layer: 'drifts', density: 0.33 }, { recipe: 'drift-amber', layer: 'drifts', density: 0.33 }, { recipe: 'drift-blue', layer: 'drifts', density: 0.33 },
          { recipe: 'tufts', layer: 'cover', density: 0.5 },
        ] },
      // The bank, above the water: willows, a few together, with grass under them.
      { id: 'bank', transition: 200,
        conditions: [
          { field: 'shoreDistance', min: 100, max: 1800, blend: 450 }, { field: 'up', min: 0.9, blend: 0.08 },
          { field: 'height', min: lakeLevel, max: lakeLevel + 500, blend: 120 },
        ],
        recipes: [{ recipe: 'willows', layer: 'banks', density: 0.8 }, { recipe: 'tufts', layer: 'cover', density: 0.25 }] },
      // The shallows: reeds in strips, standing in the water and on the wet bank, thinning out on both sides.
      { id: 'shallows', transition: 250,
        conditions: [
          { field: 'shoreDistance', min: -250, max: 350, blend: 220 }, { field: 'reeds', min: 0.3, blend: 0.2 },
          { field: 'height', min: lakeLevel - 70, max: lakeLevel + 120, blend: 40 },
        ],
        recipes: [{ recipe: 'reed-strip', layer: 'reeds', density: 0.9 }] },
      // Stones: where the paint is rock and, more thinly, where the slow rock noise is high.
      { id: 'rocky', transition: 200,
        conditions: [{ field: 'paint.rock', min: 0.15, blend: 0.2 }, { field: 'height', min: 700, max: snow, blend: 200 }],
        recipes: [{ recipe: 'rocks-crown', layer: 'stones', density: 0.5 }, { recipe: 'rocks-bank', layer: 'stones', density: 0.4 }, { recipe: 'rocks-split', layer: 'stones', density: 0.3 }] },
      { id: 'scatter', transition: 400,
        conditions: [{ field: 'rock', min: 0.62, blend: 0.08 }, { field: 'up', min: 0.8, blend: 0.1 }, { field: 'shoreDistance', min: 100, blend: 300 }, { field: 'height', min: 700, max: snow, blend: 200 }],
        recipes: [{ recipe: 'rocks-split', layer: 'stones', density: 0.5 }, { recipe: 'rocks-bank', layer: 'stones', density: 0.3 }] },
    ],
    recipes: [
      grove('oak', 'birch'), grove('birch', 'oak'), lone('oak'), lone('birch'),
      {
        id: 'willows', version: 1, tags: ['tree'], anchor: { id: 'willow', plant: 'willow', scale: [0.9, 1.2], footprint: 60, canopy: 500, minUp: 0.8 },
        members: [
          { id: 'kin', plant: 'willow', count: [0, 2], ring: [450, 800], scale: [0.7, 1], footprint: 60, canopy: 450, minUp: 0.8, chance: 0.5 },
          grass('grass-meadow', [3, 7], [150, 700], [1, 1.6]),
        ],
      },
      rock('crown'), rock('bank'), rock('split'),
      {
        id: 'tufts', version: 1, tags: ['grass'], anchor: { id: 'tuft', plant: 'grass-fine', scale: [1.1, 1.9], footprint: 15, minUp: 0.8 },
        members: [grass('grass-meadow', [3, 8], [25, 120], [0.9, 1.7], { footprint: 12 }), grass('grass-fine', [0, 3], [25, 120], [0.9, 1.5], { footprint: 12 })],
      },
      drift('ivory'), drift('amber'), drift('blue'),
      {
        id: 'reed-strip', version: 1, tags: ['reed'], anchor: { id: 'reed', plant: 'reed', scale: [0.9, 1.4], footprint: 25, waterDepth: 70, minUp: 0.5 },
        members: [{ id: 'more', plant: 'reed', count: [2, 6], ring: [30, 160], scale: [0.8, 1.4], footprint: 20, waterDepth: 70, minUp: 0.5 }],
      },
    ],
    // Big things first; each keeps clear of what the layers before it stand on. The ground cover and the reeds are passes later ones may overlap. A layer
    // is grown out to `drawDistance` (what its plants draw as themselves); their far versions are laid out as far as they go, on their own.
    layers: [
      { id: 'groves', spacing: 750, chunkSize: 3200, drawDistance: 17000 },
      { id: 'banks', spacing: 420, chunkSize: 3200, drawDistance: 17000 },
      { id: 'stones', spacing: 1500, chunkSize: 3200, drawDistance: 34000 },
      { id: 'cover', spacing: 190, chunkSize: 3200, drawDistance: 9500, occupies: false },
      { id: 'drifts', spacing: 600, chunkSize: 3200, drawDistance: 9500, occupies: false },
      { id: 'reeds', spacing: 130, chunkSize: 3200, drawDistance: 9500, occupies: false },
    ],
  };
}
