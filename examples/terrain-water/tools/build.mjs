// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  build.mjs — writes the Terrain & Water project's generated assets and scene.
 *
 * One watershed made from numbers: a river runs out of snowy hills into a lake in the valley, a second river leaves the lake and
 * crosses the meadows to a beach, and the sea goes out to the horizon. The ground is cut to the water, so each river runs in its
 * bed, the lake fills a basin and the beach shelves into the sea. Run it after changing a number:
 *
 *   node examples/terrain-water/tools/build.mjs
 *
 * It needs the SDK built (`node build-tools/cli.js sdk`), for the spline the rivers and their beds are both laid along and for the
 * mesh format of the pine. The world is in centimetres, the scale 3D physics takes by default: a crate is about 120 units.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const SDK = new URL('../../../sdk/dist/', import.meta.url);
const { SplineCurve } = await import(new URL('spline/index.js', SDK).href);
const { MeshChannel, MeshChannelType, packChannels, encodeMesh } = await import(new URL('index.node.js', SDK).href);

/** The place, in one table, in world units (centimetres). North is -z; the sea is to the south. */
const WORLD = {
  size: 28000,
  /** The ground spans `base` to `base + height`: below the sea's level for the sea floor, up to the snow on the hills. */
  base: -1400,
  height: 7400,
  resolution: 513,
  sea: 0,
  coast: 7600,
  lake: { x: 600, z: -1200, rx: 4000, rz: 2700, level: 700, floor: 180 },
  /** Out of the hills and into the lake: x, y (its surface), z, width. */
  inflow: [
    { x: -3800, y: 2350, z: -12500, width: 420 },
    { x: -2300, y: 2000, z: -10300, width: 500 },
    { x: -3000, y: 1550, z: -8000, width: 620 },
    { x: -1500, y: 1100, z: -5900, width: 740 },
    { x: -300, y: 760, z: -4300, width: 860 },
    { x: 200, y: 700, z: -3200, width: 960 },
  ],
  /** Out of the lake and down to the sea. */
  outflow: [
    { x: 1400, y: 700, z: 1100, width: 900 },
    { x: 2100, y: 600, z: 2800, width: 1000 },
    { x: 1200, y: 420, z: 4500, width: 1150 },
    { x: 2000, y: 200, z: 6300, width: 1300 },
    { x: 1800, y: 30, z: 7900, width: 1500 },
    { x: 1900, y: -40, z: 8900, width: 1700 },
  ],
  snow: 4000,
  crates: { lake: [[-500, -700], [1300, -1800], [1900, -400], [-1300, -1500]], sea: [[-600, 8900], [3400, 9200], [800, 9800], [5200, 9600], [2300, 10400]] },
};

