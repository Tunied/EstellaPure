// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { InputMap, Button, Key, MouseButton, GpAxis, Virtual, Keys1D } from '../src/input/inputMap';

describe('button alternatives and short taps', () => {
    it.each(['key', 'mouse'] as const)('observes a release and repress of a held %s between samples', kind => {
        const input = new InputState(), map = new InputMap({ Fire: Button(kind === 'key' ? Key('Space') : MouseButton(0)) });
        const down = () => kind === 'key' ? input.noteKeyDown('Space') : input.noteMouseDown(0);
        const up = () => kind === 'key' ? input.noteKeyUp('Space') : input.noteMouseUp(0);
        down(); map.evaluate(input); input.clearFrameState();
        up(); down(); map.evaluate(input);
        expect([map.pressed('Fire'), map.released('Fire'), map.down('Fire')]).toEqual([true, true, true]);
        map.evaluate(input);
        expect([map.pressed('Fire'), map.released('Fire')]).toEqual([false, false]);
        input.clearFrameState(); up(); down(); up(); map.evaluate(input);
        expect([map.pressed('Fire'), map.released('Fire'), map.down('Fire')]).toEqual([true, true, false]);
    });
    it.each([true, false])('distinguishes overlapping alias handoff from a gap (overlap=%s)', overlap => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space'), MouseButton(0)) });
        input.noteKeyDown('Space'); map.evaluate(input); input.clearFrameState();
        if (overlap) { input.noteMouseDown(0); input.noteKeyUp('Space'); }
        else { input.noteKeyUp('Space'); input.noteMouseDown(0); }
        map.evaluate(input);
        expect([map.pressed('Fire'), map.released('Fire'), map.down('Fire')]).toEqual([!overlap, !overlap, true]);
    });
    it('ignores key repeat and preserves signed composite transitions', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Keys1D('KeyA', 'KeyD')) });
        input.noteKeyDown('KeyD'); map.evaluate(input); input.clearFrameState();
        input.noteKeyDown('KeyD'); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
        input.noteKeyDown('KeyA'); input.noteKeyUp('KeyA'); map.evaluate(input);
        expect([map.pressed('Fire'), map.released('Fire'), map.down('Fire')]).toEqual([true, true, true]);
    });
    it('does not add two subthreshold alternatives into a press', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Virtual('one'), Virtual('two')) });
        input.setVirtual('one', .3); input.setVirtual('two', .3); map.evaluate(input);
        expect(map.value('Fire')).toBe(.3);
        expect(map.down('Fire')).toBe(false);
        expect(map.pressed('Fire')).toBe(false);
    });
    it('does not let a negative axis cancel a keyboard alternative', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space'), GpAxis(0)) });
        input.updateGamepads([{ index: 0, connected: true, buttons: [], axes: [-1], mapping: 'standard' }]);
        input.noteKeyDown('Space'); map.evaluate(input);
        expect(map.value('Fire')).toBe(1);
        expect(map.pressed('Fire')).toBe(true);
    });
    it.each(['key', 'mouse'] as const)('retains a complete %s tap once per map without leaving the button down', kind => {
        const input = new InputState(), binding = kind === 'key' ? Key('Space') : MouseButton(0);
        const maps = [new InputMap({ Fire: Button(binding) }), new InputMap({ Fire: Button(binding) })];
        for (const map of maps) map.evaluate(input);
        const tap = () => {
            if (kind === 'key') { input.noteKeyDown('Space'); input.noteKeyUp('Space'); }
            else { input.noteMouseDown(0); input.noteMouseUp(0); }
        };
        tap();
        for (const map of maps) {
            map.evaluate(input);
            expect(map.pressed('Fire')).toBe(true);
            expect(map.released('Fire')).toBe(true);
            expect(map.down('Fire')).toBe(false);
            expect(map.value('Fire')).toBe(0);
            map.evaluate(input);
            expect(map.pressed('Fire')).toBe(false);
            expect(map.released('Fire')).toBe(false);
        }
        tap();
        maps[0].evaluate(input);
        expect(maps[0].pressed('Fire')).toBe(true);
        input.clearFrameState(); maps[0].evaluate(input);
        expect(maps[0].pressed('Fire')).toBe(false);
    });
    it('does not retrigger a held alias or replay its completed tap after release', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space'), MouseButton(0)) });
        input.noteKeyDown('Space'); map.evaluate(input); input.clearFrameState();
        input.noteMouseDown(0); input.noteMouseUp(0); map.evaluate(input);
        expect(map.down('Fire')).toBe(true);
        expect(map.pressed('Fire')).toBe(false);
        input.noteKeyUp('Space'); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
        expect(map.released('Fire')).toBe(true);
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
    });
    it('does not replay an old action when an unrelated tap arrives before frame clear', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space')), Jump: Button(Key('KeyJ')) });
        input.noteKeyDown('Space'); input.noteKeyUp('Space'); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(true);
        input.noteKeyDown('KeyJ'); input.noteKeyUp('KeyJ'); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
        expect(map.pressed('Jump')).toBe(true);
    });
    it('drops pending short taps on host cancellation', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space'), MouseButton(0)) });
        input.noteKeyDown('Space'); input.noteKeyUp('Space');
        input.noteMouseDown(0); input.noteMouseUp(0);
        inputEventCallbacks(input).onInputCancel!(); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
        expect(map.released('Fire')).toBe(false);
    });
    it('does not turn a claimed key release into a gameplay tap', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(Key('Space')) });
        input.noteKeyDown('Space');
        const off = inputRouter.setEditorHandler({ onKeyUp: () => true });
        try { inputEventCallbacks(input).onKeyUp('Space'); } finally { off(); }
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
    });
    it('does not turn a claimed mouse release into a gameplay tap', () => {
        const input = new InputState(), map = new InputMap({ Fire: Button(MouseButton(0)) });
        input.noteMouseDown(0);
        const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
        try { inputEventCallbacks(input).onPointerUp(0); } finally { off(); }
        map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
    });
    it('drops expired pulses for a map that starts after the frame ends', () => {
        const input = new InputState();
        input.noteKeyDown('Space'); input.noteKeyUp('Space'); input.clearFrameState();
        const map = new InputMap({ Fire: Button(Key('Space')) }); map.evaluate(input);
        expect(map.pressed('Fire')).toBe(false);
    });
    it('accepts new taps after cancellation and when switching input streams', () => {
        const map = new InputMap({ Fire: Button(Key('Space')) });
        const first = new InputState(), second = new InputState();
        for (let i = 0; i < 10; i++) { first.noteKeyDown('Space'); first.noteKeyUp('Space'); }
        map.evaluate(first); expect(map.pressed('Fire')).toBe(true);
        inputEventCallbacks(first).onInputCancel!(); map.evaluate(first);
        expect(map.pressed('Fire')).toBe(false);
        first.noteKeyDown('Space'); first.noteKeyUp('Space'); map.evaluate(first);
        expect(map.pressed('Fire')).toBe(true);
        second.noteKeyDown('Space'); second.noteKeyUp('Space'); map.evaluate(second);
        expect(map.pressed('Fire')).toBe(true);
    });
});
