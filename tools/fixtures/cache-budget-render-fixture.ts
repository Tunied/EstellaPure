// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportGame } from '../../pipeline/src/export/exportGame';
import { solidPng } from '../../pipeline/tests/fixtures/solidPng.mjs';

const acceptance = `
import { Assets as CacheAssets, Res as cacheRes, defineSystem as cacheDefineSystem } from 'esengine';
addSystemToSchedule(Schedule.Update, cacheDefineSystem([cacheRes(CacheAssets)], (assets) => {
    globalThis.__cacheAcceptance = {
        async apply(manifestUrl, remoteRoot) {
            const plan = await assets.checkForUpdate({ manifestUrl, remoteRoot });
            return { plan, result: await assets.applyUpdate() };
        },
        status: () => assets.updateStatus(),
    };
}, { name: 'CacheBudgetAcceptance' }));
`;

/** Real project exports. Only the driver hook and remote art vary; gameplay,
 * authoring metadata, the scene and the exporter are the shipped ones. */
export async function run(root: string, out: string, channel: string) {
    const colors = [[80, 80, 80, 255], [40, 190, 50, 255], [210, 40, 40, 255], [40, 70, 220, 255]];
    const results = [];
    for (let v = 0; v < colors.length; v++) {
        const source = path.join(out, `source-v${v}`);
        await mkdir(source, { recursive: true });
        await cp(path.join(root, 'examples/hot-update-demo'), source, { recursive: true,
            filter: p => !/(?:^|[\\/])(?:node_modules|dist)(?:[\\/]|$)/.test(p) });
        await writeFile(path.join(source, 'assets/cdn/art.png'), solidPng(64, 64, colors[v]));
        const scripts = path.join(source, 'src/main.ts');
        await writeFile(scripts, await readFile(scripts, 'utf8') + acceptance);
        const result = await exportGame({ root: source, outDir: path.join(out, `v${v}`), platform: 'wechat',
            entryScene: 'assets/scenes/main.esscene', scriptsEntry: 'src/main.ts',
            hostsDir: path.join(root, 'pipeline/src/runtime'), packagesDir: path.join(root, 'plugins'),
            sdkDistDir: path.join(root, 'sdk/dist'), wasmDir: path.join(root, 'build/wasm/wechat'),
            title: 'Cache Budget Acceptance', contentAddressed: true, compressWasm: true, engineSubpackage: true,
            minify: false, debugChannel: { url: channel, project: 'Cache Budget Acceptance' },
            hotUpdate: { persistUpdateKey: 'estella:cache-budget:render' },
        });
        if (!result.ok) throw Error(`v${v}: ${result.errors.join('; ')}`);
        results.push({ version: v, platform: result.platform, included: result.included, warnings: result.warnings });
    }
    await writeFile(path.join(out, 'exports.json'), JSON.stringify(results, null, 2));
    return results;
}
