// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  When a package may take the engine without particles, post-processing and tilemaps.
 *
 * The failure this guards is a silent one: a particle effect that never draws because the engine that shipped has no
 * particles. So the answer is "lite" only when nothing reaches them, and every doubt carries everything.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { liteEngineAnswer, scriptsMentionOmitted } from '../src/export/liteEngine';

describe('the lite engine', () => {
    it('is for content that uses none of what it leaves out', () => {
        expect(liteEngineAnswer({ subsystems: ['text', 'physics'], scriptsMention: false })).toBe(true);
        for (const s of ['particles', 'postprocess', 'tilemap'] as const) {
            expect(liteEngineAnswer({ subsystems: [s], scriptsMention: false })).toBe(false);
        }
    });

    it('is not for a script that mentions one, or a project that asked for tilemaps', () => {
        expect(liteEngineAnswer({ subsystems: [], scriptsMention: true })).toBe(false);
        expect(liteEngineAnswer({ subsystems: [], scriptsMention: false, choices: { 'esengine/tilemap': 'include' } })).toBe(false);
        expect(liteEngineAnswer({ subsystems: [], scriptsMention: false, choices: { 'esengine/tilemap': 'exclude' } })).toBe(true);
    });

    it('reads the scripts for the names of what it leaves out', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'estella-lite-'));
        await mkdir(path.join(root, 'src', 'game'), { recursive: true });
        await writeFile(path.join(root, 'src', 'main.ts'), "import { Sprite } from 'esengine';\n");
        expect(await scriptsMentionOmitted(root)).toBe(false);
        await writeFile(path.join(root, 'src', 'game', 'fx.ts'), 'world.insert(e, ParticleEmitter, {});\n');
        expect(await scriptsMentionOmitted(root)).toBe(true);
    });
});
