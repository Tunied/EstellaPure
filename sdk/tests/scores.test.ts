// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { Scores } from '../src/services/scores';
const host = vi.hoisted(() => ({ initialized: true, submitScore: undefined as undefined | ((score: number) => Promise<void>) }));
vi.mock('../src/platform/base', () => ({ getPlatform: () => host, isPlatformInitialized: () => host.initialized }));
afterEach(() => { host.initialized=true; host.submitScore=undefined; });
it('reports absent capability and rejects submission instead of pretending success', async () => {
    expect(Scores.available).toBe(false);
    await expect(Scores.submit(12)).rejects.toThrow('unavailable');
    host.initialized=false; expect(Scores.available).toBe(false);
});
it('forwards finite scores with the host receiver and preserves host failures', async () => {
    const submitted=vi.fn(async function(this: unknown, _score: number) { expect(this).toBe(host); });
    host.submitScore=submitted; expect(Scores.available).toBe(true);
    await Scores.submit(12.5);expect(submitted).toHaveBeenCalledWith(12.5);
    for(const value of [NaN,Infinity,-Infinity]) await expect(Scores.submit(value)).rejects.toThrow('finite');
    expect(submitted).toHaveBeenCalledOnce();
    submitted.mockRejectedValueOnce(new Error('host failure'));
    await expect(Scores.submit(4)).rejects.toThrow('host failure');
});
