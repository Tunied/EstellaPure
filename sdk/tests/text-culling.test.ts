// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { createTextCullGeometry, textClipPlanes, clipTextGeometry } from '../src/ui/text/text-culling';
import { buildGlyphVertices, type LaidGlyph } from '../src/ui/text/layout';
import { TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';

const identity = () => new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function makeQuads(count: number) {
    const glyphs: LaidGlyph[] = Array.from({ length: count }, (_, i) => ({
        pageId: 1, u0: 0, v0: 0, u1: 1, v1: 1,
        x0: i * 2, x1: i * 2 + 0.5, y0: -0.5, y1: 0.5,
    }));
    const buffers = buildGlyphVertices(glyphs, [0.2, 0.4, 0.6, 0.7]);
    return createTextCullGeometry(buffers.vertices, buffers.indices);
}
function planes(model = identity(), view = identity()) {
    const result = new Float64Array(36);
    expect(textClipPlanes(result, view, model)).toBe(true);
    return result;
}

it('compacts a visible tail across cached blocks, preserving every vertex attribute and index order', () => {
    const geometry = makeQuads(1024);
    const model = identity(); model[12] = -2046;
    const visible = clipTextGeometry(geometry, planes(model))!;
    expect(visible.vertices).toEqual(geometry.vertices.slice(-4 * TEXT_VERTEX_FLOATS));
    expect(visible.indices).toEqual(new Uint16Array([0,1,2,0,2,3]));
    expect(geometry.vertices.length).toBe(1024 * 4 * TEXT_VERTEX_FLOATS);
    const scratch = geometry.clippedVertices;
    clipTextGeometry(geometry, planes(model));
    expect(geometry.clippedVertices).toBe(scratch);
    model[12] = 10;
    expect(clipTextGeometry(geometry, planes(model))).toBeNull();
    const wide = identity(); wide[0] = 1 / 4096;
    expect(clipTextGeometry(geometry, planes(identity(), wide))).toBe(geometry);
});

it('keeps mirrored and sheared quads, including clip-edge and near-plane intersections', () => {
    const geometry = makeQuads(2), model = identity();
    model[0] = -1; model[4] = 0.5; model[12] = 2;
    const visible = clipTextGeometry(geometry, planes(model))!;
    expect(visible.vertices).toEqual(geometry.vertices.slice(4 * TEXT_VERTEX_FLOATS));
    const edge = identity(); edge[12] = 1;
    expect(clipTextGeometry(makeQuads(1), planes(edge))).not.toBeNull();
    const near = identity(); near[2] = 4; near[14] = -1.5;
    expect(clipTextGeometry(makeQuads(1), planes(near))).not.toBeNull();
});

it('keeps float32 cancellation and invalid projections conservative', () => {
    const model = identity(); model[12] = 1e10;
    const view = identity(); view[12] = -1e10;
    expect(clipTextGeometry(makeQuads(1), planes(model, view))).not.toBeNull();
    const out = new Float64Array(36); view[0] = NaN;
    expect(textClipPlanes(out, view, model)).toBe(false);
    const geometry = makeQuads(1);
    expect(clipTextGeometry(geometry, null)).toBe(geometry);
});

it('retains a quad with reversed local corners that crosses the viewport edge', () => {
    const glyphs: LaidGlyph[] = [
        { pageId: 1, u0: 0, v0: 0, u1: 1, v1: 1, x0: 2.5, x1: 0.5, y0: 0.5, y1: -0.5 },
    ];
    const buffers = buildGlyphVertices(glyphs, [1, 1, 1, 1]);
    const geometry = createTextCullGeometry(buffers.vertices, buffers.indices);
    expect(clipTextGeometry(geometry, planes())).toBe(geometry);
});
