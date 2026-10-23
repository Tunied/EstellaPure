// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { basicEffects } from '../src/postprocess/sources/basic';
import { getEffectDef } from '../src/postprocess/effects';

describe('the AgX table an effect brings itself', () => {
    const strip = basicEffects.agxLut();
    const at = (r: number, g: number, b: number): number[] => {
        const i = (g * strip.width + b * 32 + r) * 4;
        return [strip.pixels[i]!, strip.pixels[i + 1]!, strip.pixels[i + 2]!, strip.pixels[i + 3]!];
    };

    it('is 32 slices of 32 by 32 laid side by side, opaque', () => {
        expect([strip.width, strip.height, strip.pixels.length]).toEqual([1024, 32, 1024 * 32 * 4]);
        for (let i = 3; i < strip.pixels.length; i += 4) expect(strip.pixels[i]).toBe(255);
    });

    it('maps a grey to a grey that rises with it, from black to near white', () => {
        let last = -1;
        for (let i = 0; i < 32; i++) {
            const [r, g, b] = at(i, i, i);
            expect(Math.abs(r! - g!)).toBeLessThanOrEqual(3);
            expect(Math.abs(g! - b!)).toBeLessThanOrEqual(3);
            expect(g!).toBeGreaterThanOrEqual(last);
            last = g!;
        }
        expect(at(0, 0, 0)[1]).toBeLessThan(8);
        expect(at(31, 31, 31)[1]).toBeGreaterThan(245);
    });

    it('is declared by the agx effect as its own, with the look as a contrast', () => {
        const def = getEffectDef('agx')!;
        expect(def.category).toBe('color');
        expect(Object.keys(def.builtinTextures ?? {})).toEqual(['u_lut']);
        expect(def.uniforms.map((u) => u.name)).toEqual(['u_contrast']);
        expect(def.uniforms[0]!.defaultValue).toBe(1);
    });
});
