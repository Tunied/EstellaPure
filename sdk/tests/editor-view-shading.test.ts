// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The editor view's shading is VIEW state: clay and albedo reach the engine only while the
 * editor eye is the one drawing, through the one per-view door, and only when it changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => [] as [number, string][]);
vi.mock('../src/render/renderer', () => ({
    Renderer: { setViewShading: (view: number, mode: string) => { calls.push([view, mode]); } },
}));

import { DEFAULT_EDITOR_VIEW_SHADING, editorViewShadingMode, pushEditorViewShading } from '../src/camera/EditorViewShading';
import { EDITOR_VIEW_ENTITY } from '../src/camera/uiLayoutRect';

beforeEach(() => { calls.length = 0; });

describe('what reaches the engine', () => {
    it('is the authored look whenever the editor eye is not drawing', () => {
        expect(editorViewShadingMode({ mode: 'clay' }, false)).toBe('shaded');
        expect(editorViewShadingMode({ mode: 'albedo' }, true)).toBe('albedo');
        expect(DEFAULT_EDITOR_VIEW_SHADING.mode).toBe('shaded');
    });

    it('is addressed to the editor view and crosses once per change', () => {
        let last = pushEditorViewShading({ mode: 'clay' }, true, null);
        last = pushEditorViewShading({ mode: 'clay' }, true, last);
        last = pushEditorViewShading({ mode: 'clay' }, false, last);
        last = pushEditorViewShading({ mode: 'clay' }, false, last);
        expect(last).toBe('shaded');
        expect(calls).toEqual([[EDITOR_VIEW_ENTITY >>> 0, 'clay'], [EDITOR_VIEW_ENTITY >>> 0, 'shaded']]);
    });
});
