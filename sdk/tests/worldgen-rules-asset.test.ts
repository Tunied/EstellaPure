// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  World rules as a project file: checked when read, refused with where they went wrong.
 */
import { describe, expect, it } from 'vitest';
import { isRulesFile, parseWorldRules } from '../src/worldgen/rulesAsset';

const good = {
    id: 'game:wilds', versions: [1],
    biomes: [{ id: 'forest', conditions: [{ field: 'moisture', min: 0.5 }], recipes: [{ recipe: 'grove', layer: 'groups', density: 0.7 }] }],
    recipes: [{ id: 'grove', version: 1, anchor: { id: 'oak', mesh: 'assets/models/oak.esmesh', footprint: 8 },
        members: [{ id: 'sapling', mesh: 'assets/models/oak.esmesh', count: [2, 4], ring: [10, 20], footprint: 2 }] }],
    layers: [{ id: 'groups', spacing: 100, drawDistance: 2000 }],
};

describe('a world rules file', () => {
    it('reads as the rules code would register', () => {
        const rules = parseWorldRules(JSON.parse(JSON.stringify(good)), 'wilds.esworld');
        expect(rules.id).toBe('game:wilds');
        expect(rules.recipes[0]!.members![0]!.count).toEqual([2, 4]);
        expect(rules.layers[0]!.spacing).toBe(100);
    });

    it('is refused with where it went wrong', () => {
        const bad = (patch: (r: any) => void) => { const r = JSON.parse(JSON.stringify(good)); patch(r); return () => parseWorldRules(r, 'wilds.esworld'); };
        expect(bad((r) => { r.versions = []; })).toThrow(/wilds\.esworld\.versions/);
        expect(bad((r) => { r.biomes[0].recipes[0].recipe = 'nothing'; })).toThrow(/no recipe "nothing"/);
        expect(bad((r) => { r.biomes[0].recipes[0].layer = 'nowhere'; })).toThrow(/no layer "nowhere"/);
        expect(bad((r) => { r.recipes[0].anchor.footprint = -1; })).toThrow(/anchor\.footprint/);
        expect(bad((r) => { r.recipes[0].members[0].count = [4, 2]; })).toThrow(/count/);
        expect(bad((r) => { r.layers[0].spacing = 0; })).toThrow(/spacing/);
    });

    it('is told apart from rules registered by code', () => {
        expect(isRulesFile('assets/worlds/wilds.esworld')).toBe(true);
        expect(isRulesFile('@uuid:0b0c8d64-4a3e-4b55-9b1b-2b0f5a0d8f21')).toBe(true);
        expect(isRulesFile('game:wilds')).toBe(false);
    });
});
