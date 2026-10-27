// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NetChannel.ts
 * @brief   A typed message + request/response layer over a raw socket. The raw
 *          GameSocket / WeChatSocket only move string|ArrayBuffer frames; this
 *          is the single channel that gives them typed events (`on`/`send`) and
 *          RPC (`handle`/`request`) with a small JSON envelope. Transport-
 *          agnostic — anything that can `send` and surface `message` events works.
 */
import type { IdempotencyStore } from './IdempotencyStore';

/** The minimal socket surface NetChannel drives (GameSocket / WeChatSocket fit). */
export interface NetTransport {
    send(data: string | ArrayBuffer): void;
    /** Subscribe to incoming frames. Returns an unsubscribe function. */
    on(event: 'message', handler: (data: string | ArrayBuffer) => void): () => void;
}

/**
 * A transport that delivers every frame, once, in send order. {@link NetChannel}
 * needs no such promise; replication does — its client applies the inbox in
 * ARRIVAL order because that IS the authority's order. Declaring the marker is
 * a claim about the link, not a feature to switch on.
 */
export interface ReliableOrderedTransport extends NetTransport {
    readonly delivery: 'reliable-ordered';
}

export type MessageHandler<T = unknown> = (payload: T) => void;
export type RequestHandler<Req = unknown, Res = unknown> = (payload: Req) => Res | Promise<Res>;
export type BinaryHandler = (payload: Uint8Array) => void;

/** What the peer answers when it refuses a message for coming too fast. */
export const NET_RATE_LIMITED = 'rate limited';
/** What the peer answers a retry whose first attempt threw: the key is free, send it again. */
export const NET_ATTEMPT_FAILED = 'the first attempt failed, retry';

/**
 * Why a request did not return a value.
 *
 * - `timeout`: no answer in time; the peer may or may not have run it.
 * - `closed`: the channel went away with the request in flight; same doubt.
 * - `rate-limited` / `retry`: the peer ran nothing and says to send it again.
 * - `remote`: the peer's handler threw, or has none; its message is in `message`.
 */
export type NetRequestErrorCode = 'timeout' | 'closed' | 'rate-limited' | 'retry' | 'remote';

export class NetRequestError extends Error {
    constructor(message: string, readonly code: NetRequestErrorCode) {
        super(message);
        this.name = 'NetRequestError';
    }

    /** True when sending the same request again, with the same key, is safe. */
    get retryable(): boolean {
        return this.code !== 'remote';
    }
}

/** Why a channel dropped or refused something the peer sent. */
export type NetViolation = 'frame-size' | 'rate';

export interface NetHeartbeatOptions {
    /** How often to ping the peer. */
    intervalMs: number;
    /** Silence longer than this (no frame of any kind) means the peer is gone. */
    timeoutMs: number;
    /** Called once, when the peer has been silent for `timeoutMs`. */
    onDead: () => void;
}

export interface NetLimitOptions {
    /** Larger frames are dropped before they are parsed. Binary frames count too. */
    maxFrameBytes?: number;
    /** Sustained control messages (events and requests) per second. Binary frames are not limited. */
    messagesPerSecond?: number;
    /** Messages allowed at once before the sustained rate applies. Default: one second's worth. */
    burst?: number;
    /** Called for every dropped frame or refused message. */
    onViolation?: (kind: NetViolation) => void;
}

export interface NetChannelOptions {
    /** Default RPC timeout in ms (0 disables). Default 10000. */
    requestTimeoutMs?: number;
    /**
     * Answer a retried request from memory. Only requests that carry a key
     * (`idempotencyKey` on the sender) are looked up; the rest run as before.
     */
    idempotency?: IdempotencyStore;
    /** Prefixes every key so two players cannot collide on one. Usually the player id. */
    idempotencyScope?: string;
    /** Ping the peer and report when it goes silent. */
    heartbeat?: NetHeartbeatOptions;
    limits?: NetLimitOptions;
}

export interface RequestOptions {
    /** RPC timeout in ms (0 disables). */
    timeoutMs?: number;
    /**
     * Names this intent. A retry with the same key gets the first attempt's
     * answer instead of running the handler again. One key per intent (one
     * click), not per attempt.
     */
    idempotencyKey?: string;
}

interface WireEvent { k: 'event'; t: string; d: unknown; }
interface WireReq { k: 'req'; t: string; id: number; d: unknown; ik?: string; }
interface WireRes { k: 'res'; id: number; d?: unknown; e?: string; }
interface WirePing { k: 'ping'; n: number; }
interface WirePong { k: 'pong'; n: number; }
type Wire = WireEvent | WireReq | WireRes | WirePing | WirePong;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Typed messaging over a {@link NetTransport}. Subscribes to the transport's
 * `message` events (it is the message router). Events are fire-and-forget;
 * requests await a matching response by id (or reject on timeout / remote
 * error).
 *
 * Two planes share the one transport: string frames carry the JSON control
 * envelope; binary frames carry a 1-byte channel id + payload for high-rate
 * data (replication snapshots claim channel 1). A binary frame with no
 * registered channel handler is dropped.
 */
