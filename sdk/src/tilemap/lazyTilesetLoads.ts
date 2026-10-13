// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetsData } from '../asset/AssetPlugin';
import type { AssetLease } from '../asset/AssetLease';
import { RuntimeConfig } from '../defaults';
import { disposeAll } from '../util/disposeAll';
import { log } from '../util/logger';

interface Attempt { retryAt: number; lease?: AssetLease; }

/** @internal Owns lazy tileset acquisitions until no live layer references them. */
export class LazyTilesetLoads {
    private attempts_ = new Map<string, Attempt>();

    get size(): number { return this.attempts_.size; }

    request(assets: AssetsData, ref: string, key: string): void {
        const previous = this.attempts_.get(key);
        if (previous && (previous.lease || Date.now() < previous.retryAt)) return;
        const attempt: Attempt = { retryAt: Infinity };
        this.attempts_.set(key, attempt);
        void assets.acquireTyped('tileset', ref).then(lease => {
            if (this.attempts_.get(key) !== attempt) lease.release();
            else attempt.lease = lease;
        }, error => {
            if (this.attempts_.get(key) !== attempt) return;
            attempt.retryAt = Date.now() + Math.max(1000, RuntimeConfig.assetFailureCooldown);
            log.warn('tilemap', `failed to load tileset asset '${ref}'`, error);
        });
    }

    prune(active: ReadonlySet<string>): void {
        const retired: Attempt[] = [];
        for (const [key, attempt] of this.attempts_) {
            if (active.has(key)) continue;
            this.attempts_.delete(key);
            retired.push(attempt);
        }
        disposeAll(retired, attempt => attempt.lease?.release());
    }

    reset(): void {
        const retired = [...this.attempts_.values()];
        this.attempts_.clear();
        disposeAll(retired, attempt => attempt.lease?.release());
    }
}
