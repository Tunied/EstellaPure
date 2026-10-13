// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Advance package simulation once per rendered frame, independent of runner speed. */
export function frameClockScript(ms) {
  if (!(Number.isFinite(ms) && ms > 0)) return '';
  return `<script>(() => {
    let now = performance.now(); let frame = -1;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((real) => {
      if (real !== frame) { frame = real; now += ${ms}; }
      cb(now);
    });
  })();</script>`;
}
