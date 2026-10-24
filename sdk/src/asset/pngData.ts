// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pngData.ts
 * @brief   A PNG read as data: its bytes exactly as stored, for an image that is numbers (a heightmap, a splatmap).
 *
 * The image path decodes through a 2D canvas, which keeps colour premultiplied by alpha: a texel whose alpha is 0 comes back
 * with red, green and blue at 0 too. For a picture that is right; for a splatmap whose alpha is the fourth layer's weight it
 * erased the other three wherever that layer was absent. This inflates the stream itself (DecompressionStream) and undoes the
 * row filters, so every channel is the byte the file holds.
 */
import type { DecodedPixels } from './imageDecode';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Whether `bytes` is a PNG this reader takes: 8 bits a channel, grey, grey+alpha, RGB or RGBA, not interlaced. */
function header(bytes: Uint8Array): { width: number; height: number; channels: number } | null {
    if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    const depth = bytes[24], type = bytes[25], interlace = bytes[28];
    const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type!];
    if (depth !== 8 || !channels || interlace !== 0 || !width || !height) return null;
    return { width, height, channels };
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * The RGBA bytes of a PNG, top row first, as stored; null when it is not a PNG this reads or the host has no
 * DecompressionStream, and the caller decodes it as an image instead.
 */
export async function decodePngData(bytes: Uint8Array): Promise<DecodedPixels | null> {
    const head = header(bytes);
    if (!head || typeof DecompressionStream !== 'function') return null;
    const { width, height, channels } = head;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts: Uint8Array[] = [];
    for (let at = 8; at + 8 <= bytes.length;) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
        if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
        if (type === 'IEND') break;
        at += 12 + length;
    }
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (joined.set(p, at), at + p.length), 0);
    const raw = await inflate(joined);
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) return null;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]!;
        const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? rows[dst + x - channels]! : 0;
            const b = y > 0 ? rows[up + x]! : 0;
            const c = x >= channels && y > 0 ? rows[up + x - channels]! : 0;
            const v = raw[src + x]!;
            rows[dst + x] = (filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1)
                : filter === 4 ? v + paeth(a, b, c) : v) & 255;
        }
    }
    if (channels === 4) return { width, height, pixels: rows };
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const s = i * channels, d = i * 4;
        const grey = channels <= 2;
        pixels[d] = rows[s]!;
        pixels[d + 1] = grey ? rows[s]! : rows[s + 1]!;
        pixels[d + 2] = grey ? rows[s]! : rows[s + 2]!;
        pixels[d + 3] = channels === 2 ? rows[s + 1]! : channels === 4 ? rows[s + 3]! : 255;
    }
    return { width, height, pixels };
}
