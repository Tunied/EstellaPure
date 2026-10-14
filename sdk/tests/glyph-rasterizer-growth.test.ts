// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, vi } from 'vitest';
import type { PlatformCanvas, PlatformCanvas2DContext } from '../src/platform/types';
import { CanvasGlyphRasterizer } from '../src/ui/text/glyph-rasterizer';

const canvases = vi.hoisted(() => [] as Array<{canvas: PlatformCanvas; ctx: PlatformCanvas2DContext; draws: string[]}>);
vi.mock('../src/platform', () => ({ platformCreateCanvas: (width: number, height: number) => makeCanvas(width, height) }));
function makeCanvas(width: number, height: number): PlatformCanvas {
    const draws: string[] = [];
    const ctx: PlatformCanvas2DContext = {
        font: '10px sans-serif', textBaseline: 'alphabetic', textAlign: 'start', fillStyle: '#000000',
        clearRect: () => {}, drawImage: () => {},
        measureText: () => {
            const size = Number(/([\d.]+)px/.exec(ctx.font)![1]);
            return { width: size * .8, actualBoundingBoxLeft: size * .2,
                actualBoundingBoxRight: size * .75, actualBoundingBoxAscent: size * .7, actualBoundingBoxDescent: size * .2 };
        },
        fillText: () => { draws.push(`${ctx.font}|${ctx.textBaseline}|${ctx.textAlign}`); },
        getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
    const reset = () => { ctx.font = '10px sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'start'; };
    const canvas: PlatformCanvas = {
        get width() { return width; }, set width(value) { width = value; reset(); },
        get height() { return height; }, set height(value) { height = value; reset(); },
        getContext: () => ctx,
    };
    canvases.push({ canvas, ctx, draws });
    return canvas;
}
beforeEach(() => { canvases.length = 0; });

it('grows for a large bitmap glyph and restores font, style and alignment after resizing', () => {
    const rasterizer = new CanvasGlyphRasterizer(null, { renderSize: 64, sdf: false });
    expect(rasterizer.rasterize(87, 'Arial', 3, 32)).not.toBeNull();
    const large = rasterizer.rasterize(87, 'Arial', 3, 256)!;
    expect(large).not.toBeNull();
    expect(large.advance).toBeCloseTo(204.8);
    expect(large.bearingX).toBeCloseTo(-57.2);
    expect(large.pixels.length).toBe(large.width * large.height * 4);
    expect(canvases[0].canvas.width).toBeGreaterThan(140);
    expect(canvases[0].canvas.height).toBeGreaterThan(140);
    expect(canvases[0].draws.at(-1)).toBe('italic bold 256px Arial|alphabetic|left');
    const dimensions = [canvases[0].canvas.width, canvases[0].canvas.height];
    expect(rasterizer.rasterize(87, 'Arial', 3, 32)).not.toBeNull();
    expect([canvases[0].canvas.width, canvases[0].canvas.height]).toEqual(dimensions);
});

it('rejects tiles exceeding the atlas budget without growing the scratch canvas', () => {
    const rasterizer = new CanvasGlyphRasterizer(null, { renderSize: 64, sdf: false, maxGlyphSize: 64 });
    const dimensions = [canvases[0].canvas.width, canvases[0].canvas.height];
    expect(dimensions).toEqual([64, 64]);
    expect(rasterizer.rasterize(87, 'Arial', 0, 256)).toBeNull();
    expect([canvases[0].canvas.width, canvases[0].canvas.height]).toEqual(dimensions);
    expect(canvases[0].draws).toEqual([]);
});