export class NetChannel {
    private readonly transport: NetTransport;
    private readonly handlers = new Map<string, Set<MessageHandler>>();
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private readonly binaryHandlers = new Map<number, BinaryHandler>();
    private readonly pending = new Map<number, Pending>();
    private readonly defaultTimeout: number;
    private readonly offMessage_: () => void;
    private readonly idempotency_: IdempotencyStore | undefined;
    private scope_: string;
    private readonly limits_: NetLimitOptions;
    private readonly bucketCapacity_: number;
    private heartbeatTimer_: ReturnType<typeof setInterval> | null = null;
    private bucket_: number;
    private bucketAt_ = Date.now();
    private lastHeard_ = Date.now();
    private nextId = 1;
    private nextPing_ = 1;

    constructor(transport: NetTransport, opts: NetChannelOptions = {}) {
        this.transport = transport;
        this.defaultTimeout = opts.requestTimeoutMs ?? 10000;
        this.idempotency_ = opts.idempotency;
        this.scope_ = opts.idempotencyScope ?? '';
        this.limits_ = opts.limits ?? {};
        const rate = this.limits_.messagesPerSecond ?? 0;
        this.bucketCapacity_ = rate > 0 ? Math.max(1, this.limits_.burst ?? rate) : 0;
        this.bucket_ = this.bucketCapacity_;
        this.offMessage_ = transport.on('message', (data) => this.handleIncoming_(data));
        if (opts.heartbeat) this.startHeartbeat_(opts.heartbeat);
    }

