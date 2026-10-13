// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const mock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../build-tools/utils/emscripten.js', () => ({ runCommand: mock.run, getCpuCount: () => 1 }));
import { optimizeWasmFiles } from '../../build-tools/tasks/wasm.js';
const valid = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
let root: string, original: string;
beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'estella-wasm-opt-'));
    await mkdir(path.join(root, 'sdk'));
    original = path.join(root, 'sdk/engine.wasm');
    await writeFile(original, valid);
    mock.run.mockReset();
});
afterEach(async () => { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
const outputs = { 'sdk/engine.wasm': 'wasm/web/engine.wasm' };

it('leaves a valid linked artifact intact and fails the build when optimization crashes after writing output', async () => {
    mock.run.mockImplementation(async (_cmd, args: string[]) => {
        await writeFile(args[args.indexOf('-o') + 1], 'partial output');
        throw Error('optimizer crashed');
    });
    await expect(optimizeWasmFiles(root, outputs)).rejects.toThrow('optimizer crashed');
    expect(new Uint8Array(await readFile(original))).toEqual(valid);
    expect(await readdir(path.join(root, 'sdk'))).toEqual(['engine.wasm']);
});

it('rejects invalid output even when the optimizer exits successfully', async () => {
    mock.run.mockImplementation(async (_cmd, args: string[]) => { await writeFile(args[args.indexOf('-o') + 1], 'invalid'); });
    await expect(optimizeWasmFiles(root, outputs)).rejects.toThrow('invalid WASM');
    expect(new Uint8Array(await readFile(original))).toEqual(valid);
});

it('commits a validated optimization without making input and output the same file', async () => {
    mock.run.mockImplementation(async (_cmd, args: string[]) => {
        const output = args[args.indexOf('-o') + 1];
        expect(output).not.toBe(original);
        expect(args.at(-1)).toBe(original);
        await writeFile(output, valid);
    });
    await optimizeWasmFiles(root, outputs);
    expect(new Uint8Array(await readFile(original))).toEqual(valid);
    expect(await readdir(path.join(root, 'sdk'))).toEqual(['engine.wasm']);
});
