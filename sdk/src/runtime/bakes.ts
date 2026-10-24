// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bakes.ts
 * @brief   Work the engine spreads over frames (a terrain worn by rain, a water zone baked, chunks built), and how far along it is.
 *
 * @details A bake that runs in one go holds the frame until it is done: the editor freezes, a game's first frame waits, and nobody
 *          can say what for. So such work is a job: a generator that yields how far along it is, stepped each frame for as long as
 *          the frame can spare. Every job running is listed with its label and progress, which the editor shows in its status bar
 *          and a game can put on a loading screen.
 */
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';

/** One piece of work in hand: what it is and how far along, 0 to 1. */
export interface BakeProgress {
    readonly label: string;
    readonly progress: number;
}

/** A job: yields its progress (0 to 1) whenever it may be paused, and returns what it made. */
export type WorkJob<T> = Generator<number, T, void>;

interface Running {
    label: string;
    progress: number;
    job: WorkJob<unknown>;
    done: (value: unknown) => void;
    fail: (error: unknown) => void;
}

/** The jobs an App is running. Read {@link Bakes.active} for what to show. */
export class Bakes {
    /** How long, in milliseconds, the jobs may take of a frame between them. */
    budgetMs = 8;
    private readonly running_ = new Set<Running>();
    private readonly marks_ = new Map<object, { label: string; progress: number }>();

    /**
     * Runs `job` over the frames to come, under `label`; the promise is what it returns. A job that is cancelled (see `cancel`)
     * never settles.
     */
    run<T>(label: string, job: WorkJob<T>): { done: Promise<T>; cancel: () => void } {
        let entry!: Running;
        const done = new Promise<T>((resolve, reject) => {
            entry = { label, progress: 0, job, done: resolve as (v: unknown) => void, fail: reject };
        });
        this.running_.add(entry);
        return { done, cancel: () => { this.running_.delete(entry); } };
    }

    /**
     * Shows work that is stepped elsewhere (chunks built a few a frame) under `label` while `progress` is below 1; `owner` names it,
     * so a later mark replaces it. Mark it 1, or `clear` it, when it is done.
     */
    mark(owner: object, label: string, progress: number): void {
        if (progress >= 1) this.marks_.delete(owner);
        else this.marks_.set(owner, { label, progress: Math.max(0, progress) });
    }

    clear(owner: object): void {
        this.marks_.delete(owner);
    }

    /** Every piece of work in hand now. Empty when the engine is idle. */
    get active(): BakeProgress[] {
        const out: BakeProgress[] = [];
        for (const r of this.running_) out.push({ label: r.label, progress: r.progress });
        for (const m of this.marks_.values()) out.push({ label: m.label, progress: m.progress });
        return out;
    }

    /** Steps the jobs for the frame's budget, oldest first; a job that finishes or throws settles its promise. */
    step(now: () => number = () => performance.now()): void {
        if (this.running_.size === 0) return;
        const end = now() + this.budgetMs;
        for (const r of [...this.running_]) {
            // Every job advances at least once a frame, so a long one cannot starve those behind it.
            do {
                let next: IteratorResult<number, unknown>;
                try {
                    next = r.job.next();
                } catch (e) {
                    this.running_.delete(r);
                    r.fail(e);
                    break;
                }
                if (next.done) {
                    this.running_.delete(r);
                    r.done(next.value);
                    break;
                }
                r.progress = Math.min(Math.max(next.value, 0), 1);
            } while (now() < end);
            if (now() >= end) break;
        }
    }
}

/** The resource; {@link bakesOf} installs it where it is missing. @experimental */
export const BakesRes = defineResource<Bakes>(new Bakes(), 'Bakes');

/** The App's jobs, installed (with the system that steps them, before Update) on first use, so a plugin that bakes needs nothing else. */
export function bakesOf(app: App): Bakes {
    if (!app.hasResource(BakesRes)) {
        const bakes = new Bakes();
        app.insertResource(BakesRes, bakes);
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => bakes.step(), { name: 'BakeSystem' }));
    }
    return app.getResource(BakesRes);
}

/** Runs a job to its end at once, for a caller with no frames to spread it over (a test, a tool). */
export function finish<T>(job: WorkJob<T>): T {
    for (;;) {
        const next = job.next();
        if (next.done) return next.value;
    }
}
