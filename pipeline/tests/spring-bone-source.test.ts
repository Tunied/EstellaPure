// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spring-bone-source — spring bones a glTF states outright: the VRM 1.0 extension and a node's own extras, and how they meet the name rule.
 */
import { describe, it, expect } from 'vitest';
import { readSpringBones, rotationFromY } from '../src/assets/springBoneSource';
import { assembleModelPrefab, type ImportedNode } from '../src/assets/modelImport';

const nodes = [
    { name: 'Head', children: [1, 4] },
    { name: 'Hair_A', children: [2] },
    { name: 'Hair_A1', children: [3] },
    { name: 'Hair_A2' },
    { name: 'Hair_B', children: [5] },
    { name: 'Hair_B1' },
    { name: 'Neck' },
];

const vrm = {
    colliders: [
        { node: 0, shape: { sphere: { offset: [0, 0.1, 0], radius: 0.08 } } },
        { node: 6, shape: { capsule: { offset: [0, 0, 0], radius: 0.04, tail: [0, 0.1, 0] } } },
    ],
    colliderGroups: [{ colliders: [0, 1] }],
    springs: [
        { name: 'hairA', joints: [{ node: 1, stiffness: 0.6, dragForce: 0.4, gravityPower: 0.1, hitRadius: 0.01 }, { node: 2 }, { node: 3 }], colliderGroups: [0] },
        { name: 'hairB', joints: [{ node: 4 }, { node: 5 }] },
    ],
};

describe('rotationFromY', () => {
    it('turns +Y onto the direction it is given, and handles straight up and straight down', () => {
        const turn = (q: number[], v: number[]): number[] => {
            const [x, y, z, w] = q as [number, number, number, number];
            const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
            return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
        };
        for (const d of [[1, 0, 0], [0, 0, 1], [1, 1, 0], [0, 1, 0], [0, -1, 0]]) {
            const len = Math.hypot(d[0]!, d[1]!, d[2]!);
            const out = turn(rotationFromY(d as [number, number, number]), [0, 1, 0]);
            expect(out[0]).toBeCloseTo(d[0]! / len);
            expect(out[1]).toBeCloseTo(d[1]! / len);
            expect(out[2]).toBeCloseTo(d[2]! / len);
        }
    });
});

describe('VRMC_springBone', () => {
    it('puts a SpringBone on the first joint, in the units the engine uses', () => {
        const out = readSpringBones({ nodes, extensions: { VRMC_springBone: vrm } }, []);
        const a = out.get(1)!.springBone!;
        // Per second becomes per 60 Hz frame, and gravity power times 60 is the acceleration the solver adds each step.
        expect(a.stiffness).toBeCloseTo((0.6 + 1 + 1) / 3 / 60);
        expect(a.drag).toBeCloseTo((0.4 + 0.5 + 0.5) / 3);
        expect(a.gravity![1]).toBeCloseTo(-(0.1 * 60) / 3);
        expect(a.radius).toBeCloseTo(0.01 / 3);
        expect(out.get(4)!.springBone).toBeDefined();
    });

    it('turns colliders into entities hosted on their node, a capsule centred and turned along its tail', () => {
        const out = readSpringBones({ nodes, extensions: { VRMC_springBone: vrm } }, []);
        expect(out.get(0)!.springColliders).toEqual([{ shape: 0, radius: 0.08, offset: [0, 0.1, 0] }]);
        const neck = out.get(6)!.springColliders![0]!;
        expect(neck.shape).toBe(1);
        expect(neck.height).toBeCloseTo(0.1);
        expect(neck.offset).toEqual([0, 0.05, 0]);
        expect(neck.rotation![3]).toBeCloseTo(1);
        // A spring names its groups; a spring that names none gets none.
        expect(out.get(1)!.springBone!.colliders).toEqual(['n0_sbc0', 'n6_sbc0']);
        expect(out.get(4)!.springBone!.colliders).toEqual([]);
    });

    it('says so when a spring is not usable, or moves bones it does not name', () => {
        const warnings: string[] = [];
        readSpringBones({ nodes, extensions: { VRMC_springBone: { springs: [{ name: 'short', joints: [{ node: 1 }] }, { name: 'partial', joints: [{ node: 1 }, { node: 2 }] }] } } }, warnings);
        expect(warnings.some(w => /short.*fewer than two joints/.test(w))).toBe(true);
        expect(warnings.some(w => /partial.*1 bone/.test(w))).toBe(true);
    });
});

describe('extras.estella', () => {
    const withExtras = nodes.map((n, i) => i === 1
        ? { ...n, extras: { estella: { springBone: { stiffness: 0.3, gravity: [0, -5, 0], endLength: 0.02 } } } }
        : i === 6 ? { ...n, extras: { estella: { springCollider: { shape: 'capsule', radius: 0.04, height: 0.09, offset: [0, 0.02, 0] } } } } : n);

    it('reads a chain and a collider from a node\'s own properties, with exact sizes', () => {
        const out = readSpringBones({ nodes: withExtras }, []);
        expect(out.get(1)!.springBone).toEqual({ stiffness: 0.3, gravity: [0, -5, 0], endLength: 0.02 });
        expect(out.get(6)!.springColliders).toEqual([{ shape: 1, radius: 0.04, height: 0.09, offset: [0, 0.02, 0] }]);
    });

    it('wins over the VRM data for the node it is on', () => {
        const out = readSpringBones({ nodes: withExtras, extensions: { VRMC_springBone: vrm } }, []);
        expect(out.get(1)!.springBone!.stiffness).toBe(0.3);
    });
});

describe('assembly of stated data', () => {
    let next = 0;
    const node = (name: string, extra: Partial<ImportedNode> = {}, children: ImportedNode[] = []): ImportedNode =>
        ({ index: next++, name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], meshes: [], children, ...extra });

    it('makes the components, scales the lengths, and gives a chain with no list every collider in the model', () => {
        next = 0;
        const tree = [node('Head', { springColliders: [{ shape: 0, radius: 0.08 }] }, [
            node('Strand', { springBone: { stiffness: 0.2, gravity: [0, -10, 0], endLength: 0.02 } }, [node('Tip')]),
            node('Hair_Ponytail_00_00', {}, [node('Hair_Ponytail_00_01')]),
        ])];
        const prefab = assembleModelPrefab('rig', [], { nodes: tree, refs: { springBones: true }, scale: 100 });
        const by = (name: string) => prefab.entities.find(e => e.name === name)!;
        const strand = by('Strand').components.find(c => c.type === 'SpringBone')!.data;
        expect(strand.stiffness).toBe(0.2);
        expect((strand.gravity as { y: number }).y).toBeCloseTo(-1000);
        expect(strand.endLength).toBeCloseTo(2);
        const hosted = `${by('Head').prefabEntityId}_sbc0`;
        expect(strand.colliders).toEqual([hosted]);
        // The collider is an entity below its host, and a chain found by name is wired to it as well.
        const collider = by('Head_collider0');
        expect(collider.parent).toBe(by('Head').prefabEntityId);
        expect(by('Hair_Ponytail_00_00').components.find(c => c.type === 'SpringBone')!.data.colliders).toEqual([hosted]);
    });

    it('leaves a model alone when the setting is off', () => {
        next = 0;
        const tree = [node('Head', { springColliders: [{ shape: 0, radius: 0.08 }] }, [node('Strand', { springBone: {} }, [node('Tip')])])];
        const prefab = assembleModelPrefab('rig', [], { nodes: tree, refs: {} });
        expect(prefab.entities.some(e => e.components.some(c => c.type === 'SpringBone' || c.type === 'SpringBoneCollider'))).toBe(false);
    });
});
