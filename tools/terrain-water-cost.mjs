// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  terrain-water-cost.mjs — what each part of the Terrain & Water example costs a frame, measured headless.
 *
 * Exports the real example as a web package, serves it, and plays it in a headless Chromium (no window, no editor)
 * once per variant. A variant is the scene with one thing taken away or turned down: an effect, the shadows, the
 * water, the plants, the multisampling. The frames are stepped by the game's own clock and the last one is read back,
 * so the time per frame is the GPU's (plus the engine's CPU, the same in every variant); the cost of a part is
 * the difference from the unchanged scene. The numbers belong to the machine and the camera they were taken on —
 * they say which parts are dear relative to each other, not what a part costs anywhere else.
 *
 *   node tools/terrain-water-cost.mjs                       # export, then measure every variant
 *   node tools/terrain-water-cost.mjs --only base,fog-off   # a few
 *   node tools/terrain-water-cost.mjs --dir <package> --view 2 --w 2560 --h 1440 --out cost.json
 *
 * `--view` picks the camera (0 is the scene's own; 1 to 4 are the example's viewpoints). The backend is WebGL2: the
 * package's `?headless` hook pins it.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveHost } from './lib/staticServer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const DIR = path.resolve(flag('dir', path.join(ROOT, 'output', 'tw-export')));
const W = Number(flag('w', '1920'));
const H = Number(flag('h', '1080'));
const FRAMES = Number(flag('frames', '12'));
const SAMPLES = Number(flag('samples', '7'));
const VIEW = Number(flag('view', '0'));
const ONLY = flag('only', '') ? new Set(flag('only', '').split(',')) : null;
const OUT = flag('out', path.join(ROOT, 'output', 'perf', 'terrain-water-cost.json'));
const NO_EXPORT = argv.includes('--no-export');

/** Where the example's other viewpoints are (the same poses as src/main.ts); null leaves the scene's camera. */
const VIEWS = [
  null,
  { pos: [-6300, 1175, 3000], yaw: -0.95, pitch: 0.1 },
  { pos: [-3350, 1070, -1000], yaw: -1.5, pitch: -0.2 },
  { pos: [4200, 2600, -2500], yaw: 1.9, pitch: -0.18 },
  { pos: [-3600, 3000, -6200], yaw: -0.15, pitch: -0.12 },
];
const quat = (yaw, pitch) => {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
};

const comp = (doc, type) => doc.entities.flatMap((e) => (e.components ?? []).filter((c) => c.type === type));
const volume = (doc) => comp(doc, 'PostProcessVolume')[0].data;
const dropEffects = (...types) => (doc) => { volume(doc).effects = volume(doc).effects.filter((e) => !types.includes(e.type)); };
const effect = (doc, type) => volume(doc).effects.find((e) => e.type === type);
const dropEntities = (...names) => (doc) => { doc.entities = doc.entities.filter((e) => !names.includes(e.name)); };
const WATER = ['Water', 'Sea', 'Lake', 'River In', 'River Out', 'Crate 1', 'Crate 2', 'Crate 3', 'Crate 4', 'Crate 5', 'Crate 6', 'Crate 7', 'Crate 8', 'Crate 9'];
const PLANTS = ['Plants', 'Flower sea'];
const quality = (level, profile) => (cfg) => { cfg.quality = { ...cfg.quality, mode: level, ...(profile ? { profiles: { [level]: profile } } : {}) }; };

