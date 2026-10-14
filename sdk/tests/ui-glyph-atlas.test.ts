// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.1c — GlyphAtlas orchestration. The Canvas2D rasterizer
 *        isn't headless-renderable, so the atlas takes injectable GlyphRasterizer
 *        + AtlasPageStore; here we drive it with mocks to verify cache, packing,
 *        multi-page overflow, whitespace, and unknown-glyph handling.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    GlyphAtlas,
    type GlyphRasterizer,
    type AtlasPageStore,
    type RasterGlyph,
} from '../src/ui/text/glyph-atlas';

import { layoutText } from '../src/ui/text/layout';

const UNKNOWN = 0xffff;
const SPACE = 32;
const HUGE = 0xaaaa;

function makeRasterizer() {
    const rasterize = vi.fn((cp: number): RasterGlyph | null => {
        if (cp === UNKNOWN) return null;
        if (cp === SPACE) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 12, bearingX: 0, bearingY: 0 };
        if (cp === HUGE) return { pixels: new Uint8Array(100 * 100 * 4), width: 100, height: 100, advance: 100, bearingX: 0, bearingY: 0 };
        const w = 10, h = 12;
        return { pixels: new Uint8Array(w * h * 4).fill(200), width: w, height: h, advance: 11, bearingX: 1, bearingY: 10 };
    });
    return { renderSize: 48, spread: 6, rasterize } as GlyphRasterizer & { rasterize: typeof rasterize };
}

function makeStore() {
    let next = 100;
    const uploads: Array<{ pageId: number; x: number; y: number; w: number; h: number; len: number }> = [];
    const createPage = vi.fn((_size: number) => next++);
    const uploadSubRegion = vi.fn((pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array) => {
        uploads.push({ pageId, x, y, w, h, len: pixels.length });
    });
    return { createPage, uploadSubRegion, uploads } as AtlasPageStore & {
        createPage: typeof createPage; uploadSubRegion: typeof uploadSubRegion;
        uploads: typeof uploads;
    };
}

