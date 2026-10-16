// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * OpenEXR panoramas, read against files an independent writer produced.
 *
 * The fixtures were written by Blender 5.2 (see tests/fixtures/exr/README.md): a 16x8 image
 * whose every texel differs, one of them far past 1, stored in each compression at half and
 * float precision. A decoder that agreed only with a writer of its own would agree with its
 * own misreading of the format; these files cannot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeExr, ExrError, EXR_SUPPORTED_COMPRESSIONS } from '../src/assets/exrDecode';

const DIR = path.join(__dirname, 'fixtures/exr');
const load = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(DIR, name)));

const W = 16, H = 8;
/** The value the generator wrote at (x, y), counted from the top of the picture. */
function expected(x: number, y: number): [number, number, number] {
    return [x + 0.25, y + 0.5, (x * 3 + y) / 4 + (x === 5 && y === 2 ? 100 : 0)];
}

function expectMatches(name: string, relative: number): void {
    const { panorama, warnings } = decodeExr(load(name));
    expect(warnings).toEqual([]);
    expect(panorama.width).toBe(W);
    expect(panorama.height).toBe(H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const want = expected(x, y);
            for (let k = 0; k < 3; k++) {
                const got = panorama.rgb[(y * W + x) * 3 + k]!;
                // Half floats carry ten bits of mantissa, so a value near 100 is good to ~0.06.
                expect(Math.abs(got - want[k]!), `${name} (${x},${y}) channel ${k}: ${got} vs ${want[k]}`)
                    .toBeLessThanOrEqual(Math.max(1e-3, Math.abs(want[k]!) * relative));
            }
        }
    }
}

describe('the compressions this reads', () => {
    for (const codec of ['none', 'rle', 'zips', 'zip', 'pxr24']) {
        it(`${codec}, half precision: every texel where the writer put it, top row first`, () => {
            expectMatches(`ref_${codec}_16.exr`, 2 ** -10);
        });
        it(`${codec}, float precision`, () => {
            // PXR24 cuts a float to 24 bits; the others keep all 32.
            expectMatches(`ref_${codec}_32.exr`, codec === 'pxr24' ? 2 ** -14 : 1e-6);
        });
    }

    it('lists what it supports', () => {
        expect([...EXR_SUPPORTED_COMPRESSIONS]).toEqual(['NONE', 'RLE', 'ZIPS', 'ZIP', 'PXR24']);
    });
});

describe('what it refuses, by name', () => {
    const refused = (bytes: Uint8Array): string => {
        try { decodeExr(bytes); } catch (e) { expect(e).toBeInstanceOf(ExrError); return (e as Error).message; }
        throw new Error('expected the file to be refused');
    };

    it('names a compression it does not read and says what to save as', () => {
        const message = refused(load('ref_dwaa_16.exr'));
        expect(message).toMatch(/unsupported compression DWAA/);
        expect(message).toMatch(/NONE, RLE, ZIPS, ZIP, PXR24/);
    });

    it('is not an OpenEXR when the magic number is not there', () => {
        expect(refused(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toMatch(/no magic number/);
    });

    it('refuses a tiled, a deep and a multi-part file for what they are', () => {
        for (const [flag, word] of [[0x200, /tiled/], [0x800, /deep/], [0x1000, /multi-part/]] as const) {
            const bytes = load('ref_zip_16.exr').slice();
            const view = new DataView(bytes.buffer);
            view.setUint32(4, 2 | flag, true);
            expect(refused(bytes)).toMatch(word);
        }
    });

    it('refuses a file cut short rather than reading past it', () => {
        const bytes = load('ref_zip_16.exr');
        expect(() => decodeExr(bytes.subarray(0, bytes.length - 40))).toThrow(ExrError);
        expect(() => decodeExr(bytes.subarray(0, 60))).toThrow(ExrError);
    });
});

describe('an image taller than one block', () => {
    // 64x40: ZIP and PXR24 hold 16 lines a block, so three blocks and the last is short.
    const check = (name: string, relative: number): void => {
        const { panorama } = decodeExr(load(name));
        expect([panorama.width, panorama.height]).toEqual([64, 40]);
        for (let y = 0; y < 40; y++) {
            for (let x = 0; x < 64; x++) {
                const want = [x / 2, y / 4, ((x * 7 + y * 13) % 17) / 4];
                for (let k = 0; k < 3; k++) {
                    const got = panorama.rgb[(y * 64 + x) * 3 + k]!;
                    expect(Math.abs(got - want[k]!), `${name} (${x},${y}) channel ${k}`)
                        .toBeLessThanOrEqual(Math.max(1e-3, Math.abs(want[k]!) * relative));
                }
            }
        }
    };

    it('reads every block of a ZIP file', () => check('big_zip_32.exr', 1e-6));
    it('reads every block of a PXR24 file', () => check('big_pxr24_32.exr', 2 ** -14));
    it('reads a ZIPS file, one line a block', () => check('big_zips_16.exr', 2 ** -10));
    it('reads an RLE file, one line a block', () => check('big_rle_32.exr', 1e-6));
});
