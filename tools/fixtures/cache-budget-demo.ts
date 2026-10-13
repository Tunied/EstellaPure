// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Assets } from '../../sdk/src/asset/Assets';
import { HttpBackend } from '../../sdk/src/asset/Backend';
import { contentHashHex } from '../../sdk/src/asset/contentHash';
import { nodeAdapter } from '../../sdk/src/platform/node';
import { setPlatform, platformWriteCacheFile } from '../../sdk/src/platform/base';
import type { AddressableManifest } from '../../sdk/src/asset/AddressableManifest';

const payload = (v: number) => new Uint8Array(8).fill(v);
const assetUrl = (root: string, v: number) => `${root}/${contentHashHex(payload(v))}.bin`;
const manifest = (root: string, v: number): AddressableManifest => ({ version: '2.0', revision: `v${v}`,
    groups: { cdn: { bundleMode: 'remote', labels: [], assets: { data: {
        path: assetUrl(root, v), contentHash: contentHashHex(payload(v)), type: 'json', size: 8, labels: [],
    } } } } });

/** Node's default key/value store is session-local. This fixture supplies a
 * durable host store (mini-games/native already have one) to prove a literal
 * process restart, while using the real engine disk-cache and update services. */
function host(scratch: string, offline: boolean) {
    process.env.ESENGINE_CACHE_DIR = join(scratch, 'cache');
    const stateDir = join(scratch, 'state');
    mkdirSync(stateDir, { recursive: true });
    const state = join(stateDir, 'active.json');
    nodeAdapter.getStorageItem = () => { try { return readFileSync(state, 'utf8'); } catch { return null; } };
    nodeAdapter.setStorageItem = (_key, value) => { writeFileSync(`${state}.tmp`, value); renameSync(`${state}.tmp`, state); };
    if (offline) nodeAdapter.fetch = async () => { throw Error('offline: network forbidden'); };
    setPlatform(nodeAdapter);
}
function assets(root: string) {
    const a = Assets.create({ module: null, backend: new HttpBackend({ baseUrl: '' }), manifest: manifest(root, 1) });
    a.setRemoteRoot(root);
    a.restorePersistedUpdate('cache-budget-demo');
    return a;
}
async function offline(scratch: string, root: string) {
    host(scratch, true);
    const a = assets(root);
    const backend = new HttpBackend({ baseUrl: '' });
    const current = new Uint8Array(await backend.fetchBinary(assetUrl(root, 3)));
    const rollback = new Uint8Array(await backend.fetchBinary(assetUrl(root, 2)));
    if (a.updateStatus().revision !== 'v3' || current.some(b => b !== 3) || rollback.some(b => b !== 2)) throw Error('offline verification failed');
    return { revision: a.updateStatus().revision, currentBytes: current.byteLength,
        rollbackBytes: rollback.byteLength, networkAllowed: false, freshProcess: true };
}

export async function run(scratch: string, bundle: string) {
    host(scratch, false);
    let revision = 2;
    let root = '';
    const server = createServer((req, res) => {
        if (req.url === '/manifest.json') res.end(JSON.stringify(manifest(root, revision)));
        else res.end(payload(revision));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
        const a = assets(root);
        await platformWriteCacheFile(assetUrl(root, 1), payload(1).buffer);
        const stages = [];
        for (revision of [2, 3]) {
            await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
            stages.push((await a.applyUpdate()).stages);
        }
        const before = await a.diskCacheReport();
        const preview = await a.cleanDiskCache(16);
        const cleaned = await a.cleanDiskCache(16, true);
        await new Promise<void>(resolve => server.close(() => resolve()));
        const restarted = JSON.parse(execFileSync(process.execPath, [bundle, '--offline', scratch, root], { encoding: 'utf8' }));
        return { stages, before: { bytes: before.usedBytes, protected: before.protectedBytes, reclaimable: before.reclaimableBytes },
            preview: { files: preview.candidates.length, releaseBytes: preview.releaseBytes },
            cleanup: { releaseBytes: cleaned.releaseBytes, remaining: cleaned.remainingBytes, budgetMet: cleaned.budgetMet }, offline: restarted };
    } finally { if (server.listening) server.close(); }
}
if (process.argv[2] === '--offline') console.log(JSON.stringify(await offline(process.argv[3], process.argv[4])));
