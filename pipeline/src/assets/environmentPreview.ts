// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an environment looks like, without a scene: its sky as a picture, and the
 *        two spheres every lighting artist reaches for — a diffuse grey one, which
 *        shows the irradiance, and a mirror, which shows the reflection.
 *
 * Read from the products the import wrote (the nine coefficients in the `.esenv` and the
 * RGBM sky image beside it), turned about +Y the way the frame and the bake turn them:
 * `skyRadiance` in the SDK is the authority for that rotation, and the sphere here uses
 * the same one. So the preview answers "which way does this sky face under this
 * rotation" with the engine's own convention, not a second guess at it.
 *
 * A picture to judge by, not a render: linear light is clamped and gamma-encoded, with no
 * tone curve of the project's, so a bright sun reads as white rather than as its true value.
 */
import { evalIrradianceSH, panoramaDirection, panoramaUV } from 'esengine';
import { decodeRgbm } from './environmentImport';

/** An 8-bit RGBM image, row 0 = top: what the import writes for the sky. */
export interface RgbmImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export interface EnvironmentPreviewInput {
    /** The nine RGB coefficients, as the `.esenv` stores them. */
    irradiance: readonly number[];
    /** The sky image; null when the import wrote none, and the mirror then shows the
     *  irradiance — the only sky there is. */
    sky: RgbmImage | null;
    /** The RGBM decode range the document names. */
    maxRange: number;
    /** `environmentRotation`, in degrees. */
    rotationDeg: number;
    /** Scales what is shown; a Light's intensity is 1 for a neutral preview. */
    exposure?: number;
}

export interface PreviewImage {
    width: number;
    height: number;
    /** RGBA8, row 0 = top. Transparent outside a sphere. */
    rgba: Uint8Array;
}

const encode = (linear: number): number =>
    Math.round(Math.min(1, Math.max(0, Math.pow(Math.max(0, linear), 1 / 2.2))) * 255);

/** The sky as the frame turns it: a world direction, in the environment's own frame. */
function inEnvironment(rotationDeg: number, dx: number, dy: number, dz: number): [number, number, number] {
    const yaw = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * dx + s * dz, dy, -s * dx + c * dz];
}

/** Bilinear read of the RGBM sky along an environment-frame direction, in linear light. */
function skyAt(sky: RgbmImage, maxRange: number, x: number, y: number, z: number, out: Float32Array): void {
    const [u, v] = panoramaUV(x, y, z);
    const fx = u * sky.width - 0.5, fy = v * sky.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const wrap = (i: number): number => ((i % sky.width) + sky.width) % sky.width;
    const clamp = (j: number): number => Math.max(0, Math.min(sky.height - 1, j));
    const texel = (i: number, j: number): [number, number, number] => {
        const o = (clamp(j) * sky.width + wrap(i)) * 4;
        return decodeRgbm(sky.rgba[o]!, sky.rgba[o + 1]!, sky.rgba[o + 2]!, sky.rgba[o + 3]!, maxRange);
    };
    const a = texel(x0, y0), b = texel(x0 + 1, y0), c = texel(x0, y0 + 1), d = texel(x0 + 1, y0 + 1);
    for (let k = 0; k < 3; k++) {
        out[k] = (a[k]! * (1 - tx) + b[k]! * tx) * (1 - ty) + (c[k]! * (1 - tx) + d[k]! * tx) * ty;
    }
}

/** The sky as a flat picture of the WORLD: each texel is the direction `panoramaDirection`
 *  gives it, read through the rotation, so the centre is what faces +Z — as on the spheres. */
export function previewPanorama(input: EnvironmentPreviewInput, width: number): PreviewImage {
    const height = Math.max(1, Math.round(width / 2));
    const rgba = new Uint8Array(width * height * 4);
    const exposure = input.exposure ?? 1;
    const lin = new Float32Array(3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [dx, dy, dz] = panoramaDirection((x + 0.5) / width, (y + 0.5) / height);
            sampleInto(input, dx, dy, dz, lin);
            const o = (y * width + x) * 4;
            rgba[o] = encode(lin[0]! * exposure); rgba[o + 1] = encode(lin[1]! * exposure);
            rgba[o + 2] = encode(lin[2]! * exposure); rgba[o + 3] = 255;
        }
    }
    return { width, height, rgba };
}

/** What the environment gives along a WORLD direction: the sky, or its irradiance when there is no image. */
function sampleInto(input: EnvironmentPreviewInput, dx: number, dy: number, dz: number, out: Float32Array): void {
    const [x, y, z] = inEnvironment(input.rotationDeg, dx, dy, dz);
    if (input.sky) { skyAt(input.sky, input.maxRange, x, y, z, out); return; }
    const [r, g, b] = evalIrradianceSH(input.irradiance, x, y, z);
    out[0] = Math.max(0, r); out[1] = Math.max(0, g); out[2] = Math.max(0, b);
}

/**
 * A sphere seen from +Z, lit by the environment.
 *
 * `diffuse` is a mid-grey matte ball: the irradiance the surface receives along its
 * normal. `mirror` is a perfect reflector: the sky along the reflected view direction, so
 * the centre of the ball shows what faces the viewer — +Z.
 */
export function previewBall(input: EnvironmentPreviewInput, mode: 'diffuse' | 'mirror', size: number): PreviewImage {
    const rgba = new Uint8Array(size * size * 4);
    const exposure = input.exposure ?? 1;
    const lin = new Float32Array(3);
    const albedo = 0.5;
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const x = ((px + 0.5) / size) * 2 - 1;
            const y = 1 - ((py + 0.5) / size) * 2;
            const r2 = x * x + y * y;
            if (r2 > 1) continue;
            const nz = Math.sqrt(1 - r2);
            const o = (py * size + px) * 4;
            if (mode === 'diffuse') {
                const [r, g, b] = evalIrradianceSH(input.irradiance, ...inEnvironment(input.rotationDeg, x, y, nz));
                lin[0] = Math.max(0, r) * albedo; lin[1] = Math.max(0, g) * albedo; lin[2] = Math.max(0, b) * albedo;
            } else {
                // The viewer looks along -Z, so the reflection of the view vector v off normal n is
                // v - 2(v.n)n, whose z component is 2 nz^2 - 1.
                sampleInto(input, 2 * nz * x, 2 * nz * y, 2 * nz * nz - 1, lin);
            }
            rgba[o] = encode(lin[0]! * exposure); rgba[o + 1] = encode(lin[1]! * exposure);
            rgba[o + 2] = encode(lin[2]! * exposure); rgba[o + 3] = 255;
        }
    }
    return { width: size, height: size, rgba };
}
