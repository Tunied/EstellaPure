// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A project's saved environment looks are read tolerantly: a hand-edited file must not cost
 * the project, a bad entry is dropped, and a repeated name keeps the first.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest, ignoredManifestKeys } from '../src/project/format';

const base = { name: 'Sky', formatVersion: '1' };

describe('environmentPresets in the project file', () => {
    it('reads a look, and fills the defaults of a field it leaves out', () => {
        const m = parseManifest({ ...base, environmentPresets: [
            { name: 'Dusk', environment: 'assets/dusk.esenv', drawEnvironment: true, rotation: 90, intensity: 0.5 },
            { name: 'Plain', environment: '@uuid:abc' },
        ] });
        expect(m.environmentPresets).toEqual([
            { name: 'Dusk', environment: 'assets/dusk.esenv', drawEnvironment: true, rotation: 90, intensity: 0.5 },
            { name: 'Plain', environment: '@uuid:abc', drawEnvironment: false, rotation: 0, intensity: 1 },
        ]);
    });

    it('drops an entry that names no look or no environment, and keeps the rest', () => {
        const m = parseManifest({ ...base, environmentPresets: [
            null, { name: '', environment: 'a.esenv' }, { name: 'NoEnv' }, { name: 'Good', environment: 'a.esenv' },
        ] });
        expect(m.environmentPresets?.map((p) => p.name)).toEqual(['Good']);
    });

    it('keeps the first of a repeated name', () => {
        const m = parseManifest({ ...base, environmentPresets: [
            { name: 'Same', environment: 'a.esenv' }, { name: 'Same', environment: 'b.esenv' },
        ] });
        expect(m.environmentPresets).toHaveLength(1);
        expect(m.environmentPresets![0]!.environment).toBe('a.esenv');
    });

    it('leaves the field absent when no look survives, and does not report the key as unread', () => {
        expect(parseManifest({ ...base, environmentPresets: [{ name: '' }] }).environmentPresets).toBeUndefined();
        expect(ignoredManifestKeys({ ...base, environmentPresets: [] })).toEqual([]);
    });
});