describe('REARCH_GUI P1.1c: GlyphAtlas', () => {
    it('releases every page once, including when one release fails, and clears cached glyphs', () => {
        const rasterizer = makeRasterizer();
        const store = makeStore();
        const releasePage = vi.fn((id: number) => {
            if (id === 100) throw new Error('release failed');
        });
        const atlas = new GlyphAtlas(rasterizer, { ...store, releasePage }, { pageSize: 64, padding: 1 });
        for (let i = 0; i < 25; i++) atlas.getGlyph(0x100 + i, 'Arial');
        expect(atlas.pageCount).toBe(2);
        expect(() => atlas.dispose()).toThrow('Failed to release glyph atlas pages');
        expect(releasePage.mock.calls).toEqual([[100], [101]]);
        expect(atlas.pageCount).toBe(0);
        atlas.dispose();
        expect(releasePage).toHaveBeenCalledTimes(2);
        const calls = rasterizer.rasterize.mock.calls.length;
        expect(atlas.getGlyph(0x100, 'Arial')!.pageId).toBe(102);
        expect(rasterizer.rasterize).toHaveBeenCalledTimes(calls + 1);
    });

    it('matches measured rich layout without allocating pages, including styles and wrapping', () => {
        const metricsRasterizer = makeRasterizer();
        const metrics = new GlyphAtlas(metricsRasterizer, null);
        const rendered = new GlyphAtlas(makeRasterizer(), makeStore());
        const content = 'A Ω <b>styled</b><img src="icon.png" width="18" height="16"> text\nnext line';
        const options = { fontSizePx: 24, maxWidth: 90, boxWidth: 120, rich: true, color: [1, 1, 1, 1] as const };
        const measured = layoutText(content, metrics, 'Arial', options);
        const expected = layoutText(content, rendered, 'Arial', options);
        expect({ width: measured.width, lineHeight: measured.lineHeight, images: measured.images })
            .toEqual({ width: expected.width, lineHeight: expected.lineHeight, images: expected.images });
        expect(measured.glyphs.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })))
            .toEqual(expected.glyphs.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })));
        expect(metrics.pageCount).toBe(0);
        expect(rendered.pageCount).toBeGreaterThan(0);
        const calls = metricsRasterizer.rasterize.mock.calls.length;
        layoutText(content, metrics, 'Arial', options);
        expect(metricsRasterizer.rasterize).toHaveBeenCalledTimes(calls);
        metrics.dispose();
        layoutText(content, metrics, 'Arial', options);
        expect(metricsRasterizer.rasterize.mock.calls.length).toBeGreaterThan(calls);
        expect(metrics.pageCount).toBe(0);
    });

    it('rasterizes, packs and uploads on first use; returns UVs + metrics', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64, padding: 1 });

        const g = atlas.getGlyph(65, 'Arial');
        expect(g).not.toBeNull();
        expect(g!.pageId).toBe(100);
        expect(g!.width).toBe(10);
        expect(g!.height).toBe(12);
        expect(g!.advance).toBe(11);
        expect(g!.bearingY).toBe(10);
        expect(g!.u0).toBe(0);
        expect(g!.u1).toBeCloseTo(10 / 64);
        expect(g!.v1).toBeCloseTo(12 / 64);
        expect(s.createPage).toHaveBeenCalledTimes(1);
        expect(s.uploads).toEqual([{ pageId: 100, x: 0, y: 0, w: 10, h: 12, len: 480 }]);
    });

    it('caches: a second request neither rasterizes nor uploads again', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });

        const a = atlas.getGlyph(65, 'Arial');
        const b = atlas.getGlyph(65, 'Arial');
        expect(b).toBe(a);
        expect(r.rasterize).toHaveBeenCalledTimes(1);
        expect(s.uploadSubRegion).toHaveBeenCalledTimes(1);
    });

    it('keys by font + style so distinct fonts/styles get distinct cells', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        atlas.getGlyph(65, 'Arial', 0);
        atlas.getGlyph(65, 'Arial', 1);   // bold
        atlas.getGlyph(65, 'Times', 0);
        expect(r.rasterize).toHaveBeenCalledTimes(3);
    });

    it('whitespace gets an advance-only entry with no upload', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        atlas.getGlyph(65, 'Arial');            // allocate a page first
        s.uploadSubRegion.mockClear();
        const sp = atlas.getGlyph(SPACE, 'Arial');
        expect(sp).not.toBeNull();
        expect(sp!.width).toBe(0);
        expect(sp!.advance).toBe(12);
        expect(s.uploadSubRegion).not.toHaveBeenCalled();
    });

    it('caches unknown glyphs as null (rasterized once)', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        expect(atlas.getGlyph(UNKNOWN, 'Arial')).toBeNull();
        expect(atlas.getGlyph(UNKNOWN, 'Arial')).toBeNull();
        expect(r.rasterize).toHaveBeenCalledTimes(1);
    });

    it('opens a new page when the current one fills', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64, padding: 1 });
        // 64/11 = 5 per row, 64/13 = 4 rows ⇒ ~20 glyphs/page; 25 forces a 2nd page.
        for (let i = 0; i < 25; i++) atlas.getGlyph(0x100 + i, 'Arial');
        expect(atlas.pageCount).toBe(2);
        expect(s.createPage).toHaveBeenCalledTimes(2);
    });

    it('returns null for a glyph larger than a whole page', () => {
        const r = makeRasterizer();
        const s = makeStore();
        const atlas = new GlyphAtlas(r, s, { pageSize: 64 });
        expect(atlas.getGlyph(HUGE, 'Arial')).toBeNull();
    });
});

