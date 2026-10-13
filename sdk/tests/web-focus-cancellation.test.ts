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
it('a cancelled quick touch does not create a click through the mouse fallback', () => {
    const { canvas, input } = bind(), book = new UiPointerBook();
    touch(canvas, 'touchstart', [1]); touch(canvas, 'touchcancel', [1]);
    expect(book.step(uiPointersOf(input), () => 1 as Entity, () => true).some(e => e.kind === 'click')).toBe(false);
    expect(input.touchesEnded.size).toBe(0);
    input.beginFixedStep(); expect(input.isMouseButtonPressed(0)).toBe(false); input.endFixedStep();
});
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
it('a new mouse press before the next frame replaces the cancelled capture', () => {
    const { canvas, input } = bind(), book = new UiPointerBook();
    const first = 1 as Entity, next = 2 as Entity;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    book.step(uiPointersOf(input), () => first, () => true);
    expect(book.pressedByPointer(-1)).toBe(first);
    window.dispatchEvent(new Event('blur'));
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const events = book.step(uiPointersOf(input), () => next, () => true);
    expect(events.some(e => e.kind === 'click')).toBe(false);
    expect(book.pressedByPointer(-1)).toBe(next);
    input.clearFrameState();
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(book.step(uiPointersOf(input), () => next, () => true)
        .filter(e => e.kind === 'click').map(e => e.entity)).toEqual([next]);
});
it('sampling a replacement touch does not leave cancellation for a later mouse press', () => {
    const { canvas, input } = bind(), book = new UiPointerBook(), entity = 1 as Entity;
    touch(canvas, 'touchstart', [1]);
    window.dispatchEvent(new Event('blur'));
    touch(canvas, 'touchstart', [2]);
    book.step(uiPointersOf(input), () => entity, () => true);
    input.clearFrameState(); touch(canvas, 'touchend', [2]);
    book.step(uiPointersOf(input), () => entity, () => true);
    input.clearFrameState();
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    book.step(uiPointersOf(input), () => entity, () => true);
    expect(book.pressedByPointer(-1)).toBe(entity);
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
