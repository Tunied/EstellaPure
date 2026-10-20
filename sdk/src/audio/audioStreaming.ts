// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audioStreaming.ts
 * @brief   When a clip is played from its compressed file instead of being decoded into memory.
 *
 * A long clip decoded to PCM costs minutes × 48000 × 2 channels × 4 bytes (a three-minute track
 * is ~69MB), which is what a phone browser or a playable ad cannot spare. A short effect is the
 * opposite: decoded it plays with no start-up delay, streamed it waits on the element.
 *
 * The importer says `auto`, `decompress` or `streaming`; `auto` means the length decides.
 * Pure, so a backend and a test agree on the rule.
 */
import type { AudioLoadType } from './PlatformAudioBackend';

/** A clip at least this long streams when the importer says `auto`. */
export const AUTO_STREAM_SECONDS = 30;

/** A compressed file of unknown length this big streams under `auto` — what 30 seconds of a
 *  typical 128 kbps file weighs, rounded up to leave the short effects alone. */
const UNKNOWN_LENGTH_STREAM_BYTES = 600 * 1024;

/** The PCM a decoded clip costs: what `bytes` would report if it were decoded, and what streaming saves. */
export function decodedPcmBytes(seconds: number, sampleRate = 48000, channels = 2): number {
    return Math.round(Math.max(0, seconds) * sampleRate * channels * 4);
}

const MP3_BITRATES: Record<number, readonly number[]> = {
    // MPEG-1 Layer III, then MPEG-2/2.5 Layer III, in kbps.
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

function id3Size(view: DataView): number {
    if (view.byteLength < 10 || view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) return 0;
    return 10 + ((view.getUint8(6) & 0x7f) << 21 | (view.getUint8(7) & 0x7f) << 14 | (view.getUint8(8) & 0x7f) << 7 | (view.getUint8(9) & 0x7f));
}

/** Length of a PCM WAV from its header, or null when it is not a RIFF/WAVE we can read. */
function wavSeconds(view: DataView): number | null {
    if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
    let byteRate = 0;
    let off = 12;
    while (off + 8 <= view.byteLength) {
        const id = view.getUint32(off, false);
        const size = view.getUint32(off + 4, true);
        if (id === 0x666d7420 && off + 20 <= view.byteLength) byteRate = view.getUint32(off + 16, true);
        if (id === 0x64617461) return byteRate > 0 ? Math.min(size, view.byteLength - (off + 8)) / byteRate : null;
        off += 8 + size + (size & 1);
    }
    return null;
}

/** Length of a constant-bitrate MP3 from its first frame header and the file size; null if it is not one. */
function mp3Seconds(view: DataView): number | null {
    const start = id3Size(view);
    for (let i = start; i + 4 <= Math.min(view.byteLength, start + 4096); i++) {
        if (view.getUint8(i) !== 0xff || (view.getUint8(i + 1) & 0xe0) !== 0xe0) continue;
        const b1 = view.getUint8(i + 1);
        const b2 = view.getUint8(i + 2);
        const version = (b1 >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
        const layer = (b1 >> 1) & 3; // 1 = Layer III
        const bitrateIndex = b2 >> 4;
        if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15) continue;
        const kbps = MP3_BITRATES[version === 3 ? 1 : 2]![bitrateIndex]!;
        return kbps > 0 ? ((view.byteLength - i) * 8) / (kbps * 1000) : null;
    }
    return null;
}

/**
 * How long a compressed clip plays, read from its header without decoding it.
 * WAV is exact; an MP3 is exact at a constant bitrate and an estimate at a variable one; any
 * other container is unknown (null) and the caller falls back to its size.
 */
export function estimateAudioSeconds(data: ArrayBuffer): number | null {
    const view = new DataView(data);
    return wavSeconds(view) ?? mp3Seconds(view);
}

/** Whether a clip that arrived as `data` is streamed, given what the importer said. */
export function shouldStream(loadType: AudioLoadType | undefined, data: ArrayBuffer): boolean {
    if (loadType === 'streaming') return true;
    if (loadType === 'decompress') return false;
    const seconds = estimateAudioSeconds(data);
    return seconds === null ? data.byteLength >= UNKNOWN_LENGTH_STREAM_BYTES : seconds >= AUTO_STREAM_SECONDS;
}
