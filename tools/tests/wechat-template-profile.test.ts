// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseManifest } from '../../pipeline/src/project/format';
import { projectExportOptions } from '../../pipeline/src/export/projectExportOptions';
it('the actual WeChat starter ships minified and its Web authoring profile keeps development settings', async () => {
    const root = path.resolve(__dirname, '../../templates/wechat-minigame');
    const manifest = parseManifest(JSON.parse(readFileSync(path.join(root, 'project.esproject'), 'utf8')));
    expect(await projectExportOptions(root, manifest, 'wechat', 'wechat'))
        .toMatchObject({ minify: true, sourcemap: false, compressWasm: true, engineSubpackage: true });
    expect(await projectExportOptions(root, manifest, 'web', 'web'))
        .toMatchObject({ minify: false, sourcemap: true });
});