// ── files ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function write(rel, data) {
  const file = path.join(PROJECT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** The `.meta` an asset carries once the editor has seen it, kept when it exists so a rebuild does not rename the asset. */
function meta(rel, type, importer = {}) {
  if (existsSync(path.join(PROJECT, `${rel}.meta`))) return;
  write(`${rel}.meta`, `${JSON.stringify({ uuid: randomUUID(), version: '2.0', type, importer }, null, 2)}\n`);
}

// ── images and noise ───────────────────────────────────────────────────────────────────────────────────────────────────

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      for (let k = 0; k < 4; k++) raw[row + 1 + x * 4 + k] = Math.max(0, Math.min(255, Math.round(p[k])));
    }
  }
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hash = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Value noise that wraps every `period` cells, so a texture tiles without a seam. */
function tiled(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractal(u, v, seed, octaves = 5, base = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base << o;
    sum += amp * tiled(u * period, v * period, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves, ridged = false) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = noise(x, y, seed + o * 31);
    if (ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp; norm += amp; amp *= 0.5; x *= 2.07; y *= 2.07;
  }
  return sum / norm;
}

// ── the ground ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const rivers = [new SplineCurve(WORLD.inflow, false), new SplineCurve(WORLD.outflow, false)];

/** The land before the water cut into it: meadows in the valley, hills rising to the north and along both sides, the shore to the south. */
function naturalHeight(x, z) {
  const u = x / WORLD.size, v = z / WORLD.size;
  const meadow = 850 + 300 * fbm(u * 7 + 3, v * 7 + 1, 11, 4);
  const north = smooth(-3500, -13500, z);
  const hills = north * (3400 + 2600 * fbm(u * 4 + 9, v * 4 + 2, 23, 5, true));
  const sides = smooth(6000, 12500, Math.abs(x)) * smooth(9000, 4000, z) * (1200 + 800 * fbm(u * 5 + 1, v * 5 + 7, 37, 4, true));
  // Toward the sea the meadows fall to a beach and the beach shelves under the water.
  const warp = (fbm(u * 6 + 5, v * 3, 41, 3) - 0.5) * 1400;
  const along = z + warp;
  const coast = lerp(meadow, 140, smooth(WORLD.coast - 2600, WORLD.coast, along));
  const shelf = lerp(140, WORLD.base + 200, smooth(WORLD.coast, WORLD.coast + 4200, along));
  const land = along < WORLD.coast ? coast : shelf;
  return land + hills + sides;
}

function lakeDistance(x, z) {
  const warp = (fbm(x / 3000, z / 3000, 51, 3) - 0.5) * 0.28;
  return Math.hypot((x - WORLD.lake.x) / WORLD.lake.rx, (z - WORLD.lake.z) / WORLD.lake.rz) + warp;
}

/** Each river as dense samples along it (x, z, its surface, its half width), so a bed is carved from every place on it at once. */
const riverSamples = rivers.map((curve) => {
  const out = [];
  for (let at = 0; at <= curve.length; at += 80) {
    const p = curve.position(at);
    out.push([p[0], p[2], p[1], curve.width(at) / 2]);
  }
  return out;
});

/**
 * The land with a river's bed and banks cut into it. Every piece of the river cuts its own valley (a bed under its surface, sides that
 * widen the deeper they run into the hill) and the ground keeps the lowest: a minimum of smooth cuts is smooth, where taking the
 * nearest place on the curve jumped from one leg of a bend to the other and left a cliff between them.
 */
function carve(h, natural, samples, x, z) {
  let low = h;
  // Between each pair of samples the river is a straight piece, its surface and width eased along it: the distance to the piece, not to
  // the sample points, so the valley's sides are smooth and not a row of scallops.
  for (let i = 0; i + 1 < samples.length; i++) {
    const [ax, az, as, ah] = samples[i], [bx, bz, bs, bh] = samples[i + 1];
    const ex = bx - ax, ez = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    const px = ax + ex * t, pz = az + ez * t;
    const surface = as + (bs - as) * t, half = ah + (bh - ah) * t;
    const outer = 1.25 + Math.max(0, natural - surface) / 140;
    const dx = x - px, dz = z - pz;
    const reach = (outer + 2) * half;
    if (dx * dx + dz * dz >= reach * reach) continue;
    const across = Math.sqrt(dx * dx + dz * dz) / half;
    const bed = surface - 170;
    const bank = Math.max(natural, surface + 60);
    const cut = lerp(lerp(bed, bank, smooth(0.55, outer, across)), natural, smooth(outer + 0.2, outer + 2, across));
    if (cut < low) low = cut;
  }
  return low;
}

/** The land with the lake's basin cut into it, before the rivers: where the lake's own shore is. */
function basinHeight(x, z) {
  const floor = WORLD.lake.floor + 140 * fbm(x / 1500, z / 1500, 61, 3);
  return lerp(floor, naturalHeight(x, z), smooth(0.62, 1.12, lakeDistance(x, z)));
}

/** The ground as the scene has it: the land, the lake's basin cut into it, and both rivers' beds laid along their splines. */
function groundHeight(x, z) {
  let h = basinHeight(x, z);
  const natural = naturalHeight(x, z);
  for (const samples of riverSamples) h = carve(h, natural, samples, x, z);
  return h;
}

/** The ground at every texel of the maps, computed once: the heightmap and the splatmap's slopes both read it. */
const grid = (() => {
  const n = WORLD.resolution;
  const out = new Float64Array(n * n);
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    out[py * n + px] = groundHeight((px / (n - 1) - 0.5) * WORLD.size, (py / (n - 1) - 0.5) * WORLD.size);
  }
  return out;
})();
const gridAt = (px, py) => {
  const n = WORLD.resolution;
  return grid[Math.min(n - 1, Math.max(0, py)) * n + Math.min(n - 1, Math.max(0, px))];
};

