// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { execFile } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { containsPath as inside } from '../fs/pathSandbox';

/** Paths are relative to the config file. Secrets are files, never CLI literals. */
export interface OpenPaaSPackageConfig {
    mode: 'development' | 'platform';
    toolPath: string;
    gameId: string;
    version: string;
    privateKeyPath: string;
    encryptionKeyPath: string;
    publicKeyHash?: string;
    orientation?: 'portrait' | 'landscape';
    contextFile?: string;
    contextSignatureFile?: string;
    contextPublicKeyPath?: string;
}

export interface OpenPaaSPackageResult {
    file: string;
    bytes: number;
    sha256: string;
    mode: 'development' | 'platform';
    signatureAndFilesVerified: true;
    platformAcceptance: 'pending';
    toolSha256: string;
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function hashHex(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (/^[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
    const bytes = Buffer.from(value, 'base64');
    return bytes.length === 32 ? bytes.toString('hex') : null;
}
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** Do not copy links out of the export, or accidentally embed private keys. */
async function validateTree(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        const info = await lstat(file);
        if (info.isSymbolicLink()) throw new Error(`OpenPaaS package input contains a symbolic link: ${entry.name}`);
        if (info.isDirectory()) await validateTree(file);
        else if (!info.isFile()) throw new Error(`OpenPaaS package input contains a special file: ${entry.name}`);
    }
}

/** execFile keeps shell metacharacters out of command interpretation. Never
 * expose its Error.message: Node includes the encryption key in that message. */
function run(tool: string, args: string[], secrets: readonly string[]): Promise<string> {
    const redact = (text: string): string => secrets.reduce((s, secret) => secret ? s.split(secret).join('[redacted]') : s, text);
    return new Promise((resolve, reject) => execFile(tool, args,
        { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
            if (error) reject(new Error(`SUD packer failed (${error.code ?? 'process error'}): ${redact(stderr || stdout).slice(0, 4000)}`));
            else resolve(redact(stdout));
        }));
}

/** Generate a .sp with PinK's official tool, then verify every file before
 * replacing the destination. Input exports remain untouched. No network calls,
 * login, upload, review or publishing happen in this operation.
 */
export async function packageOpenPaaS(
    sourceDir: string, outputFile: string, configFile: string,
): Promise<OpenPaaSPackageResult> {
    const configPath = await realpath(configFile);
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(configPath, 'utf8')); }
    catch { throw new Error('OpenPaaS package config must be valid JSON'); }
    if (!object(parsed)) throw new Error('OpenPaaS package config must be an object');
    for (const key of ['toolPath', 'gameId', 'version', 'privateKeyPath', 'encryptionKeyPath']) {
        if (typeof parsed[key] !== 'string' || !(parsed[key] as string).trim()) {
            throw new Error(`OpenPaaS package config requires ${key}`);
        }
    }
    if (parsed.mode !== 'development' && parsed.mode !== 'platform') {
        throw new Error('OpenPaaS package config requires explicit development or platform mode');
    }
    if (parsed.orientation !== undefined && !['portrait', 'landscape'].includes(String(parsed.orientation))) {
        throw new Error('OpenPaaS orientation must be portrait or landscape');
    }
    const config = parsed as unknown as OpenPaaSPackageConfig;
    const resolve = (p: string): string => path.resolve(path.dirname(configPath), p);
    const source = await realpath(sourceDir);
    if (!(await stat(source)).isDirectory()) throw new Error('OpenPaaS input must be an exported directory');
    const output = path.resolve(outputFile);
    if (!output.endsWith('.sp')) throw new Error('OpenPaaS output must end in .sp');
    await mkdir(path.dirname(output), { recursive: true });
    const outputParent = await realpath(path.dirname(output));
    const destination = path.join(outputParent, path.basename(output));
    if (inside(source, destination)) throw new Error('OpenPaaS output must be outside the input directory');