describe('GlyphAtlas: a page painted again is the page that was uploaded', () => {
    const PAGE = 64;

    /** Every texel differs by glyph, row and column, so a misplaced or flipped cell shows. */
    function patternRasterizer(grow = new Set<number>()) {
        const rasterize = vi.fn((cp: number): RasterGlyph | null => {
            if (cp === UNKNOWN) return null;
            if (cp === SPACE) return { pixels: new Uint8Array(0), width: 0, height: 0, advance: 12, bearingX: 0, bearingY: 0 };
            const w = grow.has(cp) ? 20 : 9 + (cp % 3), h = grow.has(cp) ? 20 : 11 + (cp % 2);
            const pixels = new Uint8Array(w * h * 4);
            for (let row = 0; row < h; row++) {
                for (let col = 0; col < w; col++) {
                    pixels.fill((cp + row * 7 + col * 3) & 0xff, (row * w + col) * 4, (row * w + col + 1) * 4);
                }
            }
            return { pixels, width: w, height: h, advance: w, bearingX: 0, bearingY: h };
        });
        return { renderSize: 48, spread: 6, rasterize } as GlyphRasterizer;
    }

    /** Keeps each page as the GPU would hold it, and the painter the atlas handed over. */
    function imageStore() {
        const images: Uint8Array[] = [];
        const painters: Array<(pixels: Uint8Array) => void> = [];
        const store: AtlasPageStore = {
            createPage(size, paint) {
                images.push(new Uint8Array(size * size * 4));
                painters.push(paint);
                return images.length - 1;
            },
            uploadSubRegion(pageId, x, y, w, h, pixels) {
                for (let row = 0; row < h; row++) {
                    images[pageId].set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * PAGE + x) * 4);
                }
            },
        };
        return { store, images, painters };
    }

    it('prunes unused pages without changing live UVs or their restore painter', () => {
        const { store, images, painters } = imageStore();
        const releasePage = vi.fn();
        const atlas = new GlyphAtlas(patternRasterizer(), { ...store, releasePage }, { pageSize: PAGE, padding: 1 });
        for (let i = 0; i < 30; i++) atlas.getGlyph(0x100 + i, 'Arial');
        const retired = atlas.getGlyph(0x100, 'Arial')!;
        const kept = atlas.getGlyph(0x11d, 'Arial')!;
        expect(retired.pageId).not.toBe(kept.pageId);
        const generation = atlas.generation;
        atlas.retainPages(new Set([kept.pageId]));
        expect(atlas.pageCount).toBe(1);
        expect(releasePage).toHaveBeenCalledWith(retired.pageId);
        expect(atlas.generation).toBe(generation);
        expect(atlas.getGlyph(0x11d, 'Arial')).toBe(kept);
        const repaint = new Uint8Array(PAGE * PAGE * 4);
        painters[kept.pageId](repaint);
        expect(repaint).toEqual(images[kept.pageId]);
        expect(atlas.getGlyph(0x100, 'Arial')!.pageId).not.toBe(retired.pageId);
        atlas.retainPages(new Set());
        expect(atlas.pageCount).toBe(0);
        expect(atlas.getGlyph(0x100, 'Arial')).not.toBeNull();
    });

    it('repaints every page byte for byte, across pages, skipping blanks', () => {
        const { store, images, painters } = imageStore();
        const atlas = new GlyphAtlas(patternRasterizer(), store, { pageSize: PAGE, padding: 1 });
        for (let i = 0; i < 30; i++) atlas.getGlyph(0x100 + i, 'Arial', i % 4);
        atlas.getGlyph(SPACE, 'Arial');
        atlas.getGlyph(UNKNOWN, 'Arial');
        expect(atlas.pageCount).toBe(2);

        for (let page = 0; page < images.length; page++) {
            const repainted = new Uint8Array(PAGE * PAGE * 4);
            painters[page](repainted);
            expect(repainted.some((v) => v !== 0)).toBe(true);
            expect(repainted).toEqual(images[page]);
        }
    });

    it('clips a glyph that now rasterizes larger to the cell it was given', () => {
        const grow = new Set<number>();
        const { store, images, painters } = imageStore();
        const atlas = new GlyphAtlas(patternRasterizer(grow), store, { pageSize: PAGE, padding: 1 });
        atlas.getGlyph(0x100, 'Arial');
        atlas.getGlyph(0x101, 'Arial');
        // The last glyph packed, so nothing painted after it covers an overflow.
        grow.add(0x101);

        const repainted = new Uint8Array(PAGE * PAGE * 4);
        painters[0](repainted);
        expect(repainted).toEqual(images[0]);
    });
});