/** Sixteen bits across red (high) and green (low), over `base` to `base + height`. */
function heightmap() {
  const n = WORLD.resolution;
  const image = png(n, n, (px, py) => {
    const value = Math.round(Math.min(1, Math.max(0, (gridAt(px, py) - WORLD.base) / WORLD.height)) * 65535);
    return [value >> 8, value & 255, 0, 255];
  });
  write('assets/textures/height.png', image);
  meta('assets/textures/height.png', 'texture');
}

/**
 * The paint, as a splatmap: red grass, green sand, blue snow, alpha rock. Sand on the beach and the sea floor, round the lake and in
 * the rivers' beds; snow on the high ground; rock where it is steep; grass everywhere else.
 */
function splatmap() {
  const n = WORLD.resolution;
  const step = WORLD.size / (n - 1);
  const image = png(n, n, (px, py) => {
    const x = (px / (n - 1) - 0.5) * WORLD.size, z = (py / (n - 1) - 0.5) * WORLD.size;
    const h = gridAt(px, py);
    const slope = Math.hypot(gridAt(px + 1, py) - gridAt(px - 1, py), gridAt(px, py + 1) - gridAt(px, py - 1)) / (2 * step);
    const grain = fbm(x / 600, z / 600, 71, 3);
    const beach = 1 - smooth(180, 380, h - WORLD.sea + grain * 120);
    const lakeside = 1 - smooth(30, 140, Math.abs(h - WORLD.lake.level - 40) - 40);
    const banks = Math.max(...rivers.map((curve) => {
      const near = curve.nearest(x, z);
      return 1 - smooth(1.1, 2, near.distance / (curve.width(near.s) / 2));
    }));
    const sand = Math.max(beach, lakeDistance(x, z) < 1.25 ? lakeside : 0, banks) * (0.8 + 0.2 * grain);
    const snow = smooth(WORLD.snow - 200, WORLD.snow + 300, h + (grain - 0.5) * 500) * (1 - smooth(0.6, 1.1, slope));
    const rock = smooth(0.55, 0.95, slope) * (1 - sand);
    const grass = Math.max(0, 1 - sand - snow - rock);
    const sum = grass + sand + snow + rock || 1;
    return [255 * grass / sum, 255 * sand / sum, 255 * snow / sum, 255 * rock / sum];
  });
  write('assets/textures/splat.png', image);
  meta('assets/textures/splat.png', 'texture');
}

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

function texture(name, seed, shade) {
  const size = 512;
  const image = png(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const rgb = shade(u, v, (s, o, b) => fractal(u, v, seed + s, o, b));
    return [rgb[0], rgb[1], rgb[2], 255];
  });
  write(`assets/textures/${name}.png`, image);
  // Tiled by world position across the whole ground: it must repeat, or every texel past the first tile is its edge stretched.
  meta(`assets/textures/${name}.png`, 'texture', { wrapMode: 'repeat' });
}

/** Cellular noise that wraps every `period` cells: the distance to the nearest and the second-nearest feature point, for stones and cracks. */
function cells(u, v, period, seed) {
  const x = u * period, y = v * period;
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
    const px = cx + hash(wx, wy, seed), py = cy + hash(wx, wy, seed + 1);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hash(wx, wy, seed + 2); } else if (d < d2) d2 = d;
  }
  return { d1, d2, id };
}

