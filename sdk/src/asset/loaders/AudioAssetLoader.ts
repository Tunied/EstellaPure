// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext, AudioResult } from '../AssetLoader';
import type { AudioAPI } from '../../audio/Audio';
import { log } from '../../util/logger';

export class AudioAssetLoader implements AssetLoader<AudioResult> {
    private readonly releases_ = new WeakMap<AudioResult, () => void>();
    readonly type = 'audio';
    readonly extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];

    /** Same lazy audio accessor Assets uses — needed by unload/invalidate,
     *  which have no LoadContext. Defaults to "no audio" for bare setups. */
    constructor(private readonly getAudio_: () => AudioAPI | null = () => null) {}

    async load(path: string, ctx: LoadContext): Promise<AudioResult> {
        const audio = ctx.getAudio();
        if (!audio) {
            log.warn('asset', `AudioAssetLoader: no Audio resource for "${path}" (AudioPlugin not installed?)`);
            return { bufferId: path };
        }
        // Warm-cache hit: the buffer survived its last release as an evictable
        // entry — pin it and skip the whole fetch + decode.
        if (audio.retainBuffer(path)) {
            return this.ownedResult_(audio, path);
        }
        // A `url` backend (a mini-game player) streams the file itself: fetching
        // it here reads the whole clip into memory to drop it, and its source
        // comes from the ref resolver rather than from this loader.
        if (audio.delivery === 'url') {
            await audio.preload(path);
        } else {
            const buildPath = ctx.catalog.getBuildPath(path);
            await audio.preloadFromData(path, await ctx.loadBinary(buildPath));
        }
        audio.retainBuffer(path);
        return this.ownedResult_(audio, path);
    }

    private ownedResult_(audio: AudioAPI, path: string): AudioResult {
        const result = { bufferId: path };
        const buffer = audio.getBufferHandle(path);
        if (buffer) this.releases_.set(result, () => {
            if (audio.getBufferHandle(path) === buffer) audio.releaseBuffer(path);
        });
        return result;
    }

    unload(asset: AudioResult): void {
        const release = this.releases_.get(asset);
        this.releases_.delete(asset);
        release?.();
    }

    invalidate(path: string): boolean {
        return this.getAudio_()?.invalidateBuffer(path) ?? false;
    }
}
