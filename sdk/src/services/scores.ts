// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getPlatform, isPlatformInitialized } from '../platform/base';

/** Optional host score submission, independent of friends/open-data boards. */
export const Scores = {
    get available(): boolean {
        return isPlatformInitialized() && getPlatform().submitScore !== undefined;
    },
    /** A resolved submission means sent; host validation may still reject the score. */
    async submit(score: number): Promise<void> {
        if (!Number.isFinite(score)) throw new Error('Score must be finite');
        const platform = getPlatform();
        if (!platform.submitScore) throw new Error('Score submission unavailable on this host');
        await platform.submitScore(score);
    },
};
