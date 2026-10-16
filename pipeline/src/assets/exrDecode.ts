// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OpenEXR → the linear panorama an environment import takes.
 *
 * Only what a lat-long sky is: ONE scanline image with red, green and blue (or a single
 * luminance) channel, half or float. Everything else is refused by name, so a file that
 * cannot be read says why instead of importing as something nearby:
 *
 *   supported   compression  NONE, RLE, ZIPS, ZIP, PXR24
 *   refused     compression  PIZ, B44, B44A, DWAA, DWAB, HTJ2K — re-save as ZIP
 *               layout       tiled, deep, multi-part, mip/rip-mapped, cube-map
 *               channels     subsampled, or neither R,G,B nor Y
 *
 * Read from the OpenEXR file layout: a magic number and version, a header of typed
 * attributes, a table of block offsets, then blocks of scanlines each carrying its own
 * first line, so a file stored bottom-to-top lands the right way up.
 */
import { inflateSync } from 'node:zlib';
import type { Panorama } from './environmentImport';

export class ExrError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExrError';
    }
}

/** The compressions this reads. */
export const EXR_SUPPORTED_COMPRESSIONS = ['NONE', 'RLE', 'ZIPS', 'ZIP', 'PXR24'] as const;

const COMPRESSION_NAMES = ['NONE', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB', 'HTJ2K256', 'HTJ2K32'];
/** Scanlines in one block, by compression number. */
const LINES_PER_BLOCK = [1, 1, 1, 16, 32, 16, 32, 32, 32, 256, 256, 32];

/** The widest panorama read: a float RGB copy of it is 12 bytes a texel. */
export const EXR_MAX_TEXELS = 8192 * 4096;

// Pixel types: 0 is UINT, which the sample reader falls through to.
const PIXEL_HALF = 1, PIXEL_FLOAT = 2;
const SAMPLE_BYTES = [4, 2, 4];

interface Channel {
    name: string;
    pixelType: number;
    bytesPerSample: number;
}

export interface ExrImage {
    panorama: Panorama;
    /** What the file said about itself that the import should pass on. */
    warnings: string[];
}

const HALF_TABLE = (() => {
    const t = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
        const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
    }
    return t;
})();

/** Undo the byte reordering and delta coding that ZIP and RLE apply before compressing. */
function unpredict(src: Uint8Array): Uint8Array {
    const n = src.length;
    const t = new Uint8Array(n);
    t[0] = src[0] ?? 0;
    for (let i = 1; i < n; i++) t[i] = (t[i - 1]! + src[i]! - 128) & 0xff;
    const out = new Uint8Array(n);
    const half = (n + 1) >> 1;
    for (let i = 0, a = 0, b = half; i < n; i += 2, a++, b++) {
        out[i] = t[a]!;
        if (i + 1 < n) out[i + 1] = t[b]!;
    }
    return out;
}

function rleDecode(src: Uint8Array, expected: number): Uint8Array {
    const out = new Uint8Array(expected);
    let i = 0, o = 0;
    while (i < src.length && o < expected) {
        const count = (src[i++]! << 24) >> 24;
        if (count < 0) {
            const n = -count;
            if (i + n > src.length || o + n > expected) throw new ExrError('the RLE data runs past its block');
            out.set(src.subarray(i, i + n), o);
            i += n; o += n;
        } else {
            const n = count + 1;
            if (i >= src.length || o + n > expected) throw new ExrError('the RLE data runs past its block');
            out.fill(src[i++]!, o, o + n);
            o += n;
        }
    }
    if (o !== expected) throw new ExrError('the RLE data ends before its block does');
    return out;
}

