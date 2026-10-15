// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — .mjs verifier helper.
import { retainFirstLaunch } from '../lib/smokeEvidence.mjs';

const directories: string[] = [];
const fixture = () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'estella-launch-evidence-'));
    directories.push(directory);
    return directory;
};
afterEach(() => {
    for (const directory of directories.splice(0)) {
        if (!directory.startsWith(path.join(tmpdir(), 'estella-launch-evidence-'))) {
            throw new Error('Unexpected fixture cleanup path');
        }
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

it('keeps first-launch pixels, logs and verdict when the retry overwrites its files', () => {
    const directory = fixture(), shot = path.join(directory, 'android-chat.png');
    writeFileSync(shot, Buffer.from([1, 2, 3]));
    const first = retainFirstLaunch({
        ok: false, shot, log: 'first launch: 30 frames', frames: 30, colors: 1,
        why: 'flat frame', metrics: { readyMs: 812 },
    }, directory, 'android-chat');
    writeFileSync(shot, Buffer.from([4, 5, 6]));
    writeFileSync(path.join(directory, 'android-chat.log'), 'second launch');
    expect(readFileSync(first.shot)).toEqual(Buffer.from([1, 2, 3]));
    expect(readFileSync(first.logFile, 'utf8')).toBe('first launch: 30 frames');
    expect(JSON.parse(readFileSync(first.metadataFile, 'utf8'))).toMatchObject({
        ok: false, frames: 30, colors: 1, why: 'flat frame', metrics: { readyMs: 812 },
        shot: 'android-chat.first.png', logFile: 'android-chat.first.log',
    });
    expect(readFileSync(shot)).toEqual(Buffer.from([4, 5, 6]));
});

it('retains a failed launch record even when it produced no screenshot', () => {
    const directory = fixture();
    const first = retainFirstLaunch({ ok: false, log: 'no frame', why: 'not ready' }, directory, 'ios-chat');
    expect(first.shot).toBeUndefined();
    expect(readFileSync(first.logFile, 'utf8')).toBe('no frame');
    expect(JSON.parse(readFileSync(first.metadataFile, 'utf8')).shot).toBeNull();
});