function textures() {
  // Grass: a meadow seen from standing height. Patches of fresh and dry grass, clumps darker at their roots, blades as short strokes, a little earth between.
  texture('grass', 1, (u, v, n) => {
    const patch = n(0, 4, 2), dry = smooth(0.55, 0.8, n(10, 3, 3)), clump = n(20, 4, 12);
    const blade = tiled(u * 160, v * 40, 160, 91) * 0.5 + tiled(u * 40, v * 160, 40, 92) * 0.5;
    const earth = smooth(0.78, 0.9, n(30, 3, 20)) * (1 - clump);
    let c = mix([46, 78, 26], [92, 134, 44], patch);
    c = mix(c, [146, 140, 70], dry * 0.7);
    c = mix(c, [86, 70, 44], earth);
    return c.map((x) => x * (0.62 + 0.38 * clump) * (0.82 + 0.3 * blade));
  });
  // Sand: low ripples the wind combed across it, running one way and only gently bent (a contour of noise reads as rings), fading
  // in and out in patches; pebbles and broken shell scattered over.
  texture('sand', 2, (u, v, n) => {
    const bend = (n(0, 2, 2) - 0.5) * 0.6;
    const ripple = (Math.sin((v * 24 + u * 3 + bend) * Math.PI * 2) * 0.5 + 0.5) * smooth(0.35, 0.7, n(50, 3, 3));
    const grain = hash(Math.floor(u * 512), Math.floor(v * 512), 5);
    const stones = cells(u, v, 18, 21);
    const pebble = 1 - smooth(0.12, 0.2, stones.d1);
    let c = mix([170, 150, 114], [222, 204, 164], n(10, 4, 4));
    c = c.map((x) => x * (0.93 + 0.07 * ripple) * (0.93 + 0.1 * grain));
    return mix(c, mix([110, 104, 96], [196, 188, 172], stones.id), pebble * (stones.id > 0.55 ? 1 : 0));
  });
  // Snow: windblown, bluish in its hollows, with the odd glint.
  texture('snow', 3, (u, v, n) => {
    const drift = n(0, 4, 4), sparkle = hash(Math.floor(u * 512), Math.floor(v * 512), 7) > 0.985 ? 1.08 : 1;
    return mix([196, 210, 230], [252, 253, 255], smooth(0.2, 0.75, drift)).map((x) => Math.min(255, x * sparkle));
  });
  // Rock: strata running across it, cracks between blocks, weathered lighter on the faces, lichen in patches.
  texture('rock', 4, (u, v, n) => {
    const block = cells(u, v, 6, 31);
    const crack = smooth(0.0, 0.06, block.d2 - block.d1);
    const strata = Math.sin((v * 9 + n(0, 3, 3) * 1.6) * Math.PI * 2) * 0.5 + 0.5;
    const face = n(10, 5, 8);
    const lichen = smooth(0.62, 0.75, n(40, 4, 6));
    let c = mix([70, 68, 66], [138, 134, 126], face * 0.6 + strata * 0.25 + block.id * 0.25);
    c = mix(c, [118, 124, 82], lichen * 0.55);
    return c.map((x) => x * (0.35 + 0.65 * crack) * (0.85 + 0.25 * n(60, 3, 64)));
  });
  // The pine's colour: bark at the foot, then needles that darken toward the shade under each tier.
  const strip = png(8, 128, (x, y) => {
    const v = 1 - y / 127;
    if (v < 0.2) return mix([70, 50, 34], [96, 70, 48], hash(x, y, 7)).concat(255);
    const needles = 0.8 + 0.4 * hash(x, y, 9);
    return mix([22, 52, 30], [58, 104, 52], (v - 0.2) / 0.8).map((c) => c * needles).concat(255);
  });
  write('assets/textures/pine.png', strip);
  meta('assets/textures/pine.png', 'texture');
}

