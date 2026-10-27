// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    IdempotencyStore.ts
 * @brief   Remembers what a request answered, so a retry of the same request
 *          returns that answer instead of running the handler a second time.
 *          A request that spends something (a purchase, a departure) must not
 *          run twice because a reply was lost on the way back.
 */

/** What a handler returned, as it went on the wire. */
export interface IdempotentOutcome {
    d?: unknown;
}

export type IdempotencyBegin =
    /** First sight of the key: run the handler, then call `finish` or `abandon`. */
    | { state: 'new' }
    /** Already answered: reply with this and do not run the handler. */
    | { state: 'done'; outcome: IdempotentOutcome }
    /** Another call with this key is running; resolves with its outcome. */
    | { state: 'busy'; outcome: Promise<IdempotentOutcome | null> };

/**
 * The seam a server plugs a shared store into (Redis, a database row) when
 * retries can land on a different process than the original. The store in this
 * file keeps keys in one process's memory.
 */
export interface IdempotencyStore {
    begin(key: string): IdempotencyBegin | Promise<IdempotencyBegin>;
    /** Keep the outcome for later retries. */
    finish(key: string, outcome: IdempotentOutcome): void | Promise<void>;
    /** The handler failed unexpectedly: free the key so a retry runs again. */
    abandon(key: string): void | Promise<void>;
}

export interface MemoryIdempotencyOptions {
    /** How long an answer is remembered. Default 10 minutes. */
    ttlMs?: number;
    /** The most answers kept; the oldest go first. Default 100,000. */
    maxEntries?: number;
    /** Clock, for tests. */
    now?: () => number;
}

interface Entry {
    expires: number;
    outcome: IdempotentOutcome | null;
    waiters: ((outcome: IdempotentOutcome | null) => void)[];
}

export class MemoryIdempotencyStore implements IdempotencyStore {
    private readonly entries_ = new Map<string, Entry>();
    private readonly ttl_: number;
    private readonly max_: number;
    private readonly now_: () => number;

    constructor(options: MemoryIdempotencyOptions = {}) {
        this.ttl_ = options.ttlMs ?? 10 * 60_000;
        this.max_ = options.maxEntries ?? 100_000;
        this.now_ = options.now ?? Date.now;
    }

    get size(): number {
        return this.entries_.size;
    }

    begin(key: string): IdempotencyBegin {
        const entry = this.entries_.get(key);
        if (entry && entry.outcome === null) {
            return { state: 'busy', outcome: new Promise((resolve) => entry.waiters.push(resolve)) };
        }
        if (entry && entry.expires > this.now_()) {
            return { state: 'done', outcome: entry.outcome! };
        }
        this.entries_.delete(key);
        this.evict_();
        this.entries_.set(key, { expires: Number.POSITIVE_INFINITY, outcome: null, waiters: [] });
        return { state: 'new' };
    }

    finish(key: string, outcome: IdempotentOutcome): void {
        const entry = this.entries_.get(key);
        if (!entry) return;
        entry.outcome = outcome;
        entry.expires = this.now_() + this.ttl_;
        // A re-insert moves the key to the newest end of the map's order.
        this.entries_.delete(key);
        this.entries_.set(key, entry);
        for (const wake of entry.waiters) wake(outcome);
        entry.waiters = [];
    }

    abandon(key: string): void {
        const entry = this.entries_.get(key);
        if (!entry) return;
        this.entries_.delete(key);
        for (const wake of entry.waiters) wake(null);
    }

    private evict_(): void {
        const now = this.now_();
        for (const [key, entry] of this.entries_) {
            if (this.entries_.size < this.max_ && entry.expires > now) break;
            if (entry.outcome === null) continue;
            this.entries_.delete(key);
        }
    }
}
