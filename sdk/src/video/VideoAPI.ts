// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Per-app video service — the imperative face of the video system, exposed as
// the VideoPlayer resource.
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { defineResource } from '../ecs/resource';
import { log } from '../util/logger';
import { getPlatform, isPlatformInitialized } from '../platform/base';

export type VideoHandle = VideoStreamHandle;
export type VideoPlayOptions = VideoStreamOptions;

export class VideoAPI {
    private readonly backend_: PlatformVideoBackend;
    private readonly handles_ = new Set<VideoStreamHandle>();
    private refResolver_: ((ref: string) => string) | null = null;
    private disposed_ = false;
    private hostMuted_ = false;
    private readonly muteTargets_ = new Map<VideoStreamHandle, () => void>();
    private readonly offHostMute_: () => void;
    private readonly hasHostMute_: boolean;
    baseUrl = '';

    constructor(backend: PlatformVideoBackend) {
        this.backend_ = backend;
        const subscribe = isPlatformInitialized() ? getPlatform().onAudioMute : undefined;
        this.hasHostMute_ = subscribe !== undefined;
        this.offHostMute_ = subscribe?.call(getPlatform(), muted => {
            this.hostMuted_ = muted;
            for (const apply of this.muteTargets_.values()) apply();
        }) ?? (() => {});
    }

    get backendName(): string { return this.backend_.name; }

    setRefResolver(resolver: ((ref: string) => string) | null): void {
        this.refResolver_ = resolver;
    }

    private resolveUrl_(ref: string): string {
        if (this.refResolver_) return this.refResolver_(ref);
        if (!this.baseUrl || ref.includes('://') || ref.startsWith('/') || ref.startsWith('blob:') || ref.startsWith('data:')) {
            return ref;
        }
        return `${this.baseUrl}/${ref}`;
    }

    play(source: string, options: VideoPlayOptions = {}): VideoStreamHandle {
        let userMuted = options.muted ?? false;
        const stream = this.backend_.createStream(this.resolveUrl_(source), {
            ...options,
            ...(this.hasHostMute_ ? { muted: userMuted || this.hostMuted_ } : {}),
            audioTrackUrl: options.audioTrackUrl ?? this.resolveAudioTrack_(source),
        });
        let handle = stream;
        if (this.hasHostMute_) {
            const setMuted = stream.setMuted.bind(stream);
            const methods = new Set(['play', 'pause', 'stop', 'seek', 'setVolume', 'setLoop', 'setPlaybackRate', 'pump']);
            const bindings = new Map<PropertyKey, { original: unknown; bound: unknown }>();
            const overrideMuted = (muted: boolean) => { userMuted = muted; setMuted(userMuted || this.hostMuted_); };
            handle = new Proxy(stream, {
                get(target, key) {
                    if (key === 'setMuted') return overrideMuted;
                    const value = Reflect.get(target, key, target);
                    if (typeof key === 'string' && methods.has(key) && typeof value === 'function') {
                        let entry = bindings.get(key);
                        if (!entry || entry.original !== value) { entry = { original: value, bound: value.bind(target) }; bindings.set(key, entry); }
                        return entry.bound;
                    }
                    return value;
                },
                set(target, key, value) { return Reflect.set(target, key, value, target); },
            });
            this.muteTargets_.set(handle, () => setMuted(userMuted || this.hostMuted_));
        }
        this.handles_.add(handle);
        return handle;
    }

    /**
     * Resolve the cook-demuxed audio-track sibling through the realm's ref
     * resolver: the cook registers it as `<source path>.m4a` (path refs) or
     * `<uuid>-audio` (uuid refs). A resolver miss returns the ref unchanged —
     * treated as "no cooked sibling" so backends fall back to URL derivation.
     */
    private resolveAudioTrack_(source: string): string | undefined {
        if (!this.refResolver_) return undefined;
        const siblingRef = source.startsWith('@uuid:') ? `${source}-audio` : `${source}.m4a`;
        const resolved = this.refResolver_(siblingRef);
        return resolved !== siblingRef ? resolved : undefined;
    }

    update(module: ESEngineModule | null): void {
        if (this.disposed_) return;
        for (const handle of this.handles_) {
            // One stream's decode failure (wasm abort, detached heap) must not
            // stall every other video this tick.
            try {
                handle.pump(module);
            } catch (err) {
                log.error('video', `pump failed for stream #${handle.id} — stopping it`, err);
                this.handles_.delete(handle);
                this.muteTargets_.delete(handle);
                try { handle.stop(); } catch { /* already broken */ }
                handle.onError?.(err);
            }
        }
    }

    stop(handle: VideoStreamHandle): void {
        this.muteTargets_.delete(handle);
        if (this.handles_.delete(handle)) handle.stop();
    }

    stopAll(): void {
        for (const handle of this.handles_) handle.stop();
        this.handles_.clear();
        this.muteTargets_.clear();
    }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.offHostMute_();
        this.stopAll();
        this.backend_.dispose();
    }
}

export const VideoPlayer = defineResource<VideoAPI>(null!, 'VideoPlayer');
