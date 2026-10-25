// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The plants a world's recipes name, made into the kinds a placed foliage grows: one kind a colouring, and a place has one.
 */
import { describe, expect, it } from 'vitest';
import { expandPlants } from '../src/worldgen/plants';
import type { PlantKind } from '../src/foliage/plantKind';

const part = (mesh: string, tint: [number, number, number, number] = [1, 1, 1, 1]) => ({ mesh, lod1Mesh: '', material: '', texture: '', tint, opaque: true });
const plants: Record<string, PlantKind> = {
    oak: { parts: [part('trunk', [0.5, 0.5, 0.5, 1]), part('crown')], lodDistance: 6000, drawDistance: 16000, far: [part('cards')], farDistance: 200000,
        tints: [[0.9, 1, 0.9], [1, 1, 1], [1.1, 1, 0.8]], tintScale: 1000, sink: 8, unit: 100, farKeep: 0.5 },
    stone: { parts: [part('rock')], lodDistance: 0, drawDistance: 30000, far: [], farDistance: 0 },
};

describe('expanding plants into kinds', () => {
    const set = expandPlants(plants);

    it('makes a kind of each colouring, with the tint multiplied into every part and its far parts', () => {
        expect(set.kinds).toHaveLength(4);
        const first = set.kinds[0]!;
        expect(first.parts[0]!.tint[0]).toBeCloseTo(0.45);
        expect(first.parts[1]!.tint).toEqual([0.9, 1, 0.9, 1]);
        expect(first.far[0]!.tint).toEqual([0.9, 1, 0.9, 1]);
        expect(set.kinds[3]!.parts).toHaveLength(1);
        expect(set.kinds[3]!.far).toHaveLength(0);
    });

    it('gives a place one colouring, the same each time, and a plant without any its one kind', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 400; i++) {
            const k = set.kindAt('oak', i * 311, i * 97);
            expect(k).toBeGreaterThanOrEqual(0);
            expect(k).toBeLessThan(3);
            expect(set.kindAt('oak', i * 311, i * 97)).toBe(k);
            seen.add(k);
        }
        expect(seen.size).toBe(3);
        expect(set.kindAt('stone', 5, 5)).toBe(3);
        expect(set.kindAt('nothing', 5, 5)).toBe(-1);
    });

    it('carries how much of a plant its far version draws', () => {
        expect(set.kinds[0]!.farKeep).toBe(0.5);
        expect(set.kinds[3]!.farKeep).toBeUndefined();
    });

    it('knows how far a plant is sunk and how far the furthest of them is wanted', () => {
        expect(set.sinkOf('oak')).toBe(8);
        expect(set.sinkOf('stone')).toBe(0);
        expect(set.unitOf('oak')).toBe(100);
        expect(set.unitOf('stone')).toBe(1);
        expect(set.reach).toBe(200000);
    });

    it('measures the least distance a far version is shown over, for how wide a far cell may be', () => {
        expect(set.span).toBe(184000);
        const cover = expandPlants({ ...plants, grass: { parts: [part('g')], lodDistance: 3000, drawDistance: 9000, far: [part('g')], farDistance: 26000 } });
        expect(cover.span).toBe(17000);
        expect(expandPlants({ stone: plants.stone! }).span).toBe(0);
    });
});
