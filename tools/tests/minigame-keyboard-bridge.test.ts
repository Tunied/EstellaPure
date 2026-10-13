// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { miniGameKeyboardBridge, miniGameTouchBridge, HOST_PAGE } from '../launchers/minigameHost.mjs';
import { MiniGamePlatformAdapter } from '../../sdk/src/platform/minigame/adapter';
import type { MiniGameProfile } from '../../sdk/src/platform/minigame/api';

const keyEvent = (kind: string) => {
  const event = new Event(kind);
  Object.defineProperties(event, { code: { value: 'KeyA' }, key: { value: 'a' } });
  return event;
};

it('unregisters one keyboard subscriber without dropping others or duplicating registrations', () => {
  const target = new EventTarget(), bridge = miniGameKeyboardBridge(target);
  const first = vi.fn(), second = vi.fn();
  for (const phase of ['Down', 'Up']) {
    bridge['onKey' + phase](first); bridge['onKey' + phase](first); bridge['onKey' + phase](second);
    target.dispatchEvent(keyEvent('key' + phase.toLowerCase()));
    bridge['offKey' + phase](first); target.dispatchEvent(keyEvent('key' + phase.toLowerCase()));
    expect(first).toHaveBeenCalledWith({ code: 'KeyA', key: 'a' });
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2);
    first.mockClear(); second.mockClear();
  }
  expect(HOST_PAGE('game.js')).toContain(miniGameKeyboardBridge.toString());
});

it('the real platform adapter leaves no retired keyboard callbacks after 100 binding cycles', () => {
  const target = new EventTarget();
  const global = { ...miniGameKeyboardBridge(target), ...miniGameTouchBridge(new EventTarget()) };
  const adapter = new MiniGamePlatformAdapter({ id: 'wechat', global } as unknown as MiniGameProfile);
  const retired = [];
  for (let i = 0; i < 100; i++) {
    const callbacks = { onKeyDown: vi.fn(), onKeyUp: vi.fn(), onPointerMove: vi.fn(),
      onPointerDown: vi.fn(), onPointerUp: vi.fn(), onWheel: vi.fn() };
    adapter.bindInputEvents(callbacks);
    target.dispatchEvent(keyEvent('keydown'));
    expect(callbacks.onKeyDown).toHaveBeenCalledOnce();
    adapter.unbindInputEvents(); retired.push(callbacks.onKeyDown);
  }
  target.dispatchEvent(keyEvent('keydown'));
  for (const callback of retired) expect(callback).toHaveBeenCalledOnce();
});
