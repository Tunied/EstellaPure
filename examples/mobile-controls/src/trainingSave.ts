// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface CreditStorage { getString(key: string): string | undefined; setString(key: string, value: string): void }
const KEY = 'mobile-controls.training-credits.v1';

/** Demonstrates SDK saving while preserving unreadable or externally changed progress. */
export class TrainingSave {
    message = '';
    private snapshot: string | undefined;
    private loaded = false;
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
    save(credits: number): void {
        if (!this.loaded) return;
        try {
            if (!Number.isSafeInteger(credits) || credits < 0) throw new Error('invalid credits');
            if (this.storage.getString(KEY) !== this.snapshot) {
                this.loaded = false;
                this.message = 'Saved progress changed; reload before saving';
                return;
            }
            const raw = JSON.stringify({ version: 1, credits });
            this.storage.setString(KEY, raw); this.snapshot = raw;
            this.message = 'Saved to SDK; cloud backup pending';
        } catch { this.message = 'Save failed; progress kept in this session'; }
    }
}
