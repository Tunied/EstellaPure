// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    jobs.ts
 * @brief   Work done off the main thread: a pool of workers that answer questions, and nothing else.
 *
 * @details Generating a world is computation, and computation on the main thread is a frame that is not drawn however it is sliced. A pool starts workers from
 *          the text of a script (so nothing depends on where a file is served from), sends each job to one of them and answers with a Promise. The main thread's
 *          part is only to take the answer and put it in the world.
 *
 *          A job names the worker it wants by `affinity` (a number, taken modulo the pool's size), so the jobs that share what a worker keeps (a plan that has
 *          already worked out a layer) go to the same one. A host with no Worker has no pool: `createJobPool` answers null and the caller does its work in place.
 */

/** A pool of workers. */
export interface JobPool {
    /** How many workers there are. */
    readonly size: number;
    /** How many jobs are out, and how many have been answered. */
    readonly inFlight: number;
    readonly done: number;
    /** Sends `message` to the worker `affinity` names and answers with what it sends back; rejects with its error. */
    run<T>(affinity: number, message: Record<string, unknown>, transfer?: Transferable[]): Promise<T>;
    /** Stops the workers; jobs still out are rejected. */
    dispose(): void;
}

/** How many workers to start: the cores beside the main thread's, and the render's, at most four. */
export function defaultWorkerCount(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
    return Math.max(1, Math.min(4, cores - 2));
}

/** Starts a pool from the text of a worker script, or answers null where this realm has no Worker. */
export function createJobPool(script: string, size = defaultWorkerCount()): JobPool | null {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const workers: Worker[] = [];
    const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
    let nextId = 1, inFlight = 0, done = 0, dead = false;
    const fail = (e: Error): void => {
        for (const p of pending.values()) p.reject(e);
        pending.clear();
        inFlight = 0;
    };
    try {
        for (let i = 0; i < Math.max(1, size); i++) {
            const w = new Worker(url);
            w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
                const p = pending.get(e.data.id);
                if (!p) return;
                pending.delete(e.data.id);
                inFlight--; done++;
                if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
            };
            w.onerror = (e) => { dead = true; fail(new Error(`a job worker failed: ${e.message}`)); };
            workers.push(w);
        }
    } finally {
        URL.revokeObjectURL(url);
    }
    return {
        size: workers.length,
        get inFlight() { return inFlight; },
        get done() { return done; },
        run<T>(affinity: number, message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
            if (dead) return Promise.reject(new Error('the job workers have stopped'));
            const id = nextId++;
            return new Promise<T>((resolve, reject) => {
                pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
                inFlight++;
                workers[((affinity % workers.length) + workers.length) % workers.length]!.postMessage({ ...message, id }, transfer);
            });
        },
        dispose() {
            for (const w of workers) w.terminate();
            dead = true;
            fail(new Error('the job pool was disposed'));
        },
    };
}
