// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * An 8-bit picture as light: the sRGB curve undone or not as the author says, nothing
 * brighter than white, and a picture whose bytes are not its size refused.
 */
import { describe, it, expect } from 'vitest';
import { ldrToPanorama, SRGB_TO_LINEAR, LDR_NOTE } from '../src/assets/ldrPanorama';

const solid = (v: number, width = 4, height = 2) => ({
    width, height, rgba: new Uint8Array(width * height * 4).fill(v),
});

describe('an 8-bit panorama', () => {
    it('is linearized by the sRGB curve, so a mid grey is far darker than half', () => {
        const p = ldrToPanorama(solid(128), 'srgb');
        expect(p.rgb[0]).toBeCloseTo(0.2158, 3);
        expect(SRGB_TO_LINEAR[255]).toBe(1);
        expect(SRGB_TO_LINEAR[0]).toBe(0);
    });

    it('is taken as it is when the author says it is already linear', () => {
        expect(ldrToPanorama(solid(128), 'linear').rgb[0]).toBeCloseTo(128 / 255, 6);
    });

    it('holds nothing brighter than white', () => {
        const p = ldrToPanorama(solid(255));
        expect(Math.max(...p.rgb)).toBe(1);
        expect(LDR_NOTE).toMatch(/no light brighter than white/);
    });

    it('keeps the picture\'s size and row order', () => {
        const image = solid(0, 4, 2);
        image.rgba.set([255, 255, 255, 255], 0);          // top-left texel only
        const p = ldrToPanorama(image);
        expect([p.width, p.height]).toEqual([4, 2]);
        expect(p.rgb[0]).toBe(1);
        expect(p.rgb[4 * 3]).toBe(0);                     // first texel of the second row
    });

    it('refuses bytes that are not the picture\'s size', () => {
        expect(() => ldrToPanorama({ width: 4, height: 2, rgba: new Uint8Array(5) })).toThrow(/needs 32 bytes/);
    });
});