    /** Subscribe to a typed event. Returns an unsubscribe function. */
    on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
        let set = this.handlers.get(type);
        if (!set) { set = new Set(); this.handlers.set(type, set); }
        set.add(handler as MessageHandler);
        return () => {
            const s = this.handlers.get(type);
            if (s) { s.delete(handler as MessageHandler); if (s.size === 0) this.handlers.delete(type); }
        };
    }

    /** Fire-and-forget a typed event to the peer. */
    send<T = unknown>(type: string, payload: T): void {
        this.send_({ k: 'event', t: type, d: payload });
    }

    /** Register the single handler that answers `request(type, …)` from the peer.
     *  Returns an unregister function. */
    handle<Req = unknown, Res = unknown>(type: string, handler: RequestHandler<Req, Res>): () => void {
        this.requestHandlers.set(type, handler as RequestHandler);
        return () => {
            if (this.requestHandlers.get(type) === (handler as RequestHandler)) {
                this.requestHandlers.delete(type);
            }
        };
    }

    /**
     * Send a request and await the peer's response (rejects on timeout / remote
     * error). A number is the timeout in ms; an options object adds an
     * idempotency key.
     */
    request<Res = unknown, Req = unknown>(type: string, payload: Req, options?: number | RequestOptions): Promise<Res> {
        const id = this.nextId++;
        const opts: RequestOptions = typeof options === 'number' ? { timeoutMs: options } : options ?? {};
        const limit = opts.timeoutMs ?? this.defaultTimeout;
        return new Promise<Res>((resolve, reject) => {
            const timer = limit > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new NetRequestError(`net request "${type}" timed out after ${limit}ms`, 'timeout'));
                }, limit)
                : null;
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            const wire: WireReq = { k: 'req', t: type, id, d: payload };
            if (opts.idempotencyKey !== undefined) wire.ik = opts.idempotencyKey;
            this.send_(wire);
        });
    }

    /** Register the single handler for a binary channel id (0-255). Returns an
     *  unregister function. */
    onBinary(channel: number, handler: BinaryHandler): () => void {
        this.binaryHandlers.set(channel, handler);
        return () => {
            if (this.binaryHandlers.get(channel) === handler) {
                this.binaryHandlers.delete(channel);
            }
        };
    }

    /** Fire-and-forget a binary payload on a channel id (0-255). */
    sendBinary(channel: number, payload: Uint8Array): void {
        const frame = new Uint8Array(1 + payload.byteLength);
        frame[0] = channel;
        frame.set(payload, 1);
        this.transport.send(frame.buffer);
    }

    /**
     * Scope later idempotency keys to this owner. A server knows the player only
     * after the hello, so the scope is set once the connection has authenticated.
     */
    setIdempotencyScope(scope: string): void {
        this.scope_ = scope;
    }

    /** Reject all in-flight requests and drop handlers (call on disconnect). */
    dispose(reason = 'net channel closed'): void {
        this.offMessage_();
        if (this.heartbeatTimer_) { clearInterval(this.heartbeatTimer_); this.heartbeatTimer_ = null; }
        for (const [, p] of this.pending) {
            if (p.timer) clearTimeout(p.timer);
            p.reject(new NetRequestError(reason, 'closed'));
        }
        this.pending.clear();
        this.handlers.clear();
        this.requestHandlers.clear();
        this.binaryHandlers.clear();
    }

    // -- internals ------------------------------------------------------------

    private send_(wire: Wire): void {
        this.transport.send(JSON.stringify(wire));
    }

    private startHeartbeat_(beat: NetHeartbeatOptions): void {
        const timer = setInterval(() => {
            if (Date.now() - this.lastHeard_ > beat.timeoutMs) {
                clearInterval(timer);
                this.heartbeatTimer_ = null;
                beat.onDead();
                return;
            }
            this.send_({ k: 'ping', n: this.nextPing_++ });
        }, beat.intervalMs);
        // A heartbeat must not keep a server process alive by itself.
        (timer as { unref?: () => void }).unref?.();
        this.heartbeatTimer_ = timer;
    }

    /** Spend one message from the bucket; false when the peer is over its rate. */
    private admit_(): boolean {
        if (this.bucketCapacity_ === 0) return true;
        const now = Date.now();
        const refill = ((now - this.bucketAt_) / 1000) * (this.limits_.messagesPerSecond ?? 0);
        this.bucketAt_ = now;
        this.bucket_ = Math.min(this.bucketCapacity_, this.bucket_ + refill);
        if (this.bucket_ < 1) return false;
        this.bucket_ -= 1;
        return true;
    }

    private handleIncoming_(data: string | ArrayBuffer): void {
        this.lastHeard_ = Date.now();
        const max = this.limits_.maxFrameBytes;
        if (max !== undefined) {
            // A string's length counts UTF-16 units, not bytes; the bound only has
            // to keep a hostile frame from being parsed, not measure it exactly.
            const size = typeof data === 'string' ? data.length : data.byteLength;
            if (size > max) { this.limits_.onViolation?.('frame-size'); return; }
        }
        if (typeof data !== 'string') {
            const view = new Uint8Array(data);
            if (view.byteLength === 0) return;
            this.binaryHandlers.get(view[0])?.(view.subarray(1));
            return;
        }
        let msg: Wire;
        try { msg = JSON.parse(data) as Wire; } catch { return; }
        if (!msg || typeof (msg as { k?: unknown }).k !== 'string') return;
        switch (msg.k) {
            case 'ping': this.send_({ k: 'pong', n: msg.n }); break;
            case 'pong': break;
            case 'event':
                if (!this.admit_()) { this.limits_.onViolation?.('rate'); break; }
                this.dispatchEvent_(msg.t, msg.d);
                break;
            case 'req':
                if (!this.admit_()) {
                    this.limits_.onViolation?.('rate');
                    this.send_({ k: 'res', id: msg.id, e: NET_RATE_LIMITED });
                    break;
                }
                this.handleRequest_(msg);
                break;
            case 'res': this.resolvePending_(msg); break;
        }
    }

    private dispatchEvent_(type: string, payload: unknown): void {
        const set = this.handlers.get(type);
        if (!set) return;
        for (const h of [...set]) h(payload);
    }

    private handleRequest_(msg: WireReq): void {
        const handler = this.requestHandlers.get(msg.t);
        if (!handler) {
            this.send_({ k: 'res', id: msg.id, e: `no request handler for "${msg.t}"` });
            return;
        }
        const store = this.idempotency_;
        if (store && typeof msg.ik === 'string') {
            void this.handleIdempotent_(store, `${this.scope_}\u0000${msg.t}\u0000${msg.ik}`, handler, msg);
            return;
        }
        Promise.resolve()
            .then(() => handler(msg.d))
            .then(
                (result) => this.send_({ k: 'res', id: msg.id, d: result }),
                (err) => this.send_({ k: 'res', id: msg.id, e: errorText(err) }),
            );
    }

    /**
     * Run a keyed request at most once to completion. A handler that returns has
     * its answer kept, so a retry replays it; one that throws frees the key and
     * the retry runs again — a business refusal belongs in the return value.
     */
    private async handleIdempotent_(store: IdempotencyStore, key: string, handler: RequestHandler, msg: WireReq): Promise<void> {
        try {
            const begin = await store.begin(key);
            if (begin.state === 'done') {
                this.send_({ k: 'res', id: msg.id, d: begin.outcome.d });
                return;
            }
            if (begin.state === 'busy') {
                const outcome = await begin.outcome;
                if (outcome) this.send_({ k: 'res', id: msg.id, d: outcome.d });
                else this.send_({ k: 'res', id: msg.id, e: NET_ATTEMPT_FAILED });
                return;
            }
            let result: unknown;
            try {
                result = await handler(msg.d);
            } catch (err) {
                await store.abandon(key);
                this.send_({ k: 'res', id: msg.id, e: errorText(err) });
                return;
            }
            await store.finish(key, { d: result });
            this.send_({ k: 'res', id: msg.id, d: result });
        } catch (err) {
            this.send_({ k: 'res', id: msg.id, e: errorText(err) });
        }
    }

    private resolvePending_(msg: WireRes): void {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (p.timer) clearTimeout(p.timer);
        if (msg.e !== undefined) p.reject(new NetRequestError(msg.e, remoteCode(msg.e)));
        else p.resolve(msg.d);
    }
}

function remoteCode(message: string): NetRequestErrorCode {
    if (message === NET_RATE_LIMITED) return 'rate-limited';
    if (message === NET_ATTEMPT_FAILED) return 'retry';
    return 'remote';
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
