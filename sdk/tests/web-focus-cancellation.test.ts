// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { webAdapter } from '../src/platform/web';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { UiPointerBook, uiPointersOf } from '../src/ui/input/pointerBook';
import type { Entity } from '../src/types';

afterEach(() => { webAdapter.unbindInputEvents(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function bind() {
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
    const input = new InputState(); webAdapter.bindInputEvents(inputEventCallbacks(input), canvas);
    return { canvas, input };
}
function touch(canvas: HTMLCanvasElement, type: string, ids: number[]) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: ids.map(identifier => ({ identifier, clientX: 5, clientY: 5 })) });
    canvas.dispatchEvent(event);
}
it('blur cancels a held mouse without a UI click or stale fixed-step edges', () => {
    const { canvas, input } = bind(), book = new UiPointerBook(), entity = 1 as Entity;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    book.step(uiPointersOf(input), () => entity, () => true);
    window.dispatchEvent(new Event('blur'));
    expect(input.isMouseButtonDown(0)).toBe(false);
    const events = book.step(uiPointersOf(input), () => entity, () => true);
    expect(events.some(e => e.kind === 'click')).toBe(false); expect(book.pressed.size).toBe(0);
    input.beginFixedStep(); expect(input.isMouseButtonPressed(0)).toBe(false); input.endFixedStep();
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(input.isMouseButtonReleased(0)).toBe(false);
});
it('blur cancels every touch and allows the next finger to become primary', () => {
    const { canvas, input } = bind(), book = new UiPointerBook();
    touch(canvas, 'touchstart', [1, 2]); book.step(uiPointersOf(input), () => 1 as Entity, () => true);
    window.dispatchEvent(new Event('blur'));
    expect(input.touches.size).toBe(0); expect(input.touchesEnded.size).toBe(0);
    expect(book.step(uiPointersOf(input), () => 1 as Entity, () => true).some(e => e.kind === 'click')).toBe(false);
    touch(canvas, 'touchstart', [3]); expect(input.isMouseButtonDown(0)).toBe(true);
});
it('a hidden page cancels held keys and buttons before another game frame', () => {
    const { canvas, input } = bind();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(input.isKeyDown('KeyD')).toBe(false); expect(input.isKeyPressed('KeyD')).toBe(false);
    expect(input.isMouseButtonDown(2)).toBe(false);
});
it('unbind cancels the old input before a new target receives its own presses', () => {
    const first = bind(); first.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const second = bind(); expect(first.input.isMouseButtonDown(0)).toBe(false);
    second.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(second.input.isMouseButtonDown(0)).toBe(true);
});
