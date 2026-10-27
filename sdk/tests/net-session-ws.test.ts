// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The session layer over real sockets: a `ws` server hands each
 *        connection to a SessionHost, and a ClientSession rides the platform
 *        GameSocket on the global WebSocket. Loopback TCP in between.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { GameSocket } from '../src/net/GameSocket';
import { ClientSession } from '../src/net/session/ClientSession';
import { SessionHost, SessionRejected } from '../src/net/session/SessionHost';
import { acceptWebSocket } from '../src/net/session/acceptWebSocket';
import { defineContract } from '../src/net/session/contract';
import { s } from '../src/net/session/schema';

const contract = defineContract({
    requests: {
        buy: { req: s.object({ item: s.enum(['water', 'food']), qty: s.int({ min: 1, max: 5 }) }), res: s.object({ credits: s.int() }) },
    },
    events: { radio: s.object({ text: s.string() }) },
});

describe('session over real WebSockets', () => {
    let wss: WebSocketServer;
    let url: string;
    const wallet = new Map<string, number>();
    let runs = 0;
    const host = new SessionHost({
        authenticate: (c) => {
            const t = (c as { token?: string; contract?: string }) ?? {};
            if (t.contract !== contract.fingerprint) throw new SessionRejected('update the game');
            if (!t.token) throw new SessionRejected('no token');
            return { playerId: t.token };
        },
    });
    contract.serve(host, {
        buy: ({ qty }, ctx) => {
            runs++;
            const left = (wallet.get(ctx.playerId) ?? 100) - qty * 10;
            wallet.set(ctx.playerId, left);
            return { credits: left };
        },
    });

    beforeAll(async () => {
        wss = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 1 << 20 });
        wss.on('connection', (socket) => acceptWebSocket(host, socket));
        await new Promise<void>((r) => wss.on('listening', () => r()));
        url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    });
    afterAll(async () => {
        host.close();
        await new Promise<void>((r) => wss.close(() => r()));
    });

    const opened: ClientSession[] = [];
    afterEach(() => { for (const c of opened.splice(0)) c.close(); });
    const session = (token: string, fingerprint = contract.fingerprint) => {
        const c = new ClientSession({
            connect: () => new GameSocket({ url }),
            credentials: () => ({ token, contract: fingerprint }),
            backoff: { initialMs: 10, maxMs: 50, jitter: 0 },
            retryDelayMs: 10,
        });
        opened.push(c);
        return c;
    };

    it('serves a typed request end to end', async () => {
        const c = session('p-typed');
        await c.start();
        const api = contract.client(c);
        expect(await api.buy({ item: 'water', qty: 2 })).toEqual({ credits: 80 });
        await expect(api.buy({ item: 'water', qty: 0 })).rejects.toThrow('qty');
    });

    it('the server refuses a request the contract does not allow', async () => {
        const c = session('p-bad');
        await c.start();
        await expect(c.request('buy', { item: 'gold', qty: 1 })).rejects.toThrow('invalid buy request');
        expect(wallet.has('p-bad')).toBe(false);
    });

    it('turns away a client built against another contract', async () => {
        const c = session('p-old', 'deadbeef');
        await expect(c.start()).rejects.toThrow('update the game');
    });

    it('survives the server dropping every socket: redials, keeps subscriptions, never double-spends', async () => {
        const c = session('p-drop');
        const heard: string[] = [];
        contract.on(c, 'radio', (m) => heard.push(m.text));
        await c.start();
        const api = contract.client(c);
        await api.buy({ item: 'food', qty: 1 });

        const states: string[] = [];
        c.onState((st) => states.push(st));
        for (const sock of wss.clients) sock.terminate();
        // The redial is fast enough to pass through 'reconnecting' between two polls, so record it.
        await vi.waitFor(() => expect(states).toEqual(['reconnecting', 'ready']), { timeout: 2000 });

        const before = runs;
        const after = await api.buy({ item: 'food', qty: 1 }, { idempotencyKey: 'one-click' });
        expect(after.credits).toBe(80);
        // The same intent sent again lands on the new connection and is answered from memory.
        const again = await api.buy({ item: 'food', qty: 1 }, { idempotencyKey: 'one-click' });
        expect(again).toEqual(after);
        expect(runs).toBe(before + 1);

        contract.broadcast(host, 'radio', { text: 'back on air' });
        await vi.waitFor(() => expect(heard).toEqual(['back on air']));
    });

    it('a new connection for the same player closes the old one for good', async () => {
        const a = session('p-twin');
        await a.start();
        const b = session('p-twin');
        await b.start();
        await vi.waitFor(() => expect(a.state).toBe('closed'), { timeout: 2000 });
        expect(b.state).toBe('ready');
    });
});
