// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run from any cwd: node tools/cache-budget-demo.mjs
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scratch = await mkdtemp(join(tmpdir(), 'estella-cache-demo-'));
try {
    const entry = fileURLToPath(new URL('./fixtures/cache-budget-demo.ts', import.meta.url));
    const bundle = join(scratch, 'demo.mjs');
    await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
    const demo = await import(pathToFileURL(bundle).href);
    console.log(JSON.stringify(await demo.run(scratch, bundle), null, 2));
} finally {
    await rm(scratch, { recursive: true, force: true });
}
