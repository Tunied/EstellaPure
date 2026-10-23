// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { BlendMode } from 'esengine';
import { characterShading, materialProducts, type ImportedImageRef, type ImportedMaterial, type ImportedMesh } from '../src/assets/modelImport';

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
