// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { miniGameVisibilityBridge } from '../launchers/minigameHost.mjs';

it('forwards hide and show while removing only the specified subscription', () => {
    const target = Object.assign(new EventTarget(), { hidden: false });
    const api = miniGameVisibilityBridge(target);
    const first = vi.fn(), second = vi.fn(), shown = vi.fn();
    api.onHide(first); api.onHide(first); api.onHide(second); api.onShow(shown);
    target.hidden = true; target.dispatchEvent(new Event('visibilitychange'));
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(shown).not.toHaveBeenCalled();
    api.offHide(first);
    target.dispatchEvent(new Event('visibilitychange'));
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
    target.hidden = false; target.dispatchEvent(new Event('visibilitychange'));
    expect(shown).toHaveBeenCalledOnce();
    api.offShow(shown); api.offHide(second);
});