// ── the pine ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A pine: a trunk and five tiers of cone, ninety units tall at scale 1, with uv.y running up it (the strip's bark is its first fifth). */
function pine() {
  const pos = [], uv = [], nrm = [], idx = [];
  const vert = (x, y, z, nx, ny, nz, v) => { pos.push(x, y, z); uv.push(0.5, v); nrm.push(nx, ny, nz); return pos.length / 3 - 1; };
  const SIDES = 10, H = 90;
  const rings = [[0, 4.2], [20, 3.4], [60, 1.8]].map(([y, r]) => Array.from({ length: SIDES + 1 }, (_, k) => {
    const a = (k / SIDES) * Math.PI * 2;
    return vert(Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a), 0.1, Math.cos(a), (y / H) * 0.19);
  }));
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < SIDES; k++) {
    const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k], d = rings[i + 1][k + 1];
    idx.push(a, c, b, b, c, d);
  }
  for (const [low, high, radius] of [[16, 30, 26], [30, 44, 21], [44, 58, 16.5], [58, 72, 12], [70, 90, 7.5]]) {
    const slope = radius / (high - low), len = Math.hypot(1, slope);
    const ring = (y, r, v) => Array.from({ length: SIDES + 1 }, (_, k) => {
      const a = (k / SIDES) * Math.PI * 2;
      return vert(Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a) / len, slope / len, Math.cos(a) / len, v);
    });
    const skirt = ring(low, radius, 0.22 + (low / H) * 0.75), tip = ring(high, 0, 0.22 + (high / H) * 0.77);
    for (let k = 0; k < SIDES; k++) idx.push(skirt[k], tip[k], skirt[k + 1]);
    const centre = vert(0, low, 0, 0, -1, 0, 0.22);
    const under = Array.from({ length: SIDES + 1 }, (_, k) => {
      const a = (k / SIDES) * Math.PI * 2;
      return vert(Math.sin(a) * radius, low, Math.cos(a) * radius, 0, -1, 0, 0.22);
    });
    for (let k = 0; k < SIDES; k++) idx.push(centre, under[k], under[k + 1]);
  }
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
    { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
  ]);
  const count = pos.length / 3;
  const vertices = new Uint8Array(count * vertexStride);
  const view = new DataView(vertices.buffer);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const at = i * vertexStride;
    for (let k = 0; k < 3; k++) {
      view.setFloat32(at + channels[0].offset + k * 4, pos[i * 3 + k], true);
      view.setFloat32(at + channels[3].offset + k * 4, nrm[i * 3 + k], true);
      min[k] = Math.min(min[k], pos[i * 3 + k]);
      max[k] = Math.max(max[k], pos[i * 3 + k]);
    }
    view.setFloat32(at + channels[1].offset, uv[i * 2], true);
    view.setFloat32(at + channels[1].offset + 4, uv[i * 2 + 1], true);
    view.setUint32(at + channels[2].offset, 0xffffffff, true);
  }
  write('assets/models/pine.esmesh', Buffer.from(encodeMesh({ channels, vertexStride, vertexCount: count, vertices, indices: new Uint32Array(idx), aabbMin: min, aabbMax: max })));
  meta('assets/models/pine.esmesh', 'mesh');
}

// ── materials ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function material(name, shader, properties) {
  write(`assets/materials/${name}.esmaterial`, `${JSON.stringify({ version: '1.0', type: 'material', shader, blendMode: 0, depthTest: true, depthWrite: true, cull: 0, properties }, null, 2)}\n`);
  meta(`assets/materials/${name}.esmaterial`, 'material');
}

