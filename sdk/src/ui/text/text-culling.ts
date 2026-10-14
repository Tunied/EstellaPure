// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { TEXT_VERTEX_FLOATS } from './submit';

const QUAD_FLOATS = 4 * TEXT_VERTEX_FLOATS;
const BLOCK_QUADS = 64;
const ROUNDING_MARGIN = 8 * 2 ** -23;

export interface TextCullGeometry {
    vertices: Float32Array;
    indices: Uint16Array;
    blocks: Float32Array;
    visible: Uint8Array;
    blockVisibility: Uint8Array;
    clippedVertices?: Float32Array;
    clippedIndices?: Uint16Array;
}

export function createTextCullGeometry(vertices: Float32Array, indices: Uint16Array): TextCullGeometry {
    const count = vertices.length / QUAD_FLOATS;
    const blocks = new Float32Array(Math.ceil(count / BLOCK_QUADS) * 4);
    for (let start = 0; start < count; start += BLOCK_QUADS) {
        let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
        const end = Math.min(count, start + BLOCK_QUADS) * QUAD_FLOATS;
        for (let i = start * QUAD_FLOATS; i < end; i += TEXT_VERTEX_FLOATS) {
            left = Math.min(left, vertices[i]); right = Math.max(right, vertices[i]);
            bottom = Math.min(bottom, vertices[i + 1]); top = Math.max(top, vertices[i + 1]);
        }
        blocks.set([left, bottom, right, top], start / BLOCK_QUADS * 4);
    }
    return { vertices, indices, blocks, visible: new Uint8Array(count), blockVisibility: new Uint8Array(blocks.length / 4) };
}

/** Clip planes on the glyph's local z=0 plane. Error weights conservatively
 *  bound float32 model/projection roundoff, including cancellation. Near uses
 *  -w, which remains conservative for both OpenGL and zero-to-one depth. */
export function textClipPlanes(out: Float64Array, view: Float32Array, model: Float32Array): boolean {
    if (view.length < 16 || model.length < 16) return false;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(view[i]) || !Number.isFinite(model[i])) return false;
    for (let plane = 0; plane < 6; plane++) {
        const row = plane >> 1, sign = plane % 2 === 0 ? 1 : -1;
        for (let slot = 0; slot < 3; slot++) {
            const column = slot === 2 ? 12 : slot * 4;
            let value = 0, error = 0;
            for (let k = 0; k < 4; k++) {
                const a = view[k * 4 + 3], b = view[k * 4 + row];
                value += (a + sign * b) * model[column + k];
                error += (Math.abs(a) + Math.abs(b)) * Math.abs(model[column + k]);
            }
            out[plane * 6 + slot] = value;
            out[plane * 6 + slot + 3] = error * ROUNDING_MARGIN;
        }
    }
    return true;
}

// 0 outside; 1 inside; 2 crossing a clip plane. Non-finite bounds stay visible.
function classify(planes: Float64Array, left: number, bottom: number, right: number, top: number): number {
    if (!Number.isFinite(left) || !Number.isFinite(bottom) || !Number.isFinite(right) || !Number.isFinite(top)) return 1;
    let inside = true;
    const x = Math.max(Math.abs(left), Math.abs(right)), y = Math.max(Math.abs(bottom), Math.abs(top));
    for (let p = 0; p < 36; p += 6) {
        const a = planes[p], b = planes[p + 1], c = planes[p + 2];
        const margin = planes[p + 3] * x + planes[p + 4] * y + planes[p + 5];
        const lo = a * (a >= 0 ? left : right) + b * (b >= 0 ? bottom : top) + c;
        const hi = a * (a >= 0 ? right : left) + b * (b >= 0 ? top : bottom) + c;
        if (hi < -margin) return 0;
        if (lo < margin) inside = false;
    }
    return inside ? 1 : 2;
}

/** Preserve the full cache, copying only visible quads into reusable buffers. */
export function clipTextGeometry(geometry: TextCullGeometry, planes: Float64Array | null):
    { vertices: Float32Array; indices: Uint16Array } | null {
    if (!planes) return geometry;
    const count = geometry.vertices.length / QUAD_FLOATS;
    let visibleCount = 0;
    for (let start = 0; start < count; start += BLOCK_QUADS) {
        const block = start / BLOCK_QUADS * 4;
        const end = Math.min(count, start + BLOCK_QUADS);
        const status = classify(planes, geometry.blocks[block], geometry.blocks[block + 1], geometry.blocks[block + 2], geometry.blocks[block + 3]);
        geometry.blockVisibility[start / BLOCK_QUADS] = status;
        if (status !== 2) {
            geometry.visible.fill(status, start, end);
            if (status === 1) visibleCount += end - start;
            continue;
        }
        for (let quad = start; quad < end; quad++) {
            const offset = quad * QUAD_FLOATS;
            const x0 = geometry.vertices[offset], y0 = geometry.vertices[offset + 1];
            const x1 = geometry.vertices[offset + 2 * TEXT_VERTEX_FLOATS], y1 = geometry.vertices[offset + 2 * TEXT_VERTEX_FLOATS + 1];
            const survives = classify(planes, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)) !== 0;
            geometry.visible[quad] = survives ? 1 : 0;
            if (survives) visibleCount++;
        }
    }
    if (visibleCount === 0) return null;
    if (visibleCount === count) return geometry;
    const floats = visibleCount * QUAD_FLOATS, indexCount = visibleCount * 6;
    if (!geometry.clippedVertices || geometry.clippedVertices.length < floats) geometry.clippedVertices = new Float32Array(floats);
    if (!geometry.clippedIndices || geometry.clippedIndices.length < indexCount) geometry.clippedIndices = new Uint16Array(indexCount);
    let output = 0;
    for (let start = 0; start < count; start += BLOCK_QUADS) {
        if (geometry.blockVisibility[start / BLOCK_QUADS] === 0) continue;
        const end = Math.min(count, start + BLOCK_QUADS);
        for (let quad = start; quad < end; quad++) {
            if (!geometry.visible[quad]) continue;
            const source = quad * QUAD_FLOATS, target = output * QUAD_FLOATS;
            for (let i = 0; i < QUAD_FLOATS; i++) geometry.clippedVertices[target + i] = geometry.vertices[source + i];
            const base = output * 4, sourceBase = quad * 4;
            for (let i = 0; i < 6; i++) geometry.clippedIndices[output * 6 + i] = geometry.indices[quad * 6 + i] - sourceBase + base;
            output++;
        }
    }
    return { vertices: geometry.clippedVertices.subarray(0, floats), indices: geometry.clippedIndices.subarray(0, indexCount) };
}
