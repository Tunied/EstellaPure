// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { BlendMode } from 'esengine';
import { MeshChannel, MeshChannelType } from 'esengine';
import { characterShading, materialProducts, orderHairTriangles, type ImportedImageRef, type ImportedMaterial, type ImportedMesh } from '../src/assets/modelImport';

const image = (file: string, data = false): ImportedImageRef => ({ file, external: true, ...(data ? { settings: { sRGB: false } } : {}) } as ImportedImageRef);

function material(index: number, name: string, extra: Partial<ImportedMaterial> = {}): ImportedMaterial {
    return { index, name, baseColor: [1, 1, 1, 1], opaque: true, cullBackfaces: true, ...extra };
}
const meshOf = (m: ImportedMaterial): ImportedMesh => ({ material: m } as ImportedMesh);

describe('characterShading', () => {
    it('reads skin, hair and eyes from the words of a name, and nothing from a word that merely contains one', () => {
        expect(characterShading(material(0, 'M_BodySkin'))).toBe('skin');
        expect(characterShading(material(0, 'Face_005'))).toBe('skin');
        expect(characterShading(material(0, 'C004_Hair_A'))).toBe('hair');
        expect(characterShading(material(0, 'EyeLeft'))).toBe('eye');
        expect(characterShading(material(0, 'Eyes'))).toBe('eye');
        expect(characterShading(material(0, 'Eyelashes'))).toBeUndefined();
        expect(characterShading(material(0, 'Headband'))).toBeUndefined();
        expect(characterShading(material(0, 'Body1'))).toBeUndefined();
    });

    it('also reads the colour texture\'s file name', () => {
        expect(characterShading(material(0, 'Material.003', { baseColorTexture: image('assets/T_Hair_D.png') }))).toBe('hair');
    });
});

describe('materialProducts with character materials', () => {
    const skin = material(0, 'Face', { normalTexture: image('n.png', true), metallicRoughnessTexture: image('orm.png', true), metallic: 0, roughness: 0 });
    const hair = material(1, 'Hair', { normalTexture: image('hn.png', true), metallicRoughnessTexture: image('horm.png', true), opaque: false });
    const eye = material(2, 'Eye', { roughness: 0.2 });
    const cloth = material(3, 'Jacket', { normalTexture: image('jn.png', true) });
    const meshes = [skin, hair, eye, cloth].map(meshOf);

    it('keeps every material on the Model shader unless asked', () => {
        const products = materialProducts(meshes, 'nitro');
        expect(products.map((p) => p.data.shader)).toEqual(['builtin:model', 'builtin:model', 'builtin:model', 'builtin:model']);
    });

    it('binds the shaders the names ask for, with their maps and a cutout for hair', () => {
        const products = materialProducts(meshes, 'nitro', { characters: true });
        const by = Object.fromEntries(products.map((p) => [p.name, p.data]));
        expect(by.nitro_m0!.shader).toBe('builtin:skin');
        expect(by.nitro_m0!.properties).toMatchObject({ u_normalMap: expect.any(String), u_ormMap: expect.any(String) });
        expect(by.nitro_m0!.properties).not.toHaveProperty('u_roughness');
        expect(by.nitro_m1!.shader).toBe('builtin:hair');
        expect(by.nitro_m1!.properties).toMatchObject({ u_alphaCutoff: 0.5 });
        expect(by.nitro_m1!.blendMode).toBe(BlendMode.None);
        expect(by.nitro_m2!.shader).toBe('builtin:eye');
        expect(by.nitro_m3!.shader).toBe('builtin:model');
    });
});

describe('hair maps a material states in its extras', () => {
    const hair = material(0, 'hair_cards', {
        normalTexture: image('n.png', true), metallicRoughnessTexture: image('orm.png', true), alphaCutoff: 0.45,
        flowTexture: image('textures/flow.png', true), shiftTexture: image('textures/shift.png', true), tipSoftness: 0.1,
    });

    it('binds the strand-direction and shift maps and the tip softness of a hair material', () => {
        const [product] = materialProducts([meshOf(hair)], 'girl', { characters: true });
        expect(product!.data.shader).toBe('builtin:hair');
        expect(product!.data.properties).toMatchObject({
            u_flowMap: expect.stringContaining('flow.png'), u_shiftMap: expect.stringContaining('shift.png'), u_tipSoftness: 0.1, u_alphaCutoff: 0.45,
        });
    });

    it('does not put them on a material that is not hair', () => {
        const skin = material(0, 'skin_face', { normalTexture: image('n.png', true), metallicRoughnessTexture: image('orm.png', true), flowTexture: image('f.png', true), tipSoftness: 0.2 });
        const [product] = materialProducts([meshOf(skin)], 'girl', { characters: true });
        expect(product!.data.properties).not.toHaveProperty('u_flowMap');
        expect(product!.data.properties).not.toHaveProperty('u_tipSoftness');
    });
});

describe('orderHairTriangles', () => {
    // Three triangles at distances 1, 3 and 2 from the middle of the box, written outermost-first.
    function hairMesh(name: string): ImportedMesh {
        const ring = [[3, 0, 0], [1, 0, 0], [2, 0, 0]];
        const positions: number[] = [];
        for (const [x] of ring) positions.push(x!, 0, 0, x! + 0.1, 0.1, 0, x!, 0.1, 0.1);
        const vertices = new Uint8Array(positions.length * 4);
        new Float32Array(vertices.buffer).set(positions);
        return {
            name, vertexCount: 9, triangleCount: 3, material: material(0, name),
            data: {
                channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }],
                vertexStride: 12, vertexCount: 9, vertices, indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
                aabbMin: [-2, 0, 0], aabbMax: [2, 0, 0],
            },
        } as ImportedMesh;
    }

    it('puts the triangles nearest the middle of the hair first', () => {
        const hair = hairMesh('Hair');
        orderHairTriangles([hair]);
        // Distances from x=0: 3.03 (tri 0), 1.03 (tri 1), 2.03 (tri 2) -> 1, 2, 0.
        expect(Array.from(hair.data.indices)).toEqual([3, 4, 5, 6, 7, 8, 0, 1, 2]);
    });

    it('leaves a mesh that is not hair alone', () => {
        const cloth = hairMesh('Jacket');
        orderHairTriangles([cloth]);
        expect(Array.from(cloth.data.indices)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
});