/** PXR24: per scanline and channel, byte planes of the delta-coded values, floats cut to 24 bits. */
function pxr24Decode(src: Uint8Array, channels: readonly Channel[], width: number, lines: number): Uint8Array {
    const raw = inflateSync(src);
    const lineBytes = channels.reduce((s, c) => s + c.bytesPerSample * width, 0);
    const out = new Uint8Array(lineBytes * lines);
    const view = new DataView(out.buffer);
    let at = 0, o = 0;
    for (let y = 0; y < lines; y++) {
        for (const c of channels) {
            let pixel = 0;
            if (c.pixelType === PIXEL_HALF) {
                const p0 = at, p1 = at + width;
                at += 2 * width;
                for (let x = 0; x < width; x++) {
                    pixel = (pixel + ((raw[p0 + x]! << 8) | raw[p1 + x]!)) & 0xffff;
                    view.setUint16(o + x * 2, pixel, true);
                }
            } else if (c.pixelType === PIXEL_FLOAT) {
                const p0 = at, p1 = at + width, p2 = at + 2 * width;
                at += 3 * width;
                for (let x = 0; x < width; x++) {
                    pixel = (pixel + ((raw[p0 + x]! << 24) | (raw[p1 + x]! << 16) | (raw[p2 + x]! << 8))) >>> 0;
                    view.setUint32(o + x * 4, pixel, true);
                }
            } else {
                const p0 = at, p1 = at + width, p2 = at + 2 * width, p3 = at + 3 * width;
                at += 4 * width;
                for (let x = 0; x < width; x++) {
                    pixel = (pixel + ((raw[p0 + x]! << 24) | (raw[p1 + x]! << 16) | (raw[p2 + x]! << 8) | raw[p3 + x]!)) >>> 0;
                    view.setUint32(o + x * 4, pixel, true);
                }
            }
            o += c.bytesPerSample * width;
        }
    }
    if (at > raw.length) throw new ExrError('the PXR24 data ends before its block does');
    return out;
}

interface Header {
    width: number;
    height: number;
    yMin: number;
    compression: number;
    channels: Channel[];
    pos: number;
}

function readHeader(bytes: Uint8Array): Header {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8 || view.getUint32(0, true) !== 20000630) throw new ExrError('not an OpenEXR file: no magic number');
    // One 32-bit word: the version in the low byte, the layout flags in bits 9 to 12.
    const word = view.getUint32(4, true);
    const version = word & 0xff;
    const flags = word & ~0xff;
    if (version !== 2) throw new ExrError(`OpenEXR version ${version} is not one this reads (2)`);
    if (flags & 0x200) throw new ExrError('a tiled OpenEXR is not supported; save it as scanlines');
    if (flags & 0x800) throw new ExrError('a deep OpenEXR is not supported');
    if (flags & 0x1000) throw new ExrError('a multi-part OpenEXR is not supported; save one layer');

    let pos = 8;
    const text = (): string => {
        const start = pos;
        while (pos < bytes.length && bytes[pos] !== 0) pos++;
        if (pos >= bytes.length) throw new ExrError('the OpenEXR header ends inside a name');
        const s = new TextDecoder().decode(bytes.subarray(start, pos));
        pos++;
        return s;
    };
    let channels: Channel[] | null = null;
    let compression = -1;
    let window: [number, number, number, number] | null = null;
    let envmap = -1;
    for (;;) {
        if (pos >= bytes.length) throw new ExrError('the OpenEXR header never ends');
        if (bytes[pos] === 0) { pos++; break; }
        const name = text();
        const type = text();
        const size = view.getInt32(pos, true);
        pos += 4;
        if (size < 0 || pos + size > bytes.length) throw new ExrError(`the header attribute ${name} runs past the file`);
        const end = pos + size;
        if (name === 'channels' && type === 'chlist') {
            const list: Channel[] = [];
            while (pos < end && bytes[pos] !== 0) {
                const channelName = text();
                const pixelType = view.getInt32(pos, true);
                const xs = view.getInt32(pos + 8, true), ys = view.getInt32(pos + 12, true);
                pos += 16;
                if (pixelType < 0 || pixelType > 2) throw new ExrError(`channel ${channelName} has pixel type ${pixelType}`);
                if (xs !== 1 || ys !== 1) throw new ExrError(`channel ${channelName} is subsampled, which is not supported`);
                list.push({ name: channelName, pixelType, bytesPerSample: SAMPLE_BYTES[pixelType]! });
            }
            channels = list;
        } else if (name === 'compression' && type === 'compression') {
            compression = view.getUint8(pos);
        } else if (name === 'dataWindow' && type === 'box2i') {
            window = [view.getInt32(pos, true), view.getInt32(pos + 4, true), view.getInt32(pos + 8, true), view.getInt32(pos + 12, true)];
        } else if (name === 'envmap' && type === 'envmap') {
            envmap = view.getUint8(pos);
        }
        pos = end;
    }
    if (!channels || compression < 0 || !window) throw new ExrError('the OpenEXR header lacks its channels, compression or data window');
    if (envmap === 1) throw new ExrError('a cube-map OpenEXR is not supported; use a lat-long panorama');
    const width = window[2] - window[0] + 1, height = window[3] - window[1] + 1;
    if (!(width > 0) || !(height > 0)) throw new ExrError('the OpenEXR data window is empty');
    if (width * height > EXR_MAX_TEXELS) {
        throw new ExrError(`the panorama is ${width}x${height}; at most ${EXR_MAX_TEXELS} texels are read`);
    }
    return { width, height, yMin: window[1], compression, channels, pos };
}

