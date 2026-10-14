// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface CreditStorage { getString(key: string): string | undefined; setString(key: string, value: string): void; flush?(): Promise<void> }
const KEY = 'mobile-controls.training-credits.v1';

/** Demonstrates SDK saving while preserving unreadable or externally changed progress. */
export class TrainingSave {
    message = '';
    private snapshot: string | undefined;
    private loaded = false;
    private saveEpoch = 0;
    constructor(private readonly storage: CreditStorage) {}
    load(): number {
        try {
            const raw = this.storage.getString(KEY);
            const value: unknown = raw === undefined ? { version: 1, credits: 0 } : JSON.parse(raw);
            if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
                || !('credits' in value) || !Number.isSafeInteger(value.credits) || (value.credits as number) < 0) {
                throw new Error('invalid saved credits');
            }
            this.snapshot = raw; this.loaded = true;
            this.message = 'SDK save ready';
            return value.credits as number;
        } catch {
            this.loaded = false; this.message = 'Save unavailable; progress kept in this session';
            return 0;
        }
    }
    save(credits: number): boolean {
        if (!this.loaded) return false;
        try {
            if (!Number.isSafeInteger(credits) || credits < 0) throw new Error('invalid credits');
            if (this.storage.getString(KEY) !== this.snapshot) {
                this.loaded = false;
                this.message = 'Saved progress changed; reload before saving';
                return false;
            }
            const raw = JSON.stringify({ version: 1, credits });
            this.storage.setString(KEY, raw); this.snapshot = raw;
            this.message = 'Saved to SDK; cloud backup pending';
            return true;
        } catch { this.message = 'Save failed; progress kept in this session'; return false; }
    }
    async saveAsync(credits: number): Promise<void> {
        const epoch = ++this.saveEpoch;
        if (!this.save(credits) || !this.storage.flush) return;
        this.message = 'Saving progress...';
        try { await this.storage.flush(); if (epoch === this.saveEpoch) this.message = 'Save acknowledged by host'; }
        catch { if (epoch === this.saveEpoch) this.message = 'Save failed; progress kept in this session'; }
    }
}
