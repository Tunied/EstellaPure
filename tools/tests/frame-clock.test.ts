// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { frameClockScript } from '../launchers/frameClock.mjs';

it('keeps simulation cadence fixed when the renderer stalls, without counting each callback as a frame', () => {
  const queued: Array<(time: number) => void> = [], observed: number[] = [];
  const window = { requestAnimationFrame: (cb: (time: number) => void) => { queued.push(cb); return queued.length; } };
  const script = frameClockScript(20).slice('<script>'.length, -'</script>'.length);
  runInNewContext(script, { window, performance: { now: () => 100 } });
  window.requestAnimationFrame(time => observed.push(time));
  window.requestAnimationFrame(time => observed.push(time));
  queued.splice(0).forEach(cb => cb(1000));
  window.requestAnimationFrame(time => observed.push(time));
  queued.splice(0).forEach(cb => cb(12000));
  expect(observed).toEqual([120, 120, 140]);
});
it('can leave the host clock untouched for real-time verification', () => {
  expect(frameClockScript(0)).toBe('');
  expect(frameClockScript(NaN)).toBe('');
});
