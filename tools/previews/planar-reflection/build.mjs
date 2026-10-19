// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';

const source = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(source, '../../..');
const output = path.join(repo, 'output/design/rm044-reflection');
await mkdir(output, { recursive: true });
const frame = path.join(repo, 'output/openpaas-authored-package-check/3d.png');
await build({
  entryPoints: [path.join(source, 'main.tsx')], outfile: path.join(output, 'preview.js'),
  bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.esscene': 'json' },
  nodePaths: [path.join(repo, 'desktop/node_modules')], alias: { '@': path.join(repo, 'desktop/src') },
  plugins: [{ name: 'isolated-scene-preview', setup(b) {
    b.onResolve({ filter: /^@\/engine\/(SceneCommands|SceneModel)$/ }, () => ({ path: path.join(source, 'adapter.ts') }));
  } }],
  define: { 'process.env.NODE_ENV': '"production"', HAS_REFERENCE_FRAME: String(existsSync(frame)) },
});
await copyFile(path.join(source, 'index.html'), path.join(output, 'index.html'));
if (existsSync(frame)) await copyFile(frame, path.join(output, 'reference-3d.png'));
console.log('Design preview: output/design/rm044-reflection/index.html');
