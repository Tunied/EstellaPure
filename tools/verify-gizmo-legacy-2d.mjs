// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';
import { readPNG } from './lib/png.mjs';

if (!process.env.CI) throw Error('Editor acceptance runs only in CI; do not launch the local editor.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const out = path.join(root, 'output/gizmo-legacy-2d-ci');
fs.mkdirSync(out, { recursive: true });
const git = (args, cwd = root) => execFileSync('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const original = git(['rev-parse', 'HEAD'], desktop).toString().trim();
// Last editor revision before the RM-117 hover/size/plane/universal additions.
const baselineRoot = git(['rev-parse', '4005a25b5']).toString().trim();
const baseline = git(['ls-tree', baselineRoot, 'desktop']).toString().split(/\s+/)[2];
assert.match(baseline, /^[0-9a-f]{40}$/);
git(['cat-file', '-e', baseline + '^{commit}'], desktop);
const project = fs.mkdtempSync(path.join(out, 'legacy-project-'));
const prefix = 'examples/hello-world/';
for (const file of git(['ls-tree', '-r', '--name-only', baselineRoot, '--', prefix]).toString().trim().split('\n')) {
  assert(file.startsWith(prefix), 'Unexpected legacy asset');
  const target = path.resolve(project, file.slice(prefix.length));
  assert(target.startsWith(project + path.sep), 'Unexpected legacy output');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, git(['show', baselineRoot + ':' + file]));
}
const records = [];
const build = revision => {
  git(['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
    'checkout', '--detach', revision], desktop);
  const log = execFileSync('pnpm', ['--dir', 'desktop', 'exec', 'vite', 'build'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(out, revision + '-build.log'), log);
};
try {
  for (const [label, revision] of [['baseline', baseline], ['current', original]]) {
    build(revision);
    for (const mode of ['move', 'rotate', 'scale']) {
      const name = label + '-' + mode;
      const run = runElectron(['.'], { via: 'npx', encoding: 'utf8', cwd: desktop, timeout: 180000, env: {
        ESTELLA_SHOT: path.join(out, name + '.png'), ESTELLA_SHOT_PROJECT: project,
        ESTELLA_SHOT_SCENE: 'assets/scenes/main.esscene', ESTELLA_SHOT_CROP: '.viewport__stage canvas',
        ESTELLA_SHOT_EVAL: `(async()=>{
          const e=window.__estellaEditor;e.runCommand('mode.scene');e.surface.setViewPerspective(false);
          e.runCommand('view.resetOrbit');e.surface.select(1);e.frame([1]);
          await new Promise(r=>setTimeout(r,1000));e.runCommand('tool.${mode}');
          await new Promise(r=>setTimeout(r,200));
          const t=e.surface.serializeScene().entities.find(v=>v.id===1).components.find(c=>c.type==='Transform').data;
          return {view:e.editorView(),pose:{position:t.position,scale:t.scale??{x:1,y:1,z:1},rotation:t.rotation??{x:0,y:0,z:0,w:1}}};
        })()`,
      } });
      fs.writeFileSync(path.join(out, name + '.log'), run.stdout + '\n' + run.stderr);
      assert.equal(run.status, 0, run.stderr);
      const line = run.stdout.split('\n').find(s => s.startsWith('[eval] '));
      assert(line, 'Missing legacy project observation');
      records.push({ label, mode, revision, ...JSON.parse(line.slice(7)) });
      fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ baselineRoot, baseline, original, records }, null, 2));
    }
  }
  const comparisons = [];
  for (const mode of ['move', 'rotate', 'scale']) {
    const a = records.find(r => r.label === 'baseline' && r.mode === mode);
    const b = records.find(r => r.label === 'current' && r.mode === mode);
    assert.deepEqual(b.pose, a.pose, 'Legacy project transform changed');
    assert.deepEqual(b.view, a.view, 'Legacy project framing changed');
    const before = readPNG(fs.readFileSync(path.join(out, 'baseline-' + mode + '.png')));
    const after = readPNG(fs.readFileSync(path.join(out, 'current-' + mode + '.png')));
    assert.equal(before.w, after.w); assert.equal(before.h, after.h);
    let changed = 0, error = 0, pixels = 0;
    // Frame places the selected pivot at canvas center; cover the complete widget.
    for (let y = Math.floor(before.h / 2) - 90; y <= Math.floor(before.h / 2) + 90; y++) {
      for (let x = Math.floor(before.w / 2) - 90; x <= Math.floor(before.w / 2) + 90; x++) {
        const p = before.px(x, y), q = after.px(x, y);
        const delta = Math.max(...p.map((v, i) => Math.abs(v - q[i])));
        if (delta > 8) changed++;
        error += p.reduce((n, v, i) => n + Math.abs(v - q[i]), 0); pixels++;
      }
    }
    const result = { mode, changedFraction: changed / pixels, meanError: error / (pixels * 3) };
    comparisons.push(result);
    assert(result.changedFraction < 0.01 && result.meanError < 1, 'Flat 2D widget differs from pre-RM-117 baseline: ' + JSON.stringify(result));
  }
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ status: 'checks-passed', baselineRoot, baseline, original, records, comparisons }, null, 2));
  console.log('Legacy Hello World: move, rotate and scale widgets match the pre-RM-117 2D editor.');
} finally {
  if (git(['rev-parse', 'HEAD'], desktop).toString().trim() !== original) build(original);
  if (!project.startsWith(out + path.sep)) throw Error('Unexpected cleanup path');
  fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
