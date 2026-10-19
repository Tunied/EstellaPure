// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageOpenPaaS, type OpenPaaSPackageConfig } from '../src/export/openpaasPackage';

let root: string, source: string, configFile: string, out: string;
let config: OpenPaaSPackageConfig;
let pair: { privateKey: KeyObject; publicKey: KeyObject };
beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sud-package-test-'));
    source = path.join(root, 'input'); configFile = path.join(root, 'local.json'); out = path.join(root, 'game.sp');
    await mkdir(source);
    await writeFile(path.join(source, 'main.js'), 'console.log("test");');
    await writeFile(path.join(source, 'manifest.json'), '{"context":{"stale":true},"context_signature":"stale"}');
    pair = generateKeyPairSync('ed25519');
    await writeFile(path.join(root, 'private.pem'), pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    await writeFile(path.join(root, 'encryption.hex'), randomBytes(16).toString('hex'));
    config = { mode: 'development', gameId: 'estella-local-test', version: '0.1.0',
        toolPath: process.env.ESTELLA_SUD_PACKER ?? process.execPath,
        privateKeyPath: 'private.pem', encryptionKeyPath: 'encryption.hex' };
    await save();
});
async function save() { await writeFile(configFile, JSON.stringify(config)); }
afterEach(async () => {
    const parent = await import('node:fs/promises').then(fs => fs.realpath(tmpdir()));
    const target = path.resolve(root);
    if (path.dirname(target) !== parent || !path.basename(target).startsWith('sud-package-test-')) throw Error('Unexpected cleanup root');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('OpenPaaS package boundary', () => {
    it('rejects output inside its input and never overwrites runtime files', async () => {
        await expect(packageOpenPaaS(source, path.join(source, 'game.sp'), configFile)).rejects.toThrow('outside the input');
        expect(await readFile(path.join(source, 'main.js'), 'utf8')).toBe('console.log("test");');
    });
    it('refuses to embed signing secrets stored inside the package source', async () => {
        await writeFile(path.join(source, 'secret.hex'), randomBytes(16).toString('hex'));
        config.encryptionKeyPath = 'input/secret.hex'; await save();
        await expect(packageOpenPaaS(source, out, configFile)).rejects.toThrow('keys must be outside');
    });
    it('checks the registered public key hash before running the packer', async () => {
        config.publicKeyHash = '0'.repeat(64); await save();
        await expect(packageOpenPaaS(source, out, configFile)).rejects.toThrow('does not match');
    });
    it('requires a platform-signed context for platform mode', async () => {
        config.mode = 'platform'; await save();
        await expect(packageOpenPaaS(source, out, configFile)).rejects.toThrow('signed context');
    });
    it('does not echo an invalid encryption secret', async () => {
        await writeFile(path.join(root, 'encryption.hex'), 'SECRET-IN-INVALID-KEY');
        const error = await packageOpenPaaS(source, out, configFile).catch(e => e);
        expect(String(error)).toContain('16 bytes'); expect(String(error)).not.toContain('SECRET-IN-INVALID-KEY');
    });
});

// Optional because PinK supplies Windows/macOS tools, not the Linux CI host.
// The actual executable must be explicitly provided; these are not host mocks.
describe.runIf(Boolean(process.env.ESTELLA_SUD_PACKER))('official SUD executable', () => {
    it('creates, signs and verifies all files without modifying the source', async () => {
        const before = await readFile(path.join(source, 'manifest.json'), 'utf8');
        const result = await packageOpenPaaS(source, out, configFile);
        expect(result).toMatchObject({ mode: 'development', signatureAndFilesVerified: true, platformAcceptance: 'pending' });
        expect(result.bytes).toBe((await stat(out)).size);
        expect(result.sha256).toBe(createHash('sha256').update(await readFile(out)).digest('hex'));
        expect(await readFile(path.join(source, 'manifest.json'), 'utf8')).toBe(before);
    });
    it('supports the raw hex private key format used by the official key generator', async () => {
        const der = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
        await writeFile(path.join(root, 'private.hex'), der.subarray(-32).toString('hex'));
        config.privateKeyPath = 'private.hex'; await save();
        expect((await packageOpenPaaS(source, out, configFile)).signatureAndFilesVerified).toBe(true);
    });
    it('verifies context signatures and rejects corrupt contexts without replacing an existing package', async () => {
        const publicRaw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
        config.publicKeyHash = createHash('sha256').update(publicRaw).digest('hex');
        const context = JSON.stringify({ game_info: { public_key_hash: config.publicKeyHash } });
        await writeFile(path.join(root, 'context.json'), context);
        await writeFile(path.join(root, 'context.sig'), sign(null, Buffer.from(context), pair.privateKey).toString('base64'));
        await writeFile(path.join(root, 'context-public.hex'), publicRaw.toString('hex'));
        Object.assign(config, { mode: 'platform', contextFile: 'context.json', contextSignatureFile: 'context.sig', contextPublicKeyPath: 'context-public.hex' });
        await save();
        const result = await packageOpenPaaS(source, out, configFile);
        expect(result.platformAcceptance).toBe('pending');
        const before = await readFile(out);
        await writeFile(path.join(root, 'context.sig'), Buffer.alloc(64).toString('base64'));
        await expect(packageOpenPaaS(source, out, configFile)).rejects.toThrow('SUD packer failed');
        expect(await readFile(out)).toEqual(before);
    });
});
