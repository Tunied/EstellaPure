// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Bakes, finish, type WorkJob } from '../src/runtime/bakes';

function* counting(steps: number): WorkJob<string> {
    for (let i = 0; i < steps; i++) yield i / steps;
    return 'done';
}

/** A clock that moves a millisecond each time it is read. */
const ticking = (): (() => number) => { let t = 0; return () => t++; };

describe('jobs spread over frames', () => {
    it('step for the budget of a frame, show their progress, and settle with what they made', async () => {
        const bakes = new Bakes();
        bakes.budgetMs = 3;
        const job = bakes.run('Counting', counting(10));
        bakes.step(ticking());
        expect(bakes.active).toHaveLength(1);
        expect(bakes.active[0]!.label).toBe('Counting');
        expect(bakes.active[0]!.progress).toBeGreaterThan(0);
        expect(bakes.active[0]!.progress).toBeLessThan(1);
        for (let f = 0; f < 10; f++) bakes.step(ticking());
        await expect(job.done).resolves.toBe('done');
        expect(bakes.active).toHaveLength(0);
    });

    it('stop when cancelled, and show marks of work stepped elsewhere until they are done', () => {
        const bakes = new Bakes();
        const job = bakes.run('Never', counting(1000));
        job.cancel();
        expect(bakes.active).toHaveLength(0);
        const owner = {};
        bakes.mark(owner, 'Building', 0.25);
        expect(bakes.active).toEqual([{ label: 'Building', progress: 0.25 }]);
        bakes.mark(owner, 'Building', 1);
        expect(bakes.active).toHaveLength(0);
    });

    it('reject when the job throws', async () => {
        const bakes = new Bakes();
        const job = bakes.run('Broken', (function* () { yield 0; throw new Error('no'); })());
        bakes.step(ticking());
        bakes.step(ticking());
        await expect(job.done).rejects.toThrow('no');
    });

    it('run to their end at once for a caller with no frames', () => {
        expect(finish(counting(5))).toBe('done');
    });
});
