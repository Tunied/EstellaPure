// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import net from 'node:net';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { runElectron } from './lib/electronRun.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1]; };
const dir = flag('dir'), specArg = flag('spec');
if (!dir || !specArg) throw new Error('verify-settings requires --dir and --spec');
const spec = JSON.parse(specArg);
const log = flag('log');
const record = value => {
  if (!log) return;
  mkdirSync(path.dirname(path.resolve(log)), {recursive: true});
  appendFileSync(log, JSON.stringify(value) + '\n');
};
const server = net.createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
// One new profile and one stable origin, reused across independent processes.
const profile = mkdtempSync(path.join(os.tmpdir(), 'estella-settings-'));
const names = [spec.label, ...spec.bars];
try {
  record({kind: 'session', startedAt: new Date().toISOString(), dir: path.resolve(dir)});
  for (let i = 0; i <= spec.expected.length; i++) {
    const restart = i === spec.expected.length;
    const pointer = restart ? spec.unlock : spec.control;
    const screenshot = log ? path.resolve(`${log}.launch-${i}.png`) : null;
    const run = runElectron(['--user-data-dir=' + profile, path.join(root, 'tools/launchers/launch-export.mjs'),
      '--dir', path.resolve(dir), '--port', String(port), '--w', String(spec.w), '--h', String(spec.h),
      '--input', JSON.stringify({ pointer, frames: spec.frames ?? 60 }), '--probe', names.join(','),
      ...(screenshot ? ['--out', screenshot] : [])], { cwd: root, encoding: 'utf8' });
    record({kind: 'launch', step: i, restart, screenshot, expected: spec.expected[restart ? i - 1 : i],
      status: run.status, signal: run.signal ?? null, timedOut: !!run.timedOut,
      error: run.error?.message, stdout: run.stdout ?? '', stderr: run.stderr ?? ''});
    if (run.status !== 0) throw new Error('settings restart ' + i + ' failed: status='
      + (run.status ?? 'none') + ' signal=' + (run.signal ?? 'none') + ' timedOut=' + !!run.timedOut
      + '\n' + (run.stdout || '') + (run.stderr || ''));
    const match = /probe: (\{.*\})/.exec(run.stdout || '');
    if (!match) throw new Error('settings launch produced no probe');
    const at = JSON.parse(match[1]).at;
    const expected = spec.expected[restart ? i - 1 : i];
    if (at?.[spec.label]?.text !== expected) throw new Error(`settings label was ${at?.[spec.label]?.text}, expected ${expected}`);
    const heights = spec.bars.map(name => at?.[name]?.h);
    if (!heights.length || heights.some(h => typeof h !== 'number' || !Number.isFinite(h))) throw new Error('settings spectrum probe was incomplete');
    const peak = Math.max(...heights);
    if (i >= spec.expected.length - 1 && peak !== spec.floor) throw new Error(`restored mute still produced output: ${peak}`);
    if (i === 0 && peak <= spec.floor) throw new Error('settings test began with no audible output');
    console.log(`settings restart ${i}: ${expected}, spectrum peak ${peak}`);
  }
  record({kind: 'complete', launches: spec.expected.length + 1});
  console.log('✓ settings survived process restart and restored mute affects output');
} finally {
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('estella-settings-')) {
    throw new Error('unexpected settings profile path');
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
