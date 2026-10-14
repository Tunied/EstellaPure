// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { it, expect } from 'vitest';
import { exampleFailureLines } from '../../build-tools/utils/exampleDiagnostics.js';
it('keeps compiler errors without repeating wrapper noise', () => {
    expect(exampleFailureLines({ message: 'Command failed', stdout: Buffer.from('src/game.ts(1,1): error TS2307: missing module\n') }))
        .toEqual(['src/game.ts(1,1): error TS2307: missing module']);
});
it('reports filesystem and process failures that contain no TS diagnostics', () => {
    expect(exampleFailureLines(new Error('EPERM: unlink temporary SDK mirror'))).toContain('EPERM: unlink temporary SDK mirror');
    expect(exampleFailureLines({ message: 'Compiler timed out', stderr: Buffer.from('Process killed\r\n') }))
        .toEqual(['Compiler timed out', 'Process killed']);
});
it('never returns an empty diagnostic for an unknown failure', () => {
    expect(exampleFailureLines({})).toEqual(['Example check failed without diagnostics.']);
});
