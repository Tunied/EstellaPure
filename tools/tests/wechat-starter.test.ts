// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { it, expect, vi } from 'vitest';
import { StarterState } from '../../templates/wechat-minigame/src/starterState';
function fixture(raw?: string) {
    let saved = raw;
    const services = { login: vi.fn(async () => 'short-lived-code'), exchange: vi.fn(async (_code: string) => false),
        share: vi.fn(() => true), reward: vi.fn(async () => ({ completed: true })),
        getSave: vi.fn(() => saved), setSave: vi.fn((value: string) => { saved = value; }) };
    return { services, state: new StarterState(services), external(value: string) { saved = value; } };
}
it('requires server exchange before claiming authenticated identity and never saves login codes', async () => {
    const f = fixture(); await f.state.login(); expect(f.state.message).toContain('connect your server');
    expect(f.services.exchange).toHaveBeenCalledWith('short-lived-code'); expect(f.services.setSave).not.toHaveBeenCalled();
    f.services.exchange.mockResolvedValueOnce(true); await f.state.login(); expect(f.state.message).toContain('server authenticated');
});
it('handles missing/failed login codes and releases the busy state', async () => {
    const f = fixture(); f.services.login.mockResolvedValueOnce(''); await f.state.login();
    expect(f.services.exchange).not.toHaveBeenCalled(); expect(f.state.busy).toBe(false);
    f.services.login.mockRejectedValueOnce(new Error('offline')); await f.state.login(); expect(f.state.message).toContain('failed');
});
it('does not mistake a truthy server payload for confirmed authentication', async () => {
    const f = fixture(); f.services.exchange.mockResolvedValueOnce('false' as unknown as boolean);
    await f.state.login(); expect(f.state.message).toContain('connect your server');
});
it('share requests never claim completion or grant credits', () => {
    const f = fixture(); f.state.share(); expect(f.state.message).toContain('cannot be confirmed'); expect(f.state.credits).toBe(0);
    expect(f.services.setSave).not.toHaveBeenCalled(); f.services.share.mockReturnValueOnce(false); f.state.share(); expect(f.state.message).toContain('unavailable');
});
it('grants and restores completed-video credits but does not grant cancelled or failed videos', async () => {
    const f = fixture(); f.services.reward.mockResolvedValueOnce({ completed: false }); await f.state.reward(); expect(f.state.credits).toBe(0);
    f.services.reward.mockRejectedValueOnce(new Error('no fill')); await f.state.reward(); expect(f.services.setSave).not.toHaveBeenCalled();
    await f.state.reward(); expect(f.state.credits).toBe(1); expect(f.state.message).toContain('this device');
    expect(new StarterState(f.services).credits).toBe(1);
});
it('preserves unreadable and externally changed progress', async () => {
    for (const raw of ['not-json', '{"version":1,"credits":9,"futureField":true}']) {
        const broken = fixture(raw); await broken.state.reward(); expect(broken.state.credits).toBe(1); expect(broken.services.setSave).not.toHaveBeenCalled();
    }
    const changed = fixture(); changed.external('{"version":1,"credits":9}'); await changed.state.reward();
    expect(changed.services.setSave).not.toHaveBeenCalled(); expect(changed.state.message).toContain('changed');
});
it('keeps an earned credit in session when the device cannot save', async () => {
    const f = fixture(); f.services.setSave.mockImplementationOnce(() => { throw Error('quota'); }); await f.state.reward();
    expect(f.state.credits).toBe(1); expect(f.state.message).toContain('save failed'); expect(f.state.busy).toBe(false);
});
it('does not overlap host operations or award credits while login is pending', async () => {
    const f = fixture(); let resolve!: (value: string) => void;
    f.services.login.mockReturnValueOnce(new Promise(r => { resolve = r; })); const pending = f.state.login();
    await f.state.reward(); await f.state.login(); f.state.share(); expect(f.services.reward).not.toHaveBeenCalled(); expect(f.services.share).not.toHaveBeenCalled();
    expect(f.services.login).toHaveBeenCalledOnce(); resolve('code'); await pending; expect(f.state.busy).toBe(false);
});
