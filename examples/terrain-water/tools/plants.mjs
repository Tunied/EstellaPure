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

/** How far a crown's card has its normals turned to face up: it is lit as a rounded crown, and not as the two flat boards it is. */
const SOFT_CARDS = 0.85;
const SOFT_GROUND = 0.6;

/**
 * The leaf colour of the compact grasses (grass-catalog.json's baseLinearRGB). The art says it is in COLOR_0, but the delivered GLBs carry white
 * there, so until that is re-exported it is the part's tint, a little lifted (1.6) for the scene's light.
 */
const GRASS_BASE = { 'grass-compact-short': [0.115, 0.205, 0.028], 'grass-compact-meadow': [0.145, 0.235, 0.038], 'grass-compact-bank': [0.09, 0.185, 0.032] };

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
  grass: [[1, 1, 1], [1.07, 1.02, 0.88], [0.91, 0.97, 0.95]],
  beech: [[0.94, 1, 0.92], [1, 1, 1], [1.08, 0.97, 0.86]],
  conifer: [[0.88, 0.96, 0.92], [1, 1, 1], [1.04, 1.03, 0.91]],
  fern: [[0.91, 0.98, 0.92], [1, 1, 1], [1.08, 1.03, 0.87]],
  reed: [[0.92, 0.98, 0.91], [1, 1, 1], [1.08, 1.02, 0.85]],
};

/** The kinds of plant: the prefab each is made of, how far it is drawn (metres: the cheaper mesh from `lod`, nothing past `draw`, the far version out to `far`). */
const KINDS = {
  oak: { prefab: 'tree-oak-dense', lod: 60, draw: 380, far: 2000, tints: TINTS.oak },
  beech: { prefab: 'tree-beech-dense', lod: 60, draw: 380, far: 2000, tints: TINTS.beech },
  birch: { prefab: 'tree-birch', lod: 60, draw: 380, far: 2000, tints: TINTS.birch },
  willow: { prefab: 'tree-willow', lod: 60, draw: 380, far: 2000, tints: TINTS.willow },
  'pine-ridge': { prefab: 'tree-pine-ridge', lod: 60, draw: 380, far: 2000, tints: TINTS.conifer },
  'pine-lakeside': { prefab: 'tree-pine-lakeside', lod: 60, draw: 380, far: 2000, tints: TINTS.conifer },
  hazel: { prefab: 'shrub-hazel', lod: 40, draw: 120, tints: TINTS.shrub },
  coppice: { prefab: 'shrub-woodland-coppice', lod: 40, draw: 120, tints: TINTS.shrub },
  lowleaf: { prefab: 'woodland-lowleaf', lod: 30, draw: 100, tints: TINTS.fern },
  'fern-upright': { prefab: 'fern-upright', lod: 30, draw: 100, tints: TINTS.fern },
  'fern-arching': { prefab: 'fern-arching', lod: 30, draw: 100, tints: TINTS.fern },
  'granite-crown': { prefab: 'granite-crown', lod: 90, draw: 330, sink: 8 },
  'granite-bank': { prefab: 'granite-bank', lod: 90, draw: 330, sink: 8 },
  'granite-split': { prefab: 'granite-split', lod: 90, draw: 330, sink: 8 },
  'boulder-round': { prefab: 'waterworn-boulder-round', lod: 60, draw: 200, sink: 12 },
  'boulder-flat': { prefab: 'waterworn-boulder-flat', lod: 60, draw: 200, sink: 12 },
  pebbles: { prefab: 'pebble-bed-small', lod: 40, draw: 120, sink: 2 },
  'grass-fine': { prefab: 'grass-compact-short', size: 1.5, lod: 30, draw: 90, tints: TINTS.grass },
  'grass-meadow': { prefab: 'grass-compact-meadow', size: 1.5, lod: 30, draw: 90, tints: TINTS.grass },
  'grass-bank': { prefab: 'grass-compact-bank', size: 1.5, lod: 30, draw: 100, tints: TINTS.grass },
  'flower-ivory': { prefab: 'flower-ivory', lod: 40, draw: 90 },
  'flower-amber': { prefab: 'flower-amber', lod: 40, draw: 90 },
  'flower-blue': { prefab: 'flower-blue', lod: 40, draw: 90 },
  'flower-rose': { prefab: 'flower-rose', lod: 40, draw: 90 },
  'flower-violet': { prefab: 'flower-violet', lod: 40, draw: 90 },
  reed: { prefab: 'reed-thicket', lod: 40, draw: 100, tints: TINTS.reed },
};