/** Decode one block of scanlines to its raw, line-by-line, channel-by-channel bytes. */
function inflateBlock(compression: number, payload: Uint8Array, channels: readonly Channel[], width: number, lines: number): Uint8Array {
    const expected = channels.reduce((s, c) => s + c.bytesPerSample * width, 0) * lines;
    if (compression === 0 || payload.length === expected) {
        if (payload.length !== expected) throw new ExrError('a block holds fewer bytes than its lines need');
        return payload;
    }
    switch (compression) {
        case 1: return unpredict(rleDecode(payload, expected));
        case 2:
        case 3: return unpredict(inflateSync(payload));
        case 5: return pxr24Decode(payload, channels, width, lines);
        default: throw new ExrError(`unsupported compression ${COMPRESSION_NAMES[compression] ?? compression}`);
    }
}

/** Decode an OpenEXR panorama into linear RGB, row 0 = up (+Y). */
export function decodeExr(bytes: Uint8Array): ExrImage {
    const header = readHeader(bytes);
    const { width, height, yMin, compression, channels } = header;
    if (!(compression in LINES_PER_BLOCK) || (EXR_SUPPORTED_COMPRESSIONS as readonly string[]).indexOf(COMPRESSION_NAMES[compression]!) < 0) {
        throw new ExrError(`unsupported compression ${COMPRESSION_NAMES[compression] ?? compression}; `
            + `re-save the file with ${EXR_SUPPORTED_COMPRESSIONS.join(', ')}`);
    }
    const names = channels.map((c) => c.name);
    const rgbIndex = ['R', 'G', 'B'].map((n) => names.indexOf(n));
    const yIndex = names.indexOf('Y');
    const gray = rgbIndex.some((i) => i < 0);
    if (gray && yIndex < 0) {
        throw new ExrError(`the channels are ${names.join(', ')}; a panorama needs R, G and B (or a single Y)`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const linesPerBlock = LINES_PER_BLOCK[compression]!;
    const blocks = Math.ceil(height / linesPerBlock);
    let pos = header.pos;
    const offsets: number[] = [];
    for (let i = 0; i < blocks; i++, pos += 8) {
        if (pos + 8 > bytes.length) throw new ExrError('the block offset table runs past the file');
        offsets.push(view.getUint32(pos, true) + view.getUint32(pos + 4, true) * 2 ** 32);
    }

    const lineBytes = channels.reduce((s, c) => s + c.bytesPerSample * width, 0);
    const channelOffset: number[] = [];
    let run = 0;
    for (const c of channels) { channelOffset.push(run); run += c.bytesPerSample * width; }
    const rgb = new Float32Array(width * height * 3);
    const warnings: string[] = [];
    let repaired = 0;

    const sample = (data: DataView, base: number, c: Channel, x: number): number => {
        const at = base + x * c.bytesPerSample;
        if (c.pixelType === PIXEL_HALF) return HALF_TABLE[data.getUint16(at, true)]!;
        if (c.pixelType === PIXEL_FLOAT) return data.getFloat32(at, true);
        return data.getUint32(at, true);
    };

    for (const offset of offsets) {
        if (offset + 8 > bytes.length) throw new ExrError('a block starts past the end of the file');
        const y0 = view.getInt32(offset, true) - yMin;
        const size = view.getInt32(offset + 4, true);
        if (size < 0 || offset + 8 + size > bytes.length) throw new ExrError('a block runs past the end of the file');
        const lines = Math.min(linesPerBlock, height - y0);
        if (y0 < 0 || lines <= 0) throw new ExrError(`a block names the line ${y0 + yMin}, outside the data window`);
        const raw = inflateBlock(compression, bytes.subarray(offset + 8, offset + 8 + size), channels, width, lines);
        const data = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let l = 0; l < lines; l++) {
            const row = (y0 + l) * width * 3;
            const base = l * lineBytes;
            for (let x = 0; x < width; x++) {
                for (let k = 0; k < 3; k++) {
                    const ci = gray ? yIndex : rgbIndex[k]!;
                    let v = sample(data, base + channelOffset[ci]!, channels[ci]!, x);
                    // Radiance is a finite, non-negative amount of light; anything else would
                    // poison every texel the prefilter averages it into.
                    if (!Number.isFinite(v) || v < 0) { v = 0; repaired++; }
                    rgb[row + x * 3 + k] = v;
                }
            }
        }
    }
    if (repaired > 0) warnings.push(`${repaired} sample(s) were negative or not a number and were read as black`);
    return { panorama: { width, height, rgb }, warnings };
}
