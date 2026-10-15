// The night the scene stands in, written as a Radiance panorama: a low cloud deck,
// a warm haze on the horizon, a skyline of lit windows, and a few neon accents.
// It is both looked at (the sky behind the grey-box) and reflected (the wet deck
// and the river mirror it), which is why it carries real HDR radiance on the
// windows and neon rather than a picture of them.
//
//   node tools/generate-night-env.mjs [width]
//   node ../../pipeline/bin/estella.mjs import-hdr assets/env/night.hdr assets/env
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = Number(process.argv[2]) || 2048;
const HEIGHT = WIDTH / 2;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(ROOT, 'assets', 'env'), { recursive: true });
const OUT = path.join(ROOT, 'assets', 'env', 'night.hdr');

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Integer hash -> [0,1), so every column and window is the same on each run.
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

const ZENITH = [0.010, 0.014, 0.028];
const CLOUD = [0.040, 0.050, 0.085];
const HAZE = [0.55, 0.30, 0.16];
const GROUND = [0.020, 0.018, 0.022];

// Azimuth 0 is +Z, the centre of the image; the camera looks to -Z, which is the
// seam (azimuth +-180). Degrees from the -Z axis, positive toward +X.
const fromForward = (phi) => {
  let d = (phi * 180) / Math.PI;
  d = d > 0 ? 180 - d : -180 - d;
  return d;
};

const COLUMN = 0.9;       // degrees of azimuth per skyline column
const NEON = [
  { at: 36, width: 1.1, top: 14, color: [14, 0.9, 7.5] },      // magenta banner, right
  { at: -62, width: 0.9, top: 11, color: [12, 0.8, 6.5] },     // magenta banner, left
  { at: 12, width: 0.45, top: 32, color: [0.8, 12, 16] },      // the tower's cyan strip
  { at: 7, width: 0.45, top: 32, color: [0.8, 12, 16] },
];

function radiance(dx, dy, dz, phi) {
  const elevation = (Math.asin(Math.max(-1, Math.min(1, dy))) * 180) / Math.PI;
  if (elevation < 0) return mix(GROUND, [0.05, 0.04, 0.035], clamp01(-elevation / 30));

  // Sky: dark zenith into a cloud deck, haze piling up at the horizon.
  let c = mix(CLOUD, ZENITH, smooth(5, 70, elevation));
  const cloud = 0.6 + 0.4 * Math.sin(phi * 9 + elevation * 0.55) * Math.sin(phi * 4.3 - elevation * 0.3);
  c = c.map((v) => v * cloud);
  c = mix(c, HAZE, Math.exp(-elevation / 5) * 0.35);

  // Skyline: columns of height set by a hash, denser and taller toward the middle.
  const az = fromForward(phi);
  const column = Math.floor((az + 180) / COLUMN);
  const h = 4 + hash(column * 7 + 3) * 22 * (1 - Math.min(1, Math.abs(az) / 140));
  const inside = elevation < h;
  if (inside) {
    let body = [0.012, 0.014, 0.022];
    // Windows: a grid inside each column, a hash decides which are lit and what colour.
    const u = ((az + 180) / COLUMN) % 1;
    const v = (elevation / 0.9) % 1;
    const gx = Math.floor(((az + 180) / COLUMN) * 3), gy = Math.floor(elevation / 0.9);
    const lit = hash(gx * 131 + gy * 977 + column) > 0.62;
    if (lit && u > 0.12 && u < 0.88 && v > 0.25 && v < 0.8 && elevation > 0.8) {
      const warm = hash(gx * 17 + gy * 5) > 0.2;
      body = warm ? [3.2, 1.7, 0.7] : [1.0, 1.9, 3.0];
      const fade = 1 - elevation / (h + 4);
      body = body.map((x) => x * fade * (0.5 + hash(gy * 3 + gx) * 0.7));
    }
    c = body;
  }

  // Neon accents stand above the skyline.
  for (const n of NEON) {
    if (Math.abs(az - n.at) < n.width && elevation < n.top && elevation > 0.6) c = n.color.map((x, i) => Math.max(c[i], x * (1 - elevation / (n.top + 6))));
  }

  // The tower: two dark shafts either side of the forward axis, taller than the rest.
  for (const sx of [-1, 1]) {
    const d = Math.abs(az - (9.5 + sx * 3.4));
    if (d < 1.9 && elevation < 33 - d * 3) c = [0.010, 0.012, 0.018];
  }
  return c;
}

function rgbe([r, g, b]) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) return [0, 0, 0, 0];
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const scale = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * scale)), Math.min(255, Math.floor(g * scale)),
          Math.min(255, Math.floor(b * scale)), e + 128];
}

function encodeScanline(pixels) {
  const out = [2, 2, (WIDTH >> 8) & 0xff, WIDTH & 0xff];
  for (let c = 0; c < 4; c++) {
    const ch = pixels.map((p) => p[c]);
    let i = 0;
    while (i < WIDTH) {
      let run = 1;
      while (i + run < WIDTH && run < 127 && ch[i + run] === ch[i]) run++;
      if (run >= 4) { out.push(128 + run, ch[i]); i += run; continue; }
      let lit = 0;
      while (i + lit < WIDTH && lit < 128) {
        const j = i + lit;
        if (j + 3 < WIDTH && ch[j] === ch[j + 1] && ch[j] === ch[j + 2] && ch[j] === ch[j + 3]) break;
        lit++;
      }
      out.push(lit, ...ch.slice(i, i + lit));
      i += lit;
    }
  }
  return out;
}

const header = `#?RADIANCE\n# generated for estella examples/neon-ascension (tools/generate-night-env.mjs)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`;
const body = [];
for (let y = 0; y < HEIGHT; y++) {
  const theta = ((y + 0.5) / HEIGHT) * Math.PI;
  const row = [];
  for (let x = 0; x < WIDTH; x++) {
    const phi = ((x + 0.5) / WIDTH - 0.5) * 2 * Math.PI;
    row.push(rgbe(radiance(Math.sin(phi) * Math.sin(theta), Math.cos(theta), Math.cos(phi) * Math.sin(theta), phi)));
  }
  body.push(...encodeScanline(row));
}
writeFileSync(OUT, Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body)]));
console.log(`${path.relative(process.cwd(), OUT)}: ${WIDTH}x${HEIGHT}`);
