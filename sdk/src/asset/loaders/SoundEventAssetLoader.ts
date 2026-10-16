// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import { parseSoundEvent, type SoundEventAsset } from '../../audio/SoundEvent';

/** Loads a validated event definition without decoding every candidate sound. */
export class SoundEventAssetLoader implements AssetLoader<SoundEventAsset> {
    readonly type = 'sound-event';
    readonly extensions = ['.esaudioevent'];

    async load(path: string, ctx: LoadContext): Promise<SoundEventAsset> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        try {
            return parseSoundEvent(JSON.parse(text));
        } catch (error) {
            throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    unload(): void {
        // Definitions hold no audio buffers; voices own their decoded clip leases.
    }
}
