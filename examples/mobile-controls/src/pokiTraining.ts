// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Authored training state: platform events follow actual game transitions. */
export type TrainingPhase = 'menu' | 'playing' | 'paused' | 'finished' | 'ad';
export interface TrainingAds {
    readonly available: boolean;
    showRewarded(id: string): Promise<{ completed: boolean }>;
    showInterstitial(id: string): Promise<void>;
}
export interface TrainingHooks {
    gameplayStart(): void;
    gameplayStop(): void;
    reset(): void;
    changed(): void;
}
export class TrainingSession {
    phase: TrainingPhase = 'menu';
    credits = 0;
    hits = 0;
    message = 'Press START to begin a three-hit training round.';
    private hidden = false;
    private disposed = false;
    constructor(private readonly ads: TrainingAds, private readonly hooks: TrainingHooks, private readonly adUnit = 'poki') {}

    async begin(): Promise<void> {
        if (this.disposed || this.hidden || this.phase === 'playing' || this.phase === 'ad') return;
        const previous = this.phase;
        if (previous !== 'menu' && this.ads.available) {
            this.phase = 'ad'; this.message = 'Commercial break. Training is paused.'; this.hooks.changed();
            try { await this.ads.showInterstitial(this.adUnit); }
            catch { this.message = 'No commercial available. Continue training.'; }
        }
        if (this.disposed) return;
        if (previous === 'finished') { this.hits = 0; this.hooks.reset(); }
        if (this.hidden) {
            this.phase = 'paused'; this.message = 'Game hidden. Press RESUME when you return.';
        } else {
            this.phase = 'playing'; this.message = 'Approach the monster and land three hits.';
            this.hooks.gameplayStart();
        }
        this.hooks.changed();
    }
    pause(): void {
        if (this.disposed || this.phase !== 'playing') return;
        this.phase = 'paused'; this.message = 'Paused. Press RESUME to continue.';
        this.hooks.gameplayStop(); this.hooks.changed();
    }
    hit(): void {
        if (this.disposed || this.phase !== 'playing') return;
        if (++this.hits >= 3) {
            this.phase = 'finished'; this.message = 'Training complete! Press REPLAY for a new round.';
            this.hooks.gameplayStop();
        }
        this.hooks.changed();
    }
    async reward(): Promise<void> {
        if (this.disposed || !this.ads.available || this.phase === 'ad' || this.hidden) return;
        const previous = this.phase;
        if (previous === 'playing') this.hooks.gameplayStop();
        this.phase = 'ad'; this.message = 'Rewarded break. Watch to earn one training credit.'; this.hooks.changed();
        try {
            const result = await this.ads.showRewarded(this.adUnit);
            if (this.disposed) return;
            if (result.completed) { this.credits++; this.message = 'Reward earned: +1 training credit.'; }
            else this.message = 'Video not completed. No reward granted.';
        } catch {
            if (this.disposed) return;
            this.message = 'No rewarded ad available. No reward granted.';
        }
        this.phase = previous === 'playing' && this.hidden ? 'paused' : previous;
        if (this.phase === 'playing') this.hooks.gameplayStart();
        this.hooks.changed();
    }
    visibility(hidden: boolean): void {
        if (this.disposed) return;
        this.hidden = hidden;
        if (hidden) this.pause();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.phase === 'playing') this.hooks.gameplayStop();
        this.phase = 'paused';
    }
}
