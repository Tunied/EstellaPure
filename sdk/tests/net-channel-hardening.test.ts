// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NetChannel, type NetChannelOptions, type NetTransport, type NetViolation } from '../src/net/NetChannel';
import { MemoryIdempotencyStore } from '../src/net/IdempotencyStore';

type Frame = string | ArrayBuffer;

function pair(): [NetTransport & { drop: boolean }, NetTransport & { drop: boolean }] {
    const ha = new Set<(d: Frame) => void>();
    const hb = new Set<(d: Frame) => void>();
    const make = (mine: Set<(d: Frame) => void>, theirs: Set<(d: Frame) => void>) => {
        const t = {
            drop: false,
            send: (d: Frame) => { if (!t.drop) for (const h of [...theirs]) h(d); },
            on: (_e: 'message', h: (d: Frame) => void) => { mine.add(h); return () => mine.delete(h); },
        };
        return t;
    };
    return [make(ha, hb), make(hb, ha)];
}

function link(server: NetChannelOptions = {}, client: NetChannelOptions = {}) {
    const [tc, ts] = pair();
    return { tc, ts, client: new NetChannel(tc, client), server: new NetChannel(ts, server) };
}

afterEach(() => { vi.useRealTimers(); });

describe('idempotent requests', () => {
    it('runs a keyed handler once and replays its answer to a retry', async () => {
        const { client, server } = link({ idempotency: new MemoryIdempotencyStore(), idempotencyScope: 'p1' });
        let runs = 0;
        server.handle('buy', () => ({ bought: ++runs }));
        const a = await client.request('buy', {}, { idempotencyKey: 'click-1' });
        const b = await client.request('buy', {}, { idempotencyKey: 'click-1' });
        expect(a).toEqual({ bought: 1 });
        expect(b).toEqual({ bought: 1 });
        expect(runs).toBe(1);
        const c = await client.request('buy', {}, { idempotencyKey: 'click-2' });
        expect(c).toEqual({ bought: 2 });
    });

    it('a retry that arrives while the first is still running waits for it', async () => {
        const { client, server } = link({ idempotency: new MemoryIdempotencyStore() });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        let runs = 0;
        server.handle('slow', async () => { runs++; await gate; return 'ok'; });
        const first = client.request('slow', {}, { idempotencyKey: 'k' });
        const second = client.request('slow', {}, { idempotencyKey: 'k' });
        await Promise.resolve();
        release();
        expect(await first).toBe('ok');
        expect(await second).toBe('ok');
        expect(runs).toBe(1);
    });

    it('a handler that throws frees the key, so the retry runs again', async () => {
        const { client, server } = link({ idempotency: new MemoryIdempotencyStore() });
        let runs = 0;
        server.handle('flaky', () => { if (++runs === 1) throw new Error('boom'); return 'fine'; });
        await expect(client.request('flaky', {}, { idempotencyKey: 'k' })).rejects.toThrow('boom');
        expect(await client.request('flaky', {}, { idempotencyKey: 'k' })).toBe('fine');
        expect(runs).toBe(2);
    });

    it('keys are scoped: another player or another request type does not collide', async () => {
        const store = new MemoryIdempotencyStore();
        const one = link({ idempotency: store, idempotencyScope: 'p1' });
        const two = link({ idempotency: store, idempotencyScope: 'p2' });
        let runs = 0;
        for (const s of [one.server, two.server]) {
            s.handle('a', () => ++runs);
            s.handle('b', () => ++runs);
        }
        await one.client.request('a', {}, { idempotencyKey: 'k' });
        await two.client.request('a', {}, { idempotencyKey: 'k' });
        await one.client.request('b', {}, { idempotencyKey: 'k' });
        expect(runs).toBe(3);
    });

    it('an unkeyed request still runs every time, with or without a store', async () => {
        const { client, server } = link({ idempotency: new MemoryIdempotencyStore() });
        let runs = 0;
        server.handle('n', () => ++runs);
        await client.request('n', {});
        await client.request('n', {});
        expect(runs).toBe(2);
    });

    it('the numeric timeout argument still works', async () => {
        vi.useFakeTimers();
        const [tc] = pair();
        const client = new NetChannel(tc);
        const p = client.request('never', {}, 50);
        const caught = p.catch((e: Error) => e.message);
        await vi.advanceTimersByTimeAsync(60);
        expect(await caught).toContain('timed out after 50ms');
    });
});