/** Each variant: what to take away, relative to `base`. Edits to the scene, or to the package's quality config. */
const VARIANTS = [
  { id: 'base', label: 'the scene as authored (quality high)' },
  // Whole families
  { id: 'no-post', label: 'no post-process volume at all', scene: (d) => { volume(d).effects = []; } },
  { id: 'no-water', label: 'no water (zone, bodies, crates)', scene: dropEntities(...WATER) },
  { id: 'no-plants', label: 'no plants (world generation)', scene: dropEntities(...PLANTS) },
  { id: 'no-terrain', label: 'no terrain (and no plants on it)', scene: dropEntities('Ground', ...PLANTS) },
  { id: 'no-shadows', label: 'the sun casts no shadow', scene: (d) => { for (const l of comp(d, 'Light')) l.data.meshShadows = false; } },
  // One effect at a time
  { id: 'sky-off', label: 'sky atmosphere off', scene: dropEffects('skyAtmosphere') },
  { id: 'gtao-off', label: 'ambient occlusion (gtao) off', scene: dropEffects('gtao') },
  { id: 'fog-off', label: 'height fog off', scene: dropEffects('heightFog') },
  { id: 'volumetric-off', label: 'fog on, volumetric light 0', scene: (d) => { effect(d, 'heightFog').uniforms.u_volumetric = 0; } },
  { id: 'autoexposure-off', label: 'auto exposure off', scene: dropEffects('autoExposure') },
  { id: 'bloom-off', label: 'bloom off', scene: dropEffects('bloom') },
  { id: 'lensflare-off', label: 'lens flare off', scene: dropEffects('lensFlare') },
  { id: 'grade-off', label: 'colour grade + display LUT off', scene: dropEffects('colorGrade', 'displayLut') },
  { id: 'fxaa-off', label: 'fxaa off', scene: dropEffects('fxaa') },
  // Quality knobs, one at a time from high
  { id: 'msaa-1', label: 'no multisampling', config: quality('high', { msaaSamples: 1 }) },
  { id: 'msaa-2', label: 'msaa 2x', config: quality('high', { msaaSamples: 2 }) },
  { id: 'cascades-2', label: 'two shadow cascades', config: quality('high', { shadowCascades: 2 }) },
  { id: 'atlas-2048', label: 'shadow atlas 2048', config: quality('high', { shadowAtlasSize: 2048, shadowCellSize: 512 }) },
  { id: 'scale-75', label: 'render scale 0.75', config: quality('high', { renderScale: 0.75 }) },
  { id: 'waves-2', label: 'two waves per water', config: quality('high', { waterWaves: 2 }) },
  { id: 'detail-50', label: 'plant detail scale 0.5', config: quality('high', { detailScale: 0.5 }) },
  // Levels as a project would ship them
  { id: 'medium', label: 'quality medium', config: quality('medium') },
  { id: 'low', label: 'quality low', config: quality('low') },
  { id: 'base-again', label: 'the scene again, to see the machine drift' },
];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function measure(server, original, variant, browser) {
  const doc = JSON.parse(original.scene);
  const cfg = JSON.parse(original.config);
  variant.scene?.(doc);
  variant.config?.(cfg);
  const view = VIEWS[VIEW];
  if (view) {
    const cam = doc.entities.find((e) => e.name === 'Camera').components.find((c) => c.type === 'Transform');
    cam.data.position = { x: view.pos[0], y: view.pos[1], z: view.pos[2] };
    cam.data.rotation = quat(view.yaw, view.pitch);
  }
  await writeFile(path.join(DIR, 'assets/scenes/main.esscene'), JSON.stringify(doc));
  await writeFile(path.join(DIR, 'game.config.json'), JSON.stringify(cfg));

  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts && window.__estellaCooked.bakes, null, { timeout: 120000 });
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    // The world lays itself out and the plants grow on worker threads; a frame measured before they are done is a different scene.
    const settled = await page.evaluate(async () => {
      const c = window.__estellaCooked;
      for (let i = 0; i < 600; i++) {
        await c.step(2, 1 / 60);
        if (c.bakes().length === 0 && i > 20) return i;
        await new Promise((r) => setTimeout(r, 50));
      }
      return -1;
    });
    const result = await page.evaluate(async ({ frames, samples }) => {
      const c = window.__estellaCooked;
      const px = new Uint8Array(4);
      const gl = document.querySelector('canvas').getContext('webgl2') ?? null;
      const sync = () => { const r = c.capture(); return r.rgba[0]; };
      c.render(); c.costs();  // engages the profilers: the counters and the CPU split are read after the samples
      await c.step(frames, 1 / 60); sync();
      const ms = [];
      for (let s = 0; s < samples; s++) {
        const t0 = performance.now();
        await c.step(frames, 1 / 60);
        sync();
        ms.push((performance.now() - t0) / frames);
      }
      const costs = c.costs();
      const cpu = costs.systems.reduce((a, x) => a + x.ms, 0);
      return { ms, counters: c.render(), cpu, native: costs.native, size: [document.querySelector('canvas').width, document.querySelector('canvas').height], gl: !!gl };
    }, { frames: FRAMES, samples: SAMPLES });
    return { ms: median(result.ms), cpu: result.cpu, native: result.native, min: Math.min(...result.ms), max: Math.max(...result.ms), settled, counters: result.counters, size: result.size, errors };
  } finally {
    await context.close();
  }
}

if (!NO_EXPORT) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline/bin/estella.mjs'), 'export', path.join(ROOT, 'examples/terrain-water'), '--out', DIR, '--platform', 'web'], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('terrain-water-cost: the export failed'); process.exit(1); }
}
if (!existsSync(path.join(DIR, 'index.html'))) { console.error(`terrain-water-cost: no package at ${DIR}`); process.exit(2); }

const original = {
  scene: await readFile(path.join(DIR, 'assets/scenes/main.esscene'), 'utf8'),
  config: await readFile(path.join(DIR, 'game.config.json'), 'utf8'),
};
const server = await serveHost(DIR);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-swiftshader'],
});
const table = {};
let adapter = '';
try {
  const probe = await browser.newPage();
  adapter = await probe.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await probe.close();
  console.log(`adapter: ${adapter}   ${W}x${H}   view ${VIEW}   ${SAMPLES} samples of ${FRAMES} frames`);
  for (const v of VARIANTS) {
    if (ONLY && !ONLY.has(v.id)) continue;
    // A page can die under a variant (the GPU process, memory); say so and carry on with the rest, once retried.
    let r;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try { r = await measure(server, original, v, browser); } catch (e) { console.log(`${v.id.padEnd(17)} failed (${String(e.message).split(String.fromCharCode(10))[0]})${attempt === 0 ? ', retrying' : ''}`); }
    }
    if (!r) { table[v.id] = { label: v.label, failed: true }; continue; }
    table[v.id] = { label: v.label, ...r };
    console.log(`${v.id.padEnd(17)} ${r.ms.toFixed(2).padStart(7)} ms   [${r.min.toFixed(2)}..${r.max.toFixed(2)}]   cpu ${r.cpu.toFixed(2)}   draws ${r.counters['batch.draws'] ?? '?'}  shadow ${r.counters['render.shadow.draws'] ?? '?'}  tris ${((r.counters['render.triangles'] ?? 0) / 1e6).toFixed(2)}M   ${r.errors.length ? 'ERRORS ' + r.errors[0] : ''}`);
  }
} finally {
  await writeFile(path.join(DIR, 'assets/scenes/main.esscene'), original.scene);
  await writeFile(path.join(DIR, 'game.config.json'), original.config);
  await browser.close();
  await new Promise((r) => server.close(r));
}

const base = table.base?.ms;
for (const [id, r] of Object.entries(table)) if (base !== undefined && !r.failed) r.vsBase = +(r.ms - base).toFixed(3);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ adapter, size: [W, H], view: VIEW, frames: FRAMES, samples: SAMPLES, table }, null, 1));
console.log(`\nwritten ${path.relative(ROOT, OUT)}`);
