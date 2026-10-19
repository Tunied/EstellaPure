// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { runCommand, withBinaryenWorkers } from '../../build-tools/utils/emscripten.js';

it('bounds Windows workers while preserving explicit settings and other platforms', () => {
    const original = { PATH: 'toolchain' };
    expect(withBinaryenWorkers(original, 'win32')).toEqual({ ...original, BINARYEN_CORES: '4' });
    expect(original).toEqual({ PATH: 'toolchain' });
    for (const platform of ['win32', 'linux', 'darwin']) {
        expect(withBinaryenWorkers({ BINARYEN_CORES: '1' }, platform).BINARYEN_CORES).toBe('1');
    }
    expect(withBinaryenWorkers(original, 'linux')).toEqual(original);
    expect(withBinaryenWorkers(original, 'darwin')).toEqual(original);
});

it('passes per-command worker overrides to the actual child process', async () => {
    const result = await runCommand(process.execPath, [
        '-p', 'process.env.BINARYEN_CORES',
    ], { silent: true, env: { BINARYEN_CORES: '2' } });
    expect(result.stdout.trim()).toBe('2');
});

it('applies the platform default to the actual child process', async () => {
    const result = await runCommand(process.execPath, [
        '-p', 'process.env.BINARYEN_CORES',
    ], { silent: true, env: { BINARYEN_CORES: undefined } });
    expect(result.stdout.trim()).toBe(process.platform === 'win32' ? '4' : 'undefined');
});
