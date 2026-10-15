// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readPNG } from './png.mjs';

/** Compare captured legacy widgets at their selected world pivot, without an editor. */
export function compareLegacyGizmoFrames(directory) {
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'observations.json'), 'utf8'));
  const comparisons = [];
  for (const mode of ['move', 'rotate', 'scale']) {
    const a = evidence.records.find(r => r.label === 'baseline' && r.mode === mode);
    const b = evidence.records.find(r => r.label === 'current' && r.mode === mode);
    assert(a && b, 'Missing legacy observation: ' + mode);
    assert.deepEqual(b.pose, a.pose, 'Legacy project transform changed');
    assert.deepEqual(b.view, a.view, 'Legacy project framing changed');
    const before = readPNG(fs.readFileSync(path.join(directory, 'baseline-' + mode + '.png')));
    const after = readPNG(fs.readFileSync(path.join(directory, 'current-' + mode + '.png')));
    assert.equal(before.w, after.w); assert.equal(before.h, after.h);
    const pixelsPerUnit = before.h / (2 * a.view.orthoSize);
    const anchor = { x: before.w / 2 + (a.pose.position.x - a.view.x) * pixelsPerUnit,
      y: before.h / 2 - (a.pose.position.y - a.view.y) * pixelsPerUnit };
    assert(anchor.x >= 90 && anchor.x + 90 < before.w && anchor.y >= 90 && anchor.y + 90 < before.h,
      'Legacy widget is outside the comparison region');
    const probeX = Math.round(anchor.x + (mode === 'rotate' ? 42 : 35));
    const probeY = Math.round(anchor.y);
    for (const image of [before, after]) {
      let ink = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const [r, g, blue] = image.px(probeX + dx, probeY + dy);
        ink ||= mode === 'rotate' ? blue > 120 && blue > r * 1.5 && g > 100
          : r > 120 && r > g * 1.3 && r > blue * 1.3;
      }
      assert(ink, 'Missing visible transform handle in ' + mode + ' comparison');
    }
    let changed = 0, error = 0, pixels = 0;
    for (let y = Math.floor(anchor.y) - 90; y <= Math.floor(anchor.y) + 90; y++) {
      for (let x = Math.floor(anchor.x) - 90; x <= Math.floor(anchor.x) + 90; x++) {
        const p = before.px(x, y), q = after.px(x, y);
        const delta = p.reduce((n, v, i) => n + Math.abs(v - q[i]), 0);
        if (delta) changed++;
        error += delta; pixels++;
      }
    }
    const result = { mode, anchor, probe: { x: probeX, y: probeY }, pixels, changedPixels: changed,
      changedFraction: changed / pixels, meanError: error / (pixels * 3) };
    comparisons.push(result);
    assert.equal(changed, 0, 'Flat 2D widget differs from pre-RM-117 baseline: ' + JSON.stringify(result));
  }
  return { status: 'checks-passed', ...evidence, comparisons };
}
