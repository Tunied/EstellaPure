// SPDX-License-Identifier: Apache-2.0

/** The keyboard gesture used by the foreground/background package comparison. */
export function suspendDrive(spec, hidden = null) {
  const ranges = hidden
    ? [{from: 0, to: hidden.from}, {from: hidden.to + 1, to: spec.frames}]
    : [{from: 0, to: spec.frames}];
  return {
    frames: spec.frames,
    hidden: hidden ? [hidden] : [],
    holds: spec.keys.flatMap(key => ranges.filter(range => range.from < range.to)
      .map(range => ({key, ...range}))),
  };
}
