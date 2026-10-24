// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePngData } from '../src/asset/pngData';

/** A PNG of `rows` (bytes per row, unfiltered), each row written with `filter` applied, of colour `type` (0 grey, 2 RGB, 6 RGBA). */
function png(width: number, height: number, type: number, rows: number[][], filter = 0): Uint8Array {
    const channels = { 0: 1, 2: 3, 6: 4 }[type as 0 | 2 | 6];
    const raw: number[] = [];
    rows.forEach((row, y) => {
        raw.push(filter);
        row.forEach((v, x) => {
            const a = x >= channels ? row[x - channels]! : 0;
            const b = y > 0 ? rows[y - 1]![x]! : 0;
            const c = x >= channels && y > 0 ? rows[y - 1]![x - channels]! : 0;
            const p = a + b - c;
            const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
                : filter === 4 ? (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c) : 0;
            raw.push((v - pred) & 255);
        });
    });
    const chunk = (name: string, data: Uint8Array): number[] => {
        const len = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
        return [...len, ...Array.from(name, (ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = type;
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', deflateSync(Buffer.from(raw))), ...chunk('IEND', new Uint8Array())]);
}

describe('a PNG read as data', () => {
    it('keeps red, green and blue where alpha is zero, which a canvas premultiplies away', async () => {
        // A splatmap texel with no rock (alpha 0) and all grass: the grass weight must survive.
        const out = await decodePngData(png(2, 1, 6, [[255, 0, 0, 0, 10, 200, 30, 0]]));
        expect(Array.from(out!.pixels)).toEqual([255, 0, 0, 0, 10, 200, 30, 0]);
    });

    it('undoes every row filter', async () => {
        const rows = [[10, 20, 30, 40, 50, 60, 70, 80], [90, 100, 110, 120, 130, 140, 150, 160], [5, 250, 7, 9, 200, 3, 128, 64]];
        for (const filter of [0, 1, 2, 3, 4]) {
            const out = await decodePngData(png(2, 3, 6, rows, filter));
            expect(Array.from(out!.pixels), `filter ${filter}`).toEqual(rows.flat());
        }
    });

    it('widens grey and RGB to RGBA with an opaque alpha', async () => {
        expect(Array.from((await decodePngData(png(2, 1, 0, [[7, 200]])))!.pixels)).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
        expect(Array.from((await decodePngData(png(1, 1, 2, [[1, 2, 3]])))!.pixels)).toEqual([1, 2, 3, 255]);
    });

    it('declines what it does not read, so the image path decodes it', async () => {
        expect(await decodePngData(new Uint8Array([1, 2, 3]))).toBeNull();
    });

    it('reads a 16-bit grey PNG at its full depth, keeping each high byte in the RGBA bytes', async () => {
        const values = [0, 0x1234, 0xffff, 0x8001];
        const raw: number[] = [];
        for (let y = 0; y < 2; y++) { raw.push(0); for (let x = 0; x < 2; x++) { const v = values[y * 2 + x]!; raw.push(v >> 8, v & 255); } }
        const chunk = (name: string, data: Uint8Array): number[] => {
            const len = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
            return [...len, ...Array.from(name, (ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
        };
        const ihdr = new Uint8Array(13);
        new DataView(ihdr.buffer).setUint32(0, 2);
        new DataView(ihdr.buffer).setUint32(4, 2);
        ihdr[8] = 16; ihdr[9] = 0;
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', deflateSync(Buffer.from(raw))), ...chunk('IEND', new Uint8Array())]);
        const out = await decodePngData(bytes);
        expect(Array.from(out!.wide!)).toEqual(values);
        expect(out!.pixels[4]).toBe(0x12);
        expect(out!.pixels[7]).toBe(255);
    });
});
