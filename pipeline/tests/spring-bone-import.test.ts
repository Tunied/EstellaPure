// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spring-bone-import — hair chains and colliders found by the names a model already carries.
 *
 * A bone `Hair_<region>_<chain>_00` becomes a SpringBone, an empty `SBC_Sphere_...` / `SBC_Capsule_...` a SpringBoneCollider, and every chain
 * is wired to every collider the model has. Off, nothing is touched.
 */
import { describe, it, expect } from 'vitest';
import { assembleModelPrefab, type ImportedNode } from '../src/assets/modelImport';

let next = 0;
function node(name: string, children: ImportedNode[] = []): ImportedNode {
    return { index: next++, name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], meshes: [], children };
}

/** A strand: Hair_<region>_<chain>_00 down through `joints` bones. */
function strand(region: string, chain: string, joints: number): ImportedNode {
    let below: ImportedNode[] = [];
    for (let j = joints - 1; j >= 0; j--) below = [node(`Hair_${region}_${chain}_${String(j).padStart(2, '0')}`, below)];
    return below[0]!;
}

function character(): ImportedNode[] {
    next = 0;
    return [node('Hips', [node('Spine', [node('Neck', [
        node('Head', [node('Hair_Root', [strand('Ponytail', '00', 5), strand('Temple_L', '01', 3), strand('Fringe', '02', 1)]),
                      node('SBC_Sphere_Head_r9')]),
        node('SBC_Capsule_Neck_r5_h10'),
        node('SBC_Capsule_Broken_r5'),
    ])])])];
}

const springs = (nodes: ImportedNode[], on: boolean, scale?: number) => {
    const prefab = assembleModelPrefab('girl', [], { nodes, refs: { springBones: on }, ...(scale ? { scale } : {}) });
    const of = (type: string) => prefab.entities.filter(e => e.components.some(c => c.type === type));
    return { prefab, chains: of('SpringBone'), colliders: of('SpringBoneCollider') };
};

describe('spring bones from names', () => {
    it('does nothing when the setting is off', () => {
        const { chains, colliders } = springs(character(), false);
        expect(chains).toHaveLength(0);
        expect(colliders).toHaveLength(0);
    });

    it('makes a SpringBone at the root of each chain that has bones below it, and nowhere else', () => {
        const { chains } = springs(character(), true);
        expect(chains.map(e => e.name)).toEqual(['Hair_Ponytail_00_00', 'Hair_Temple_L_01_00']);
    });

    it('reads a collider name into a shape and a size in metres, and skips a capsule with no length', () => {
        const { colliders } = springs(character(), true);
        expect(colliders.map(e => e.name)).toEqual(['SBC_Sphere_Head_r9', 'SBC_Capsule_Neck_r5_h10']);
        const [head, neck] = colliders.map(e => e.components.find(c => c.type === 'SpringBoneCollider')!.data);
        expect(head).toEqual({ shape: 0, radius: 0.09 });
        expect(neck).toEqual({ shape: 1, radius: 0.05, height: 0.1 });
    });

    it('keeps every chain out of every collider, by the prefab ids the instance remaps', () => {
        const { chains, colliders } = springs(character(), true);
        const ids = colliders.map(e => e.prefabEntityId);
        for (const chain of chains) {
            const data = chain.components.find(c => c.type === 'SpringBone')!.data;
            expect(data.colliders).toEqual(ids);
            expect(ids.every(id => typeof id === 'string')).toBe(true);
        }
    });

    it('hangs a ponytail looser than a fringe would, and takes the model\'s metres into the import scale', () => {
        const { chains } = springs(character(), true, 100);
        const data = chains[0]!.components.find(c => c.type === 'SpringBone')!.data;
        expect(data.stiffness).toBeLessThan(0.1);
        expect((data.gravity as { y: number }).y).toBeCloseTo(-980);
        expect(data.endLength).toBeCloseTo(4);
    });

    it('does not take the Hair_Root bone or a non-root joint for a chain', () => {
        next = 0;
        const odd = [node('Head', [node('Hair_Root', [node('Hair_Ponytail_00_01', [node('Hair_Ponytail_00_02')])])])];
        expect(springs(odd, true).chains).toHaveLength(0);
    });
});
