// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ rasterize: vi.fn() }));
vi.mock('../src/platform', () => ({
    platformHasGlyphRasterizer: () => true,
    platformRasterizeGlyph: host.rasterize,
}));

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('document', undefined);
    host.rasterize.mockReset().mockImplementation(({ pixelSize, codepoint }) => ({
        advance: pixelSize / 2 + codepoint % 3,
    }));
});
afterEach(() => vi.unstubAllGlobals());

it('retires historical font measurements while retaining recently used advances', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    const measure = (fontFamily: string) => measureText('W', { fontSize: 20, fontFamily }).width;
    const first = measure('old');
    const hot = measure('hot');
    for (let i = 0; i < 8192; i++) {
        measure(`font-${i}`);
        expect(measure('hot')).toBe(hot);
    }
    const calls = host.rasterize.mock.calls.length;
    expect(measure('font-8191')).toBe(first);
    expect(host.rasterize).toHaveBeenCalledTimes(calls);
    expect(measure('old')).toBe(first);
    expect(host.rasterize).toHaveBeenCalledTimes(calls + 1);
    expect(host.rasterize.mock.calls.filter(([r]) => r.fontFamily === 'hot')).toHaveLength(1);
});

it('bounds fallback advances for unavailable glyphs too', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    host.rasterize.mockReturnValue(null);
    const measure = (fontFamily: string) => measureText('中', { fontSize: 20, fontFamily }).width;
    expect(measure('missing')).toBe(12);
    for (let i = 0; i < 4096; i++) measure(`missing-${i}`);
    const calls = host.rasterize.mock.calls.length;
    expect(measure('missing')).toBe(12);
    expect(host.rasterize).toHaveBeenCalledTimes(calls + 1);
});

it('keeps zero advances cached and separates size, style and supplementary characters', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    host.rasterize.mockReturnValue({ advance: 0 });
    expect(measureText('🙂🙂', { fontSize: 20, letterSpacing: 2 }).width).toBe(4);
    expect(host.rasterize).toHaveBeenCalledTimes(1);
    measureText('🙂', { fontSize: 21 });
    measureText('🙂', { fontSize: 20, bold: true });
    measureText('🙂', { fontSize: 20, italic: true });
    expect(host.rasterize).toHaveBeenCalledTimes(4);
});

it('can retire a full recently used working set without losing subsequent measurements', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    const measure = (fontFamily: string) => measureText('W', { fontSize: 20, fontFamily }).width;
    for (let i = 0; i < 4096; i++) measure(`font-${i}`);
    for (let i = 0; i < 4096; i++) measure(`font-${i}`);
    expect(host.rasterize).toHaveBeenCalledTimes(4096);
    expect(measure('replacement')).toBe(10);
    expect(measure('replacement')).toBe(10);
    expect(host.rasterize).toHaveBeenCalledTimes(4097);
    measure('font-0');
    expect(host.rasterize).toHaveBeenCalledTimes(4098);
});

it('keeps retained measurements available after a host rasterization error', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    const measure = (fontFamily: string) => measureText('W', { fontSize: 20, fontFamily }).width;
    for (let i = 0; i < 4096; i++) measure(`font-${i}`);
    host.rasterize.mockImplementationOnce(() => { throw new Error('host unavailable'); });
    expect(() => measure('replacement')).toThrow('host unavailable');
    const calls = host.rasterize.mock.calls.length;
    expect(measure('font-0')).toBe(10);
    expect(host.rasterize).toHaveBeenCalledTimes(calls);
    expect(measure('replacement')).toBe(10);
    expect(host.rasterize).toHaveBeenCalledTimes(calls + 1);
});

it('wraps a long distinct-character token without repeatedly evicting and rasterizing its prefixes', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    host.rasterize.mockReturnValue({ advance: 1 });
    const value = Array.from({ length: 4100 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const metrics = measureText(value, { fontSize: 20, maxWidth: 4099 });
    expect(metrics).toEqual({ width: 4099, lineCount: 2, height: 48 });
    expect(host.rasterize.mock.calls.length).toBeLessThanOrEqual(value.length * 3);
}, 10000);

it('preserves greedy wrap metrics with whitespace, supplementary characters and signed spacing', async () => {
    const { measureText } = await import('../src/ui/text/measure-text');
    const { wrapByMeasure } = await import('../src/ui/text/layout');
    for (const value of ['', 'hello world', '   a  b   ', 'longwordwithoutspaces', '中文🙂 words', 'a\tb\nc', '🙂🙂🙂']) {
        for (const letterSpacing of [-12, -1, 0, 0.25]) {
            const measure = (text: string): number => {
                let width = 0;
                for (const ch of text) width += 10 + ch.codePointAt(0)! % 3 + letterSpacing;
                return width;
            };
            for (const maxWidth of [1, 12, 27, 100]) {
                const lines = value.split('\n').flatMap(line => wrapByMeasure(line, measure, maxWidth));
                expect(measureText(value, { fontSize: 20, letterSpacing, maxWidth })).toEqual({
                    width: Math.max(0, ...lines.map(measure)),
                    lineCount: lines.length,
                    height: lines.length * 24,
                });
            }
        }
    }
});

it('continues measuring whole Canvas strings when advances are not additive', async () => {
    const context = { font: '', measureText: (text: string) => ({ width: text === 'AV' ? 12 : text.length * 8 }) };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const { measureText } = await import('../src/ui/text/measure-text');
    expect(measureText('AV AV', { fontSize: 20, maxWidth: 12 })).toEqual({ width: 12, lineCount: 2, height: 48 });
    expect(host.rasterize).not.toHaveBeenCalled();
});
