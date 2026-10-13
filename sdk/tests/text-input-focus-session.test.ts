// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { createWebTextEditor } from '../src/platform/webTextEditor';
import { TextInputPlugin } from '../src/ui/text/text-input-plugin';
import { TextInput } from '../src/ui/text/text-input';
import { FocusManager, FocusManagerState } from '../src/ui/input/focusable';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import type { App } from '../src/app/app';

vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateTextEditor: () => createWebTextEditor(),
}));
const apps: App[] = [];
function build() {
    const app = bootMockApp().app;
    apps.push(app);
    app.addPlugin({ name: 'focus', build(app) {
        app.insertResource(FocusManager, new FocusManagerState());
        app.insertResource(UIEvents, new UIEventQueue());
    } }).addPlugin(new TextInputPlugin());
    const first = app.world.spawn(), second = app.world.spawn();
    app.world.insert(first, TextInput, { value: 'first' });
    app.world.insert(second, TextInput, { value: 'second' });
    return { app, first, second, textarea: document.querySelector<HTMLTextAreaElement>('textarea[data-estella-text-editor]')! };
}
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

it.each([false, true])('keeps the new field focused when switching, composing=%j', async composing => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    if (composing) textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    fm.focus(second);
    await app.tick(1 / 60);
    expect(fm.focusedEntity).toBe(second);
    expect(app.world.get(first, TextInput).focused).toBe(false);
    expect(app.world.get(second, TextInput).focused).toBe(true);
    textarea.value = 'new text';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(second, TextInput).value).toBe('new text');
    expect(app.world.get(first, TextInput).value).toBe('first');
});

it('rejects old surface input while a new field is awaiting activation', async () => {
    const { app, first, second, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    fm.focus(second);
    textarea.value = 'old pending input';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(second, TextInput).value).toBe('second');
});

it('accepts normal input after an interrupted composition loses and regains focus', async () => {
    const { app, first, textarea } = build();
    const fm = app.getResource(FocusManager);
    fm.focus(first);
    await app.tick(1 / 60);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    textarea.blur();
    expect(fm.focusedEntity).toBe(null);
    fm.focus(first);
    await app.tick(1 / 60);
    textarea.value = 'resumed';
    textarea.dispatchEvent(new Event('input'));
    expect(app.world.get(first, TextInput).value).toBe('resumed');
});