describe('memory idempotency store', () => {
    it('forgets an answer after its ttl', async () => {
        let t = 0;
        const store = new MemoryIdempotencyStore({ ttlMs: 100, now: () => t });
        expect((await store.begin('k')).state).toBe('new');
        store.finish('k', { d: 1 });
        t = 50;
        expect((await store.begin('k')).state).toBe('done');
        t = 150;
        expect((await store.begin('k')).state).toBe('new');
    });

    it('stays under its cap by dropping the oldest finished answers', () => {
        const store = new MemoryIdempotencyStore({ maxEntries: 3 });
        for (let i = 0; i < 10; i++) { store.begin(`k${i}`); store.finish(`k${i}`, { d: i }); }
        expect(store.size).toBeLessThanOrEqual(3);
        expect(store.begin('k9').state).toBe('done');
    });
});

describe('frame and rate limits', () => {
    it('drops an oversize frame before parsing it', () => {
        const seen: NetViolation[] = [];
        const { client, server } = link({ limits: { maxFrameBytes: 100, onViolation: (k) => seen.push(k) } });
        const got: unknown[] = [];
        server.on('say', (p) => got.push(p));
        client.send('say', 'x'.repeat(500));
        client.send('say', 'hi');
        expect(got).toEqual(['hi']);
        expect(seen).toEqual(['frame-size']);
    });

    it('refuses messages over the sustained rate, answers requests, and recovers', async () => {
        vi.useFakeTimers();
        const seen: NetViolation[] = [];
        const { client, server } = link({ limits: { messagesPerSecond: 10, burst: 3, onViolation: (k) => seen.push(k) } });
        const got: number[] = [];
        server.on<number>('tick', (n) => got.push(n));
        server.handle('echo', (x) => x);
        for (let i = 0; i < 6; i++) client.send('tick', i);
        expect(got).toEqual([0, 1, 2]);
        expect(seen.length).toBe(3);

        const refused = client.request('echo', 1).catch((e: Error) => e.message);
        await vi.advanceTimersByTimeAsync(0);
        expect(await refused).toBe('rate limited');

        await vi.advanceTimersByTimeAsync(1000);
        client.send('tick', 99);
        expect(got.at(-1)).toBe(99);
    });

    it('does not rate-limit binary frames', () => {
        const { client, server } = link({ limits: { messagesPerSecond: 1, burst: 1 } });
        let n = 0;
        server.onBinary(7, () => n++);
        for (let i = 0; i < 20; i++) client.sendBinary(7, new Uint8Array([1]));
        expect(n).toBe(20);
    });
});

describe('heartbeat', () => {
    it('stays quiet while the peer answers, and reports once when it goes silent', async () => {
        vi.useFakeTimers();
        const dead = vi.fn();
        const { tc, client, server } = link({}, { heartbeat: { intervalMs: 100, timeoutMs: 350, onDead: dead } });
        await vi.advanceTimersByTimeAsync(1000);
        expect(dead).not.toHaveBeenCalled();

        tc.drop = true;
        await vi.advanceTimersByTimeAsync(1000);
        expect(dead).toHaveBeenCalledTimes(1);
        client.dispose();
        server.dispose();
    });

    it('stops its timer on dispose', async () => {
        vi.useFakeTimers();
        const dead = vi.fn();
        const { tc, client } = link({}, { heartbeat: { intervalMs: 100, timeoutMs: 200, onDead: dead } });
        tc.drop = true;
        client.dispose();
        await vi.advanceTimersByTimeAsync(2000);
        expect(dead).not.toHaveBeenCalled();
    });
});
