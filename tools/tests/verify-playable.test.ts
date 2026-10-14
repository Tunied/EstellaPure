// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePlayableScenario } from '../verify-playable.mjs';

const valid = { version: 1, viewports: [{ width: 360, height: 640 }], steps: [{ type: 'click', x: 0.5, y: 0.82, expect: { event: 'store-click', count: 1, userActivation: true } }] };
describe('playable scenario input', () => {
  it('accepts the shipping example and declares which networks support lifecycle checks', () => {
    const scenario = validatePlayableScenario(JSON.parse(readFileSync(new URL('../../examples/playable-ad/playable-check.json', import.meta.url), 'utf8')));
    expect(scenario.viewports).toHaveLength(2);
    expect(scenario.steps.find((step: any) => step.type === 'host' && step.command === 'hide').networks).not.toContain('google');
  });
  it.each([
    { ...valid, headless: false }, { ...valid, version: 2 }, { ...valid, viewports: [] },
    { ...valid, viewports: [{ width: 0, height: 640 }] }, { ...valid, steps: [] },
    { ...valid, steps: [{ type: 'eval', code: 'gameReady()' }] },
    { ...valid, steps: [{ type: 'click', x: 1.5, y: 0.5 }] },
    { ...valid, steps: [{ type: 'click', x: 0.5, y: 0.5, expect: null }] },
    { ...valid, steps: [{ type: 'click', x: 0.5, y: 0.5, expect: { event: 'store-click', count: -1 } }] },
    { ...valid, steps: [{ type: 'click', x: 0.5, y: 0.5, networks: ['unimplemented-network'] }] },
    { ...valid, steps: [{ type: 'host', command: 'show', expect: { event: 'store-click', count: 1 } }] },
    { ...valid, steps: [{ type: 'frozen', ms: 100000 }] },
  ])('rejects ambiguous/unsupported scenario instructions', scenario => {
    expect(() => validatePlayableScenario(scenario)).toThrow();
  });
});
