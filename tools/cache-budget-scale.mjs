// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Same deterministic resource/three-version index for before/after CPU timing.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'estella-cache-scale-'));
try {
    const bundle = path.join(scratch, 'scale.mjs');
    await build({ entryPoints: [path.join(root, 'tools/fixtures/cache-budget-scale.ts')],
        outfile: bundle, bundle: true, format: 'esm', platform: 'node' });
    const { run } = await import(pathToFileURL(bundle).href);
    console.log(JSON.stringify(await run(), null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
