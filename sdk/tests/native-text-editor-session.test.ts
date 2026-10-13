// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { createNativeTextEditor } from '../src/platform/native/textEditor';
import type { NativeTextEditorPush } from '../src/platform/native/bridge';

it('starts a fresh composition session when refocusing the native editor', () => {
    let push!: (event: NativeTextEditorPush) => void;
    const editor = createNativeTextEditor({
        focus: vi.fn(), blur: vi.fn(), write: vi.fn(),
        subscribe(handler) { push = handler; return () => {}; },
    });
    const listener = vi.fn();
    editor.subscribe(listener);
    const state = { value: '', selectionStart: 0, selectionEnd: 0, backward: false };
    const options = { multiline: false, maxLength: 0, password: false };
    editor.focus(state, options);
    push({ kind: 'state', value: 'preedit', selectionStart: 7, selectionEnd: 7, composing: true });
    editor.blur();
    editor.focus(state, options);
    push({ kind: 'state', value: 'next', selectionStart: 4, selectionEnd: 4, composing: true });
    expect(listener.mock.calls.filter(([event]) => event.kind === 'composition' && event.composing)).toHaveLength(2);
    editor.dispose();
});
