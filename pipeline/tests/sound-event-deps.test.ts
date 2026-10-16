// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../src/assets/assetDb';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

it('keeps every event candidate as a dependency, including disabled slots and moved UUID references', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-sound-event-')); roots.push(root);
    const clips = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const event = '33333333-3333-4333-8333-333333333333';
    for (let i = 0; i < clips.length; ++i) {
        writeFileSync(path.join(root, `${i}.wav`), 'audio fixture');
        writeFileSync(path.join(root, `${i}.wav.meta`), JSON.stringify({ uuid: clips[i], version: '2.0', type: 'audio', importer: {} }));
    }
    writeFileSync(path.join(root, 'steps.esaudioevent'), JSON.stringify({ version: 1, clips: clips.map((uuid, i) => ({ clip: `@uuid:${uuid}`, weight: i })) }));
    writeFileSync(path.join(root, 'steps.esaudioevent.meta'), JSON.stringify({ uuid: event, version: '2.0', type: 'json', importer: {} }));
    const first = await scanAssetDatabase(root, { write: false });
    expect(first.index.deps[event]).toEqual(clips);
    renameSync(path.join(root, '0.wav'), path.join(root, 'renamed.wav'));
    renameSync(path.join(root, '0.wav.meta'), path.join(root, 'renamed.wav.meta'));
    const second = await scanAssetDatabase(root, { write: false });
    expect(second.index.deps[event]).toEqual(clips);
    expect(second.index.entries.find(entry => entry.uuid === clips[0])?.path).toBe('renamed.wav');
});