function materials() {
  const white = { r: 1, g: 1, b: 1, a: 1 };
  material('ground', 'builtin:terrain', {
    u_layer0: 'assets/textures/grass.png', u_layer1: 'assets/textures/sand.png', u_layer2: 'assets/textures/snow.png', u_layer3: 'assets/textures/rock.png',
    u_tint0: white, u_tint1: white, u_tint2: white, u_tint3: white,
    u_tile0: 900, u_tile1: 700, u_tile2: 1100, u_tile3: 1400, u_macroVariation: 0.45, u_sharpness: 1.4, u_blendNoise: 0.6, u_roughness: 0.95, u_heightBlend: 0.55, u_antiTile: 0.7, u_relief: 8,
    u_wetLevel: WORLD.sea, u_wetBand: 60,
  });
  // The stock water, scaled from metres to this world's centimetres: the same colours, absorbed over a hundred times the distance.
  const water = { u_density: 0.0011, u_rippleLength: 220, u_rippleStrength: 0.3, u_distortionRange: 300, u_refractionStrength: 0.6, u_edgeSoftness: 35, u_foamWidth: 45, u_foamCrest: 0.4,
    u_fallbackDepth: 400, u_causticScale: 220, u_roughness: 0.04 };
  material('water', 'builtin:water', water);
  material('crate', 'builtin:model', { u_metallic: 0, u_roughness: 0.8 });
  const grass = (base, tip, wind) => ({ u_baseColor: base, u_tipColor: tip, u_windStrength: wind, u_windSpeed: 1.2, u_windDirection: 30,
    u_gustScale: 0.0015, u_flutter: 0.35, u_translucency: 0.5 });
  material('meadow', 'builtin:foliage', grass({ r: 0.1, g: 0.2, b: 0.05, a: 1 }, { r: 0.5, g: 0.66, b: 0.22, a: 1 }, 6));
  material('flowers', 'builtin:foliage', grass({ r: 0.12, g: 0.22, b: 0.06, a: 1 }, { r: 0.98, g: 0.84, b: 0.3, a: 1 }, 6));
  material('reeds', 'builtin:foliage', grass({ r: 0.16, g: 0.2, b: 0.08, a: 1 }, { r: 0.62, g: 0.58, b: 0.32, a: 1 }, 10));
  material('pine', 'builtin:foliage', {
    u_albedo: 'assets/textures/pine.png', u_useTexture: 1, u_baseColor: white, u_tipColor: white,
    u_windStrength: 9, u_windSpeed: 0.9, u_windDirection: 30, u_gustScale: 0.0006, u_flutter: 0.1, u_translucency: 0.15, u_roughness: 0.9,
  });
}

// ── the scene ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function quat(yaw, pitch) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/**
 * The lake's outline in its own space: where its basin crosses the water's level, walked round from its middle. The basin's, not the
 * ground's: the rivers' beds run below the level too, and the engine ends each river at this shore and opens the shore there.
 */
function lakeOutline() {
  const points = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    let lo = 0, hi = 1.15;
    for (let i = 0; i < 30; i++) {
      const r = (lo + hi) / 2;
      const x = WORLD.lake.x + Math.cos(a) * WORLD.lake.rx * r, z = WORLD.lake.z + Math.sin(a) * WORLD.lake.rz * r;
      if (basinHeight(x, z) < WORLD.lake.level) lo = r; else hi = r;
    }
    points.push({ x: Math.round(Math.cos(a) * WORLD.lake.rx * (lo + 0.02)), y: Math.round(Math.sin(a) * WORLD.lake.rz * (lo + 0.02)) });
  }
  return points;
}

