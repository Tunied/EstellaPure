// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import type { GlyphAtlas } from '../src/ui/text/glyph-atlas';
import { measurePrefixWidths, measureWidth } from '../src/ui/text/layout';
import { maskedPrefix, nearestCaretIndex } from '../src/ui/text/text-input-view';

function makeAtlas() {
    const getGlyph = vi.fn((cp: number) => cp === 0xffff ? null : { advance: cp % 13 + 3 });
    const atlas = { pixelSizeFor: () => 48, getGlyph } as unknown as GlyphAtlas;
    return { atlas, getGlyph };
}

it.each(['', 'Variable widths', '中文输入', 'a😀中🚀b', '\ud83da\ude00', 'a\uffffb', 'e\u0301\t x'])
('matches every independently measured UTF-16 prefix: %j', text => {
    const { atlas } = makeAtlas();
    const actual = measurePrefixWidths(text, atlas, 'test', 24, 1, 0.5);
    const expected = Array.from({ length: text.length + 1 }, (_, i) =>
        measureWidth(text.slice(0, i), atlas, 'test', 24, 1, 0.5));
    expect(actual).toEqual(expected);
    for (let x = -5; x <= expected.at(-1)! + 5; x += 0.25) {
        expect(nearestCaretIndex(actual, x)).toBe(nearestCaretIndex(expected, x));
    }
});

it('preserves password widths at every textarea index including emoji', () => {
    const { atlas } = makeAtlas(), value = '密😀码';
    const actual = measurePrefixWidths('●'.repeat(value.length), atlas, 'test', 24, 0);
    expect(actual).toEqual(Array.from({ length: value.length + 1 }, (_, i) =>
        measureWidth(maskedPrefix(value, i, true, '●'), atlas, 'test', 24, 0)));
});

it.each(['a', '😀'])('bounds glyph reads by UTF-16 length for long %j text', glyph => {
    const { atlas, getGlyph } = makeAtlas(), text = glyph.repeat(4000);
    const widths = measurePrefixWidths(text, atlas, 'test', 24, 0);
    expect(getGlyph).toHaveBeenCalledTimes(text.length);
    expect(widths).toHaveLength(text.length + 1);
    expect(widths.at(-1)).toBe(measureWidth(text, atlas, 'test', 24, 0));
});
