// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { miniGameTouchBridge, HOST_PAGE } from '../launchers/minigameHost.mjs';
import { GOLDEN, interactFor } from '../goldenProjects.mjs';

it('drives mini-game UI with touch and web UI with its mouse path', () => {
  const ui = GOLDEN.find(project => project.id === 'ui-controls')!;
  expect(ui.targets).toContain('wechat');
  expect(interactFor(ui, 'wechat')?.pointer).toBeNull();
  expect(interactFor(ui, 'wechat')?.touches).toHaveLength(1);
  expect(interactFor(ui, 'web')?.pointer).toEqual({ x: 0.67, y: 0.585 });
  expect(interactFor(ui)).toEqual(interactFor(ui, 'web'));
});

it('forwards independent touch identities and coordinates, including end and cancellation', () => {
  const canvas = new EventTarget(), bridge = miniGameTouchBridge(canvas);
  const touch = { identifier: 0, clientX: 123, clientY: 456 };
  const other = { identifier: 7, clientX: 20, clientY: 40 };
  for (const phase of ['Start', 'Move', 'End', 'Cancel']) {
    const callback = vi.fn(); bridge['onTouch' + phase](callback);
    const event = new Event('touch' + phase.toLowerCase());
    Object.defineProperties(event, { touches: { value: [other] }, changedTouches: { value: [touch] } });
    canvas.dispatchEvent(event);
    expect(callback).toHaveBeenCalledWith({ touches: [other], changedTouches: [touch] });
    bridge['offTouch' + phase](callback); canvas.dispatchEvent(event);
    expect(callback).toHaveBeenCalledOnce();
  }
});

it('removes exactly the selected subscriber and avoids duplicate registration', () => {
  const canvas = new EventTarget(), bridge = miniGameTouchBridge(canvas);
  const first = vi.fn(), second = vi.fn();
  bridge.onTouchStart(first); bridge.onTouchStart(first); bridge.onTouchStart(second);
  canvas.dispatchEvent(new Event('touchstart'));
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  bridge.offTouchStart(first); canvas.dispatchEvent(new Event('touchstart'));
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
  expect(HOST_PAGE('game.js')).toContain(miniGameTouchBridge.toString());
});
