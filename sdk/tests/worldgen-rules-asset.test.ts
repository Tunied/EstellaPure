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

describe('plants in a world rules file', () => {
    const withPlants = () => {
        const r = JSON.parse(JSON.stringify(good));
        r.plants = {
            oak: { parts: [{ mesh: 'assets/oak_trunk.esmesh', material: 'assets/bark.esmaterial' }, { mesh: 'assets/oak_crown.esmesh', lod1Mesh: 'assets/oak_crown1.esmesh', opaque: true }],
                lodDistance: 6000, drawDistance: 16000, far: [{ mesh: 'assets/oak_cards.esmesh', soft: 0.85, castShadows: false }], farDistance: 200000, farKeep: 0.25, tints: [[0.9, 1, 0.9], [1, 1, 1]], sink: 8 },
        };
        r.recipes[0].anchor = { id: 'oak', plant: 'oak', footprint: 8 };
        delete r.recipes[0].anchor.mesh;
        return r;
    };

    it('names the plants a member is, with their parts, far version and colourings', () => {
        const rules = parseWorldRules(withPlants(), 'wilds.esworld');
        expect(rules.recipes[0]!.anchor.plant).toBe('oak');
        expect(rules.recipes[0]!.anchor.mesh).toBeUndefined();
        const oak = rules.plants!.oak!;
        expect(oak.parts).toHaveLength(2);
        expect(oak.parts[1]!.lod1Mesh).toBe('assets/oak_crown1.esmesh');
        expect(oak.far[0]!.mesh).toBe('assets/oak_cards.esmesh');
        expect(oak.far[0]!.soft).toBe(0.85);
        expect(oak.far[0]!.castShadows).toBe(false);
        expect(oak.parts[0]!.castShadows).toBeUndefined();
        expect(oak.parts[0]!.soft).toBeUndefined();
        expect(oak.tints).toHaveLength(2);
        expect(oak.sink).toBe(8);
        expect(oak.farKeep).toBe(0.25);
    });

    it('is refused with where it went wrong', () => {
        const bad = (patch: (r: any) => void) => { const r = withPlants(); patch(r); return () => parseWorldRules(r, 'wilds.esworld'); };
        expect(bad((r) => { r.recipes[0].anchor.plant = 'elm'; })).toThrow(/no plant "elm"/);
        expect(bad((r) => { r.plants.oak.parts = []; })).toThrow(/plants\.oak\.parts/);
        expect(bad((r) => { r.plants.oak.parts[0].mesh = ''; })).toThrow(/plants\.oak\.parts\[0\]\.mesh/);
        expect(bad((r) => { r.plants.oak.tints = [[1, 1]]; })).toThrow(/plants\.oak\.tints\[0\]/);
        expect(bad((r) => { r.plants.oak.farKeep = 0; })).toThrow(/plants\.oak\.farKeep/);
        expect(bad((r) => { delete r.recipes[0].anchor.plant; })).toThrow(/mesh path, or a plant/);
    });
});

