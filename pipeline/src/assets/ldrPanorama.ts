// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An 8-bit picture as a panorama in linear light.
 *
 * Six faces and a single lat-long picture are both low-dynamic-range sources, and both
 * need the same two things: the sRGB curve undone, and the plain fact that nothing in them
 * is brighter than white. One conversion serves both, so a face set and a panorama of the
 * same sky read as the same light.
 */
import type { Panorama } from './environmentImport';

/** How the 8-bit values are encoded. PNG and JPEG are sRGB unless said otherwise. */
export type LdrColorSpace = 'srgb' | 'linear';

/** sRGB byte → linear light. */
export const SRGB_TO_LINEAR = (() => {
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return lut;
})();

/** A decoded 8-bit picture, row 0 = top. */
export interface LdrImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

/** The widest picture read: a float RGB copy is 12 bytes a texel. */
export const LDR_MAX_TEXELS = 8192 * 4096;

/** What an import of a low-dynamic-range source has to tell its author. */
export const LDR_NOTE = 'an 8-bit picture holds no light brighter than white, so this environment has no sun brighter'
    + ' than its sky; import a Radiance .hdr or an OpenEXR to light a scene from a real one';

/** A lat-long picture in linear light, row 0 = up (+Y). */
export function ldrToPanorama(image: LdrImage, colorSpace: LdrColorSpace = 'srgb'): Panorama {
    const { width, height } = image;
    if (!(width > 0) || !(height > 0) || image.rgba.length !== width * height * 4) {
        throw new Error(`a ${width}x${height} picture needs ${width * height * 4} bytes, not ${image.rgba.length}`);
    }
    if (width * height > LDR_MAX_TEXELS) {
        throw new Error(`the picture is ${width}x${height}; at most ${LDR_MAX_TEXELS} texels are read`);
    }
    const rgb = new Float32Array(width * height * 3);
    for (let i = 0, o = 0; i < width * height; i++, o += 3) {
        for (let c = 0; c < 3; c++) {
            const v = image.rgba[i * 4 + c]!;
            rgb[o + c] = colorSpace === 'srgb' ? SRGB_TO_LINEAR[v]! : v / 255;
        }
    }
    return { width, height, rgb };
}