    const keyFile = await realpath(resolve(config.privateKeyPath));
    const encryptionFile = await realpath(resolve(config.encryptionKeyPath));
    if (inside(source, keyFile) || inside(source, encryptionFile)) {
        throw new Error('OpenPaaS signing and encryption keys must be outside the package input');
    }
    const keyBytes = await readFile(keyFile);
    // Parse keys before executing a binary; malformed key errors must not echo contents.
    let privateKey: KeyObject;
    try {
        const text = keyBytes.toString('utf8').trim();
        if (text.startsWith('-----BEGIN')) privateKey = createPrivateKey(keyBytes);
        else {
            const seed = keyBytes.length === 32 ? keyBytes
                : /^[a-f\d]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
            privateKey = seed.length === 32
                ? createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), type: 'pkcs8', format: 'der' })
                : createPrivateKey({ key: keyBytes, type: 'pkcs8', format: 'der' });
        }
    } catch { throw new Error('OpenPaaS privateKeyPath must contain a valid Ed25519 private key'); }
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('OpenPaaS requires an Ed25519 private key');
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const publicRaw = publicKey.subarray(-32);
    const publicHash = digest(publicRaw);
    if (config.publicKeyHash !== undefined && hashHex(config.publicKeyHash) !== publicHash) {
        throw new Error('OpenPaaS publicKeyHash does not match the signing key');
    }
    const encryptionKey = (await readFile(encryptionFile, 'utf8')).trim();
    if (!/^[a-f\d]{32}$/i.test(encryptionKey)) throw new Error('OpenPaaS encryption key must be 16 bytes encoded as 32 hex characters');
    const secrets = [encryptionKey, keyBytes.toString('utf8').trim()];
    const tool = await realpath(resolve(config.toolPath));
    if (!(await stat(tool)).isFile()) throw new Error('OpenPaaS toolPath must name the official package executable');

    await validateTree(source);
    await stat(path.join(source, 'main.js'));
    const original: unknown = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
    if (!object(original)) throw new Error('OpenPaaS manifest must be an object');
    let context: Record<string, unknown> | undefined;
    let contextSignature: string | undefined;
    if (config.mode === 'platform') {
        if (!config.contextFile || !config.contextSignatureFile || !config.contextPublicKeyPath || !config.publicKeyHash) {
            throw new Error('Platform packaging requires the OpenPaaS signed context, signature, public key and registered publicKeyHash');
        }
        const contextText = (await readFile(resolve(config.contextFile), 'utf8')).trim();
        const value: unknown = JSON.parse(contextText);
        if (!object(value) || !object(value.game_info) || hashHex(value.game_info.public_key_hash) !== publicHash) {
            throw new Error('OpenPaaS context does not name this signing public key');
        }
        context = value;
        contextSignature = (await readFile(resolve(config.contextSignatureFile), 'utf8')).trim();
        const verified = await run(tool, ['--verify-payload', contextText, '--verify-signature', contextSignature,
            '--verify-public-key', resolve(config.contextPublicKeyPath)], secrets);
        // A non-zero status is rejected by run; the official tool owns payload validation.
        if (!verified.trim()) throw new Error('SUD packer returned no context verification result');
    }

    const temporaryRoot = await realpath(tmpdir());
    const temporary = await mkdtemp(path.join(temporaryRoot, 'estella-openpaas-'));
    const staged = path.join(temporary, 'input');
    const packageDir = await mkdtemp(path.join(outputParent, '.estella-sud-'));
    const pending = path.join(packageDir, 'package.sp');
    try {
        await cp(source, staged, { recursive: true });
        const manifest = { ...original,
            gameId: config.gameId, version: config.version,
            deviceOrientation: config.orientation ?? original.deviceOrientation ?? 'landscape',
            minRuntimeVersion: original.minRuntimeVersion ?? '2.0.0',
            permissions: original.permissions ?? [], networkTimeout: original.networkTimeout ?? {},
            workers: original.workers ?? '',
            ...(context ? { context, context_signature: contextSignature } : {}),
        };
        // Never leave a stale platform context attached to a local-development build.
        delete (manifest as Record<string, unknown>).keyPath;
        if (config.mode === 'development') {
            delete (manifest as Record<string, unknown>).context;
            delete (manifest as Record<string, unknown>).context_signature;
        }
        await writeFile(path.join(staged, 'manifest.json'), JSON.stringify(manifest, null, 2));
        await run(tool, ['--input', staged, '--output', pending, '--type', '1', '--compress', 'deflate',
            '--encrypt', '--global-key', encryptionKey, '--private-key', keyFile, '--public-key-hash', publicHash], secrets);
        const verification = await run(tool, ['--verify', pending, '--verify-all', '--global-key', encryptionKey,
            '--verify-public-key', publicRaw.toString('hex')], secrets);
        if (!/^verify_ok:\s*true\s*$/m.test(verification)) throw new Error('SUD packer did not confirm package verification');
        const bytes = await readFile(pending);
        const result: OpenPaaSPackageResult = { file: destination, bytes: bytes.length, sha256: digest(bytes),
            mode: config.mode, signatureAndFilesVerified: true, platformAcceptance: 'pending',
            toolSha256: digest(await readFile(tool)) };
        await rename(pending, destination);
        return result;
    } finally {
        // Verify resolved deletion targets remain direct children of their intended parents.
        if (path.dirname(path.resolve(temporary)) !== temporaryRoot
            || path.dirname(path.resolve(packageDir)) !== outputParent
            || !path.basename(temporary).startsWith('estella-openpaas-')
            || !path.basename(packageDir).startsWith('.estella-sud-')) {
            throw new Error('Unexpected OpenPaaS temporary cleanup path');
        }
        await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        await rm(packageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
}
