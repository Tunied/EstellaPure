// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error a build script, plain JavaScript
import { workerModule } from '../scripts/worker-source.mjs';

describe('the planning worker\'s script', () => {
    it('is what src/worldgen/planWorker.ts makes now (run node scripts/build-worker.mjs after changing it)', async () => {
        const made = await workerModule() as { path: string; source: string };
        expect(readFileSync(made.path, 'utf8')).toBe(made.source);
    });
});
