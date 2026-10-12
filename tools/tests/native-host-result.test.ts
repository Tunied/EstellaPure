// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
// @ts-expect-error plain JS verifier helper
import { requireNativeHostSuccess } from '../lib/nativeHostResult.mjs';

const successLog = 'bench: {"cpu":{"p50":1}}\n"rendered":true\nAOT: BenchThin is running compiled';
const child = (code: string, timeout = 5000) => spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout,
});

describe('native host acceptance requires process completion', () => {
    it('accepts results from a cleanly exited real child', () => {
        const result = child(`console.log(${JSON.stringify(successLog)})`);
        expect(result.stdout).toContain('bench:');
        expect(() => requireNativeHostSuccess(result, 'fixture')).not.toThrow();
    });
    it('rejects successful-looking output followed by a real nonzero exit', () => {
        const result = child(`console.log(${JSON.stringify(successLog)}); process.exit(7)`);
        expect(result.stdout).toContain('"rendered":true');
        expect(() => requireNativeHostSuccess(result, 'fixture')).toThrow(/fixture.*exit 7/);
    });
    it('rejects a real timeout even after successful-looking output', () => {
        const result = child(`console.log(${JSON.stringify(successLog)}); setInterval(()=>{},1000)`, 1000);
        expect(result.stdout).toContain('bench:');
        expect(() => requireNativeHostSuccess(result, 'fixture')).toThrow(/ETIMEDOUT/);
    });
    it('rejects a missing executable rather than accepting absent exit status', () => {
        const result = spawnSync(path.join(tmpdir(), randomUUID(), 'missing-host.exe'), [], { encoding: 'utf8' });
        expect(() => requireNativeHostSuccess(result, 'fixture')).toThrow(/ENOENT/);
    });
});
