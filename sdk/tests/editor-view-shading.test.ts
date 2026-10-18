// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The editor view's shading is VIEW state: clay and albedo reach the engine only while the
 * editor eye is the one drawing, through the one per-view door, and only when it changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => [] as [number, string][]);
const weightCalls = vi.hoisted(() => [] as [number, number | null, number][]);
vi.mock('../src/render/renderer', () => ({
    Renderer: {
        setViewShading: (view: number, mode: string) => { calls.push([view, mode]); },
        setViewSkinWeights: (view: number, entity: number | null, joint: number) => { weightCalls.push([view, entity, joint]); },
    },
}));

import { DEFAULT_EDITOR_VIEW_SHADING, editorViewShadingMode, pushEditorViewShading, pushEditorViewWeights } from '../src/camera/EditorViewShading';
import { EDITOR_VIEW_ENTITY } from '../src/camera/uiLayoutRect';

beforeEach(() => { calls.length = 0; weightCalls.length = 0; });

describe('what reaches the engine', () => {
    it('is the authored look whenever the editor eye is not drawing', () => {
        expect(editorViewShadingMode({ mode: 'clay', weights: null }, false)).toBe('shaded');
        expect(editorViewShadingMode({ mode: 'albedo', weights: null }, true)).toBe('albedo');
        expect(DEFAULT_EDITOR_VIEW_SHADING.mode).toBe('shaded');
    });

    it('is addressed to the editor view and crosses once per change', () => {
        let last = pushEditorViewShading({ mode: 'clay', weights: null }, true, null);
        last = pushEditorViewShading({ mode: 'clay', weights: null }, true, last);
        last = pushEditorViewShading({ mode: 'clay', weights: null }, false, last);
        last = pushEditorViewShading({ mode: 'clay', weights: null }, false, last);
        expect(last).toBe('shaded');
        expect(calls).toEqual([[EDITOR_VIEW_ENTITY >>> 0, 'clay'], [EDITOR_VIEW_ENTITY >>> 0, 'shaded']]);
    });
});

describe('the skin-weight target', () => {
    const data = { mode: 'shaded' as const, weights: { entity: 41, joint: 3 } };

    it('names one entity and joint, once per change, in the editor view', () => {
        let key = pushEditorViewWeights(data, true, '');
        key = pushEditorViewWeights(data, true, key);
        key = pushEditorViewWeights({ ...data, weights: { entity: 41, joint: 4 } }, true, key);
        expect(weightCalls).toEqual([[EDITOR_VIEW_ENTITY >>> 0, 41, 3], [EDITOR_VIEW_ENTITY >>> 0, 41, 4]]);
        expect(key).toBe('41:4');
    });

    it('is cleared whenever the editor eye is not drawing, and when nothing is chosen', () => {
        let key = pushEditorViewWeights(data, true, '');
        key = pushEditorViewWeights(data, false, key);
        key = pushEditorViewWeights(data, false, key);
        expect(weightCalls.at(-1)).toEqual([EDITOR_VIEW_ENTITY >>> 0, null, 0]);
        expect(weightCalls).toHaveLength(2);
        key = pushEditorViewWeights({ mode: 'shaded', weights: null }, true, key);
        expect(key).toBe('');
        expect(weightCalls).toHaveLength(2);
    });
});
