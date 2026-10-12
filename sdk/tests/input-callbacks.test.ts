// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    input-callbacks.test.ts
 * @brief   The funnel every raw event arrives through, as one exported thing.
 *
 *          It is exported because the platform binding is not the only caller
 *          that should exist: a harness driving a running game has to deliver a
 *          click, and doing it any other way is not the same event. A synthetic
 *          DOM event carries no usable offsetX; writing `mouseX` and
 *          `mouseButtonsPressed` by hand skips the router, so UI that should
 *          have swallowed the click never sees it and gameplay behind a button
 *          reacts to presses the player never made.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';

describe('inputEventCallbacks', () => {
    let state: InputState;
    beforeEach(() => {
        state = new InputState();
        inputRouter.setUIHandler(null);
        inputRouter.setEditorHandler(null);
    });

    it('records a pointer press the way a real event does', () => {
        const cb = inputEventCallbacks(state);
        cb.onPointerDown?.(0, 120, 45);
        expect(state.mouseX).toBe(120);
        expect(state.mouseY).toBe(45);
        expect(state.isMouseButtonDown(0)).toBe(true);
        expect(state.isMouseButtonPressed(0)).toBe(true);
        cb.onPointerUp?.(0);
        expect(state.isMouseButtonDown(0)).toBe(false);
        expect(state.isMouseButtonReleased(0)).toBe(true);
    });
    it('a consumed key release clears held state without forwarding a release edge', () => {
        const cb = inputEventCallbacks(state); cb.onKeyDown('ArrowRight');
        const off = inputRouter.setEditorHandler({ onKeyUp: () => true });
        try {
            cb.onKeyUp('ArrowRight');
            expect(state.isKeyDown('ArrowRight')).toBe(false);
            expect(state.isKeyReleased('ArrowRight')).toBe(false);
            state.beginFixedStep(); expect(state.isKeyReleased('ArrowRight')).toBe(false); state.endFixedStep();
        } finally { off(); }
    });
    it('a consumed mouse release stops holding the button without a gameplay release edge', () => {
        const cb = inputEventCallbacks(state); cb.onPointerDown(0, 1, 2);
        const off = inputRouter.setUIHandler({ onPointerUp: () => true });
        try {
            cb.onPointerUp(0);
            expect(state.isMouseButtonDown(0)).toBe(false);
            expect(state.isMouseButtonReleased(0)).toBe(false);
            state.beginFixedStep(); expect(state.isMouseButtonReleased(0)).toBe(false); state.endFixedStep();
        } finally { off(); }
    });
    it.each(['onTouchEnd', 'onTouchCancel'] as const)('a consumed %s retires its live touch without an end edge', kind => {
        const cb = inputEventCallbacks(state); cb.onTouchStart?.(1, 10, 20); cb.onTouchStart?.(2, 30, 40);
        const off = inputRouter.setUIHandler({ [kind]: () => true });
        try {
            cb[kind]?.(1);
            expect(state.isTouchActive(1)).toBe(false);
            expect(state.isTouchActive(2)).toBe(true);
            expect(state.touchesEnded.has(1)).toBe(false);
        } finally { off(); }
    });
    it('does not manufacture release edges for presses owned by the editor', () => {
        const cb = inputEventCallbacks(state);
        const off = inputRouter.setEditorHandler({ onKeyDown: () => true, onPointerDown: () => true, onTouchStart: () => true });
        try { cb.onKeyDown('Space'); cb.onPointerDown(0, 0, 0); cb.onTouchStart?.(3, 0, 0); }
        finally { off(); }
        cb.onTouchMove?.(3, 10, 20);
        expect(state.isTouchActive(3)).toBe(false);
        cb.onKeyUp('Space'); cb.onPointerUp(0); cb.onTouchEnd?.(3);
        expect(state.isKeyReleased('Space')).toBe(false);
        expect(state.isMouseButtonReleased(0)).toBe(false);
        expect(state.touchesEnded.size).toBe(0);
    });

    it('tracks the cursor on a move without pressing anything', () => {
        const cb = inputEventCallbacks(state);
        cb.onPointerMove?.(7, 9);
        expect(state.getMousePosition()).toEqual({ x: 7, y: 9 });
        expect(state.isMouseButtonDown(0)).toBe(false);
    });

    it('records keys, wheel and touches through the same funnel', () => {
        const cb = inputEventCallbacks(state);
        cb.onKeyDown?.('ArrowRight');
        expect(state.isKeyDown('ArrowRight')).toBe(true);
        expect(state.isKeyPressed('ArrowRight')).toBe(true);
        cb.onKeyUp?.('ArrowRight');
        expect(state.isKeyDown('ArrowRight')).toBe(false);

        cb.onWheel?.(3, -4);
        expect(state.getScrollDelta()).toEqual({ x: 3, y: -4 });

        cb.onTouchStart?.(1, 50, 60);
        expect(state.getTouchCount()).toBe(1);
        expect(state.getTouch(1)).toMatchObject({ x: 50, y: 60 });
        cb.onTouchEnd?.(1);
        expect(state.getTouchCount()).toBe(0);
    });

    it('lets the UI router refuse a press before gameplay records it', () => {
        // The half a hand-written injector skips: a click on a button must not
        // also reach the board behind it.
        const handler = {
            onPointerDown: () => true, // consumed
            onPointerUp: () => true,
        };
        const off = inputRouter.setUIHandler(handler as never);
        try {
            const cb = inputEventCallbacks(state);
            cb.onPointerDown?.(0, 10, 10);
            // Position still tracks (a HUD cursor must not freeze) but the press
            // never became a gameplay edge.
            expect(state.mouseX).toBe(10);
            expect(state.isMouseButtonDown(0)).toBe(false);
            expect(state.isMouseButtonPressed(0)).toBe(false);
        } finally {
            off();
        }
    });
});