/**
 * Ground cover has no cards from the art, so its far version is its own cheaper mesh (the lod1 beside it, or the mesh itself where it has none), a share
 * of the plants of it (`keep`) grown to make up their cover, out to `far` metres: past what the plants draw as themselves the ground's own texture carries the rest.
 */
const COVER = {
  'grass-fine': { keep: 0.25, far: 260 }, 'grass-meadow': { keep: 0.25, far: 260 }, 'grass-bank': { keep: 0.3, far: 260 },
  'flower-ivory': { keep: 0.3, far: 220 }, 'flower-amber': { keep: 0.3, far: 220 }, 'flower-blue': { keep: 0.3, far: 220 }, 'flower-rose': { keep: 0.3, far: 220 }, 'flower-violet': { keep: 0.3, far: 220 },
  lowleaf: { keep: 0.3, far: 240 }, 'fern-upright': { keep: 0.35, far: 240 }, 'fern-arching': { keep: 0.35, far: 240 },
  hazel: { keep: 0.5, far: 300 }, coppice: { keep: 0.5, far: 300 }, reed: { keep: 0.5, far: 260 },
};

/** The `plants` table of the rules: each kind's parts read from its prefab, with the cheaper mesh and the far cards beside it. */
function plants(project) {
  const out = {};
  for (const [name, k] of Object.entries(KINDS)) {
    const base = `assets/plants/models/${k.prefab}`;
    const parts = partsOf(project, `${base}/${k.prefab}.esprefab`), near = partsOf(project, `${base}/lod1/${k.prefab}.esprefab`);
    const cards = partsOf(project, `${base}/far/${k.prefab}.esprefab`);
    const cheaper = near.length === parts.length;
    const cover = COVER[name];
    // Ground cover: the cheaper mesh stands for it far off, thinned; trees: the art's cards.
    // The art's cards where it made them; ground cover with none (a flower) stands in as its own cheaper mesh, thinned.
    const based = (part, prefab) => GRASS_BASE[prefab] ? { ...part, tint: part.tint.map((c, i) => (i < 3 ? c * GRASS_BASE[prefab][i] * 1.6 : c)) } : part;
    const far = cards.length ? cards.map((d) => ({ ...asPart(d), soft: cover ? SOFT_GROUND : SOFT_CARDS })) : cover ? (cheaper ? near : parts).map((d) => asPart(d)) : [];
    out[name] = {
      parts: parts.map((d, j) => based(asPart(d, cheaper ? near[j].mesh : ''), k.prefab)),
      lodDistance: cheaper ? k.lod * M : 0, drawDistance: k.draw * M,
      far, farDistance: far.length ? (cover?.far ?? k.far ?? 0) * M : 0,
      ...(cover ? { farKeep: cover.keep } : {}),
      ...(k.tints ? { tints: k.tints, tintScale: 1300 } : {}),
      ...(k.sink ? { sink: k.sink } : {}),
      // The art is in metres and this world in centimetres.
      unit: M * (k.size ?? 1),
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
      { ...tree('beech'), id: 'beech', count: [0, 2], ring: [300, 750], scale: [0.7, 1.2], chance: 0.6 },
      shrub('hazel', [1, 3]), shrub('coppice', [1, 2]),
      shrub('lowleaf', [2, 4]), shrub('fern-upright', [1, 3]), shrub('fern-arching', [1, 3]),
      grass('grass-fine', [3, 7], [100, 900], [1, 1.9], { chance: 0.8 }), grass('grass-meadow', [2, 5], [100, 900], [1, 1.9], { chance: 0.8 }),
    ],
  });
  const lone = (anchor) => ({
    id: `lone-${anchor}`, version: 1, tags: ['tree'], anchor: { ...tree(anchor), id: 'elder', scale: [0.9, 1.3], minUp: 0.92 },
    members: [shrub('hazel', [0, 2]), shrub('coppice', [0, 1])],
  });
  const rock = (id) => ({
    id: `rocks-${id}`, version: 1, tags: ['stone'], anchor: { id, plant: `granite-${id}`, scale: [0.8, 1.6], footprint: 120, canopy: 160, minUp: 0.6 },
    members: [{ id: 'small', plant: 'granite-split', attach: 'align', count: [1, 4], ring: [120, 420], scale: [0.35, 0.7], footprint: 40, minUp: 0.6 }],
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
          { recipe: 'tufts', layer: 'cover', density: 0.25 }, { recipe: 'undergrowth', layer: 'cover', density: 0.5 }, { recipe: 'drift-ivory', layer: 'drifts', density: 0.1 },
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
        recipes: [
          { recipe: 'willows', layer: 'banks', density: 0.55 }, { recipe: 'shore-pines', layer: 'banks', density: 0.3 },
          { recipe: 'bank-grass', layer: 'cover', density: 0.7 }, { recipe: 'tufts', layer: 'cover', density: 0.15 },
        ] },
      // The shallows: reeds in strips, standing in the water and on the wet bank, thinning out on both sides.
      { id: 'shallows', transition: 250,
        conditions: [
          { field: 'shoreDistance', min: -250, max: 350, blend: 220 }, { field: 'reeds', min: 0.3, blend: 0.2 },
          { field: 'height', min: lakeLevel - 70, max: lakeLevel + 120, blend: 40 },
        ],
        recipes: [{ recipe: 'reed-strip', layer: 'reeds', density: 0.9 }] },
      // The flower sea: no field holds it, a WorldZone does, over the hillside its author marks.
      { id: 'flower-sea', transition: 200,
        conditions: [{ field: 'height', min: 1e9 }],
        recipes: [
          { recipe: 'sea-ivory', layer: 'sea', density: 0.15 }, { recipe: 'sea-amber', layer: 'sea', density: 0.2 }, { recipe: 'sea-blue', layer: 'sea', density: 0.2 },
          { recipe: 'sea-rose', layer: 'sea', density: 0.2 }, { recipe: 'sea-violet', layer: 'sea', density: 0.2 },
          { recipe: 'tufts', layer: 'cover', density: 0.3 },
        ] },
      // The high ground, where the trees are conifers: stands of pines with ferns under them, on ground gentle enough to hold them.
      { id: 'ridge', transition: 400,
        conditions: [
          { field: 'height', min: 2000, max: snow - 150, blend: 450 }, { field: 'up', min: 0.72, blend: 0.1 }, { field: 'paint.grass', min: 0.1, blend: 0.2 },
          { field: 'shoreDistance', min: 600, blend: 500 },
        ],
        recipes: [{ recipe: 'pines', layer: 'groves', density: 0.7 }, { recipe: 'undergrowth', layer: 'cover', density: 0.3 }] },
      // The shoals: the lake's shallows, where the water is clear enough to see stones in. A water-worn boulder with a bed of pebbles round it, and loose beds.
      { id: 'shoals', transition: 250,
        conditions: [
          { field: 'shoreDistance', min: -500, max: 200, blend: 250 }, { field: 'height', min: lakeLevel - 160, max: lakeLevel + 40, blend: 60 },
          { field: 'reeds', min: 0.2, blend: 0.3 },
        ],
        recipes: [{ recipe: 'shoal-round', layer: 'shoals', density: 0.35 }, { recipe: 'shoal-flat', layer: 'shoals', density: 0.25 }, { recipe: 'pebble-field', layer: 'shoals', density: 0.4 }] },
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
      // The flower sea: patches of one colour, close together and large, in all five colours, so a hillside is a patchwork of bloom.
      ...['ivory', 'amber', 'blue', 'rose', 'violet'].map((colour) => ({
        id: `sea-${colour}`, version: 1, tags: ['flower'], anchor: { id: 'bloom', plant: `flower-${colour}`, scale: [1.1, 1.7], footprint: 8, minUp: 0.7 },
        members: [
          { id: 'more', plant: `flower-${colour}`, count: [12, 26], ring: [30, 300], scale: [0.9, 1.6], footprint: 9, minUp: 0.7 },
          grass('grass-fine', [2, 4], [40, 260], [1, 1.5], { footprint: 10 }),
        ],
      })),
      // Conifers on the high ground, in stands, with ferns under them; and a few by the lake.
      {
        id: 'pines', version: 1, tags: ['tree'], anchor: { id: 'elder', plant: 'pine-ridge', scale: [0.9, 1.3], footprint: 50, canopy: 400, minUp: 0.7 },
        members: [
          { id: 'kin', plant: 'pine-ridge', count: [2, 5], ring: [250, 700], scale: [0.7, 1.2], footprint: 45, canopy: 350, minUp: 0.7 },
          shrub('fern-upright', [1, 3]), grass('grass-meadow', [2, 5], [100, 600], [1, 1.6]),
        ],
      },
      {
        id: 'shore-pines', version: 1, tags: ['tree'], anchor: { id: 'elder', plant: 'pine-lakeside', scale: [0.9, 1.25], footprint: 50, canopy: 400, minUp: 0.8 },
        members: [{ id: 'kin', plant: 'pine-lakeside', count: [0, 2], ring: [300, 650], scale: [0.7, 1.1], footprint: 45, canopy: 350, minUp: 0.8, chance: 0.5 }],
      },
      // Under the trees: ferns and low leaves in drifts.
      {
        id: 'undergrowth', version: 1, tags: ['grass'], anchor: { id: 'fern', plant: 'fern-upright', scale: [1, 1.5], footprint: 15, minUp: 0.8 },
        members: [{ ...shrub('fern-arching', [2, 5]), ring: [30, 140], footprint: 15 }, { ...shrub('lowleaf', [2, 5]), ring: [40, 160], footprint: 15 }],
      },
      // The bank: dense grass in clumps.
      {
        id: 'bank-grass', version: 1, tags: ['grass'], anchor: { id: 'clump', plant: 'grass-bank', scale: [1, 1.5], footprint: 20, minUp: 0.7 },
        members: [{ id: 'more', plant: 'grass-bank', count: [2, 5], ring: [40, 160], scale: [0.8, 1.4], footprint: 18, minUp: 0.7 }],
      },
      // The shoals: a water-worn boulder with a bed of pebbles round it, under the water.
      {
        id: 'shoal-round', version: 1, tags: ['stone'], anchor: { id: 'boulder', plant: 'boulder-round', attach: 'align', scale: [0.8, 1.5], footprint: 70, waterDepth: 160, minUp: 0.5 },
        members: [{ id: 'bed', plant: 'pebbles', attach: 'align', count: [1, 3], ring: [90, 320], scale: [0.8, 1.4], footprint: 60, waterDepth: 160, minUp: 0.5 }],
      },
      {
        id: 'shoal-flat', version: 1, tags: ['stone'], anchor: { id: 'boulder', plant: 'boulder-flat', attach: 'align', scale: [0.8, 1.5], footprint: 80, waterDepth: 160, minUp: 0.5 },
        members: [{ id: 'bed', plant: 'pebbles', attach: 'align', count: [1, 3], ring: [90, 320], scale: [0.8, 1.4], footprint: 60, waterDepth: 160, minUp: 0.5 }],
      },
      {
        id: 'pebble-field', version: 1, tags: ['stone'], anchor: { id: 'bed', plant: 'pebbles', attach: 'align', scale: [0.9, 1.6], footprint: 60, waterDepth: 160, minUp: 0.5 },
      },
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
      { id: 'sea', spacing: 90, chunkSize: 3200, drawDistance: 12000, occupies: false },
      { id: 'shoals', spacing: 200, chunkSize: 3200, drawDistance: 20000, occupies: false },
    ],
  };
}