function scene() {
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const entities = [];
  const add = (name, components) => entities.push({ id: entities.length, name, parent: null, children: [], visible: true, components });
  const post = [
    { type: 'skyAtmosphere', enabled: true, uniforms: { u_intensity: 1, u_haze: 0.9, u_sunBrightness: 40, u_clouds: 0.4, u_cloudShadow: 0.6, u_unitsPerKm: 100000, u_windSpeed: 0.03 } },
    { type: 'gtao', enabled: true, uniforms: { u_radius: 300, u_intensity: 0.8 } },
    { type: 'heightFog', enabled: true, colors: { u_fogColor: { r: 0.66, g: 0.76, b: 0.88, a: 1 }, u_sunColor: { r: 1, g: 0.9, b: 0.7, a: 1 } },
      uniforms: { u_density: 0.000004, u_heightFalloff: 0.0003, u_baseHeight: WORLD.sea, u_inscatter: 0.5, u_skyFog: 0.4 } },
    { type: 'autoExposure', enabled: true, uniforms: { u_bias: 0, u_minEV: -2, u_maxEV: 2 } },
    { type: 'colorGrade', enabled: true, uniforms: { u_contrast: 1.06, u_saturation: 1.1 } },
    { type: 'bloom', enabled: true, uniforms: { u_threshold: 1, u_intensity: 0.3, u_radius: 1 } },
    { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
  ].filter((e) => !(process.env.TW_NOPOST ?? '').split(',').includes(e.type));
  // Over the sea, looking north: the waves and the crates, the beach, the river mouth, the lake, the river out of the hills, the snow.
  add('Camera', [
    { type: 'Transform', data: process.env.TW_TOP ? { position: { x: 1000, y: 30000, z: 1000 }, rotation: { x: -0.7071, y: 0, z: 0, w: 0.7071 } }
      : { position: { x: 3400, y: 3600, z: 15500 }, rotation: quat(0.08, -0.2) } },
    { type: 'Camera', data: { projectionType: 0, fov: 55, nearPlane: 10, farPlane: 120000, isActive: true, priority: 0 } },
    { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: post } },
  ]);
  // The HUD's canvas: the keys and what the scene is doing are drawn on it by the script.
  add('Canvas', [{ type: 'Transform', data: {} }, { type: 'Canvas', data: { designResolution: { x: 1480, y: 920 }, scaleMode: 2 } }, { type: 'UINode', data: {} }]);
  add('Clock', [{ type: 'Transform', data: {} }, { type: 'TimeOfDay', data: { hour: 15.5, daySeconds: 0, latitude: 40, declination: 15, north: 180, drive: 31 } }]);
  add('Sun', [{ type: 'Transform', data: {} },
    { type: 'Light', data: { type: 1, color: white, intensity: 3, enabled: true, meshShadows: true, shadowExtent: 16000, shadowStrength: 1, sourceAngle: 0.5 } }]);
  add('Sky', [{ type: 'Transform', data: {} }, { type: 'Light', data: { type: 2, color: { r: 0.8, g: 0.88, b: 1, a: 1 }, intensity: 0.6, enabled: true } }]);
  add('Ground', [
    { type: 'Transform', data: { position: { x: 0, y: WORLD.base, z: 0 } } },
    { type: 'Terrain', data: {
      sizeX: WORLD.size, sizeZ: WORLD.size, height: WORLD.height, cellSize: 30, detail: 1,
      heightmap: 'assets/textures/height.png', splatmap: 'assets/textures/splat.png', material: 'assets/materials/ground.esmaterial' } },
  ]);
  // The water: one zone over the whole island, which the sea, the lake and the two rivers are baked into and drawn from as one surface.
  add('Water', [
    { type: 'Transform', data: {} },
    { type: 'WaterZone', data: { sizeX: WORLD.size, sizeZ: WORLD.size, resolution: 1024, material: 'assets/materials/water.esmaterial',
      waveLength: 1600, waveSpeed: 1, waveDirection: 200, surf: 0.8, surfLength: 700, cellSize: 100, cells: 64, rings: 7,
      ripples: 128, rippleSize: 6000, rippleSpeed: 600, rippleDamping: 0.8, foamFade: 0.4 } },
  ]);
  add('Sea', [
    { type: 'Transform', data: { position: { x: 0, y: WORLD.sea, z: 0 } } },
    { type: 'WaterBody', data: { form: 0, waveHeight: 55, shoreWidth: 400 } },
  ]);
  add('Lake', [
    { type: 'Transform', data: { position: { x: WORLD.lake.x, y: WORLD.lake.level, z: WORLD.lake.z } } },
    { type: 'WaterBody', data: { form: 1, sizeX: WORLD.lake.rx * 2.4, sizeZ: WORLD.lake.rz * 2.4, boundary: lakeOutline(), shoreWidth: 300, waveHeight: 15 } },
  ]);
  for (const [name, points] of [['River In', WORLD.inflow], ['River Out', WORLD.outflow]]) {
    add(name, [
      { type: 'Transform', data: {} },
      { type: 'Spline', data: { points, closed: false } },
      { type: 'WaterBody', data: { form: 2, flowSpeed: 220, waveHeight: 6, shoreWidth: 60 } },
    ]);
  }
  // The weather turns by itself through the day's sky; W in the example turns it at once. TW_WEATHER=storm previews one.
  const presets = ['clear', 'mist', 'overcast', 'rain', 'storm'];
  add('Weather', [
    { type: 'Transform', data: {} },
    { type: 'Weather', data: { preset: Math.max(0, presets.indexOf(process.env.TW_WEATHER ?? 'clear')), target: -1, progress: 0, duration: 8,
      sequence: process.env.TW_WEATHER ? '' : 'clear,overcast,rain,storm,rain,clear', hold: 25, drive: 255 } },
  ]);
  // The plants: a meadow over the valley, flowers scattered in it, reeds where the ground is low by the lake and the rivers.
  const plants = (name, material, extra) => add(name, [
    { type: 'Transform', data: { position: { x: 1000, y: 0, z: 0 } } },
    { type: 'Foliage', data: { material, sizeX: 18000, sizeZ: 16000, cellSize: 1000, seed: 3, minScale: 0.7, maxScale: 1.4, minUp: 0.85,
      lodDistance: 1800, drawDistance: 4500, ...extra } },
  ]);
  plants('Meadow', 'assets/materials/meadow.esmaterial', { count: 2200, heightMin: WORLD.lake.level + 160, heightMax: WORLD.snow - 600, bladeHeight: 55, bladeWidth: 6 });
  plants('Flowers', 'assets/materials/flowers.esmaterial', { count: 160, seed: 11, heightMin: WORLD.lake.level + 200, heightMax: 2200, bladeHeight: 45, bladeWidth: 9 });
  plants('Reeds', 'assets/materials/reeds.esmaterial', { count: 1600, seed: 5, minUp: 0.75, heightMin: WORLD.lake.level - 40, heightMax: WORLD.lake.level + 140,
    bladeHeight: 150, bladeWidth: 4, waterDepth: 60 });
  add('Pines', [
    { type: 'Transform', data: { position: { x: 0, y: 0, z: -3000 } } },
    { type: 'Foliage', data: {
      mesh: 'assets/models/pine.esmesh', material: 'assets/materials/pine.esmaterial', sizeX: WORLD.size, sizeZ: 20000, cellSize: 1200, count: 2, seed: 8,
      minScale: 8, maxScale: 13, minUp: 0.8, heightMin: WORLD.lake.level + 900, heightMax: WORLD.snow - 150, lodDistance: 7000, drawDistance: 60000,
      cardU0: 0.2, cardV0: 0.22, cardU1: 0.8, cardV1: 0.95, cardTent: 1 } },
  ]);
  const crates = [...WORLD.crates.lake.map(([x, z]) => [x, z, WORLD.lake.level]), ...WORLD.crates.sea.map(([x, z]) => [x, z, WORLD.sea])];
  crates.forEach(([x, z, level], i) => {
    const size = 110 + 40 * hash(i, 3, 5);
    const half = size / 2;
    add(`Crate ${i + 1}`, [
      { type: 'Transform', data: { position: { x, y: level + 40, z }, rotation: quat(hash(i, 7, 9) * Math.PI, 0), scale: { x: size / 100, y: size / 100, z: size / 100 } } },
      { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true, opaque: true, cullBackfaces: true, material: 'assets/materials/crate.esmaterial',
        color: { r: 0.62 + 0.1 * hash(i, 1, 2), g: 0.42, b: 0.24, a: 1 } } },
      { type: 'RigidBody3D', data: { bodyType: 2, linearDamping: 0.05, angularDamping: 0.3 } },
      { type: 'BoxCollider3D', data: { halfExtents: { x: half, y: half, z: half }, friction: 0.5 } },
      { type: 'Floating', data: { buoyancy: 2, drag: 1, radius: half, wake: 1,
        points: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ({ x: a * half * 0.8, y: -half * 0.5, z: b * half * 0.8 })) } },
    ]);
  });
  // For looking at one thing at a time: TW_DROP=Lake,Pines leaves those out.
  const drop = (process.env.TW_DROP ?? '').split(',');
  const kept = entities.filter((e) => !drop.includes(e.name)).map((e, id) => ({ ...e, id }));
  write('assets/scenes/main.esscene', `${JSON.stringify({ version: 4, name: 'Terrain & Water', entities: kept }, null, 1)}\n`);
  meta('assets/scenes/main.esscene', 'scene');
}

heightmap();
splatmap();
textures();
pine();
materials();
scene();
console.log('terrain-water: written');
