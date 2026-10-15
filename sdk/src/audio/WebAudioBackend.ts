// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
import { AudioMixer } from './AudioMixer';
import { AudioPool, type PooledAudioNode } from './AudioPool';
import { getPlatform } from '../platform/base';
import { log } from '../util/logger';

class WebAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private buffer_: AudioBuffer;
    private source_: AudioBufferSourceNode;
    private poolNode_: PooledAudioNode;
    private pool_: AudioPool;
    private context_: AudioContext;
    private playing_ = true;
    private stopped_ = false;
    private pausedAt_ = 0;
    private startedAt_: number;
    private startOffset_: number;
    private playbackRate_: number;
    private loop_: boolean;

    constructor(
        id: number,
        source: AudioBufferSourceNode,
        buffer: AudioBuffer,
        poolNode: PooledAudioNode,
        pool: AudioPool,
        context: AudioContext,
        startOffset: number,
    ) {
        this.id = id;
        this.source_ = source;
        this.buffer_ = buffer;
        this.poolNode_ = poolNode;
        this.pool_ = pool;
        this.context_ = context;
        this.startOffset_ = startOffset;
        this.startedAt_ = context.currentTime;
        this.playbackRate_ = source.playbackRate.value;
        this.loop_ = source.loop;

        this.bindOnEnded_(source);
    }

    private bindOnEnded_(source: AudioBufferSourceNode): void {
        source.onended = () => {
            if (!this.stopped_ && this.playing_ && source === this.source_ && !this.loop_) {
                this.playing_ = false;
                this.stopped_ = true;
                this.pool_.release(this.poolNode_);
                this.onEnd?.();
            }
        };
    }

    stop(): void {
        if (this.stopped_) return;
        this.stopped_ = true;
        this.playing_ = false;
        this.source_.onended = null;
        this.pool_.release(this.poolNode_);
    }

    pause(): void {
        if (!this.playing_ || this.stopped_) return;
        this.playing_ = false;
        const elapsed = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
        this.pausedAt_ = this.startOffset_ + elapsed;
        if (this.loop_ && this.buffer_.duration > 0) {
            this.pausedAt_ = this.pausedAt_ % this.buffer_.duration;
        }
        this.source_.onended = null;
        try { this.source_.stop(); } catch (_) { /* already stopped */ }
        this.source_.disconnect();
    }

    resume(): void {
        if (this.playing_ || this.stopped_) return;

        const source = this.context_.createBufferSource();
        let startedAt: number;
        try {
            source.buffer = this.buffer_;
            source.loop = this.loop_;
            source.playbackRate.value = this.playbackRate_;
            source.connect(this.poolNode_.gain);
            this.bindOnEnded_(source);
            startedAt = this.context_.currentTime;
            source.start(0, this.pausedAt_);
        } catch (error) {
            source.onended = null;
            try { source.stop(); } catch (_) { /* not started */ }
            source.disconnect();
            throw error;
        }

        this.source_ = source;
        this.poolNode_.source = source;
        this.startOffset_ = this.pausedAt_;
        this.startedAt_ = startedAt;

        this.playing_ = true;
    }

    setVolume(volume: number): void {
        if (this.stopped_) return;
        this.poolNode_.gain.gain.value = volume;
    }

    setPan(pan: number): void {
        if (this.stopped_) return;
        this.poolNode_.panner.pan.value = pan;
    }

    setLoop(loop: boolean): void {
        this.loop_ = loop;
        this.source_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        if (this.playing_) {
            const now = this.context_.currentTime;
            const position = this.startOffset_ + (now - this.startedAt_) * this.playbackRate_;
            this.source_.playbackRate.value = rate;
            this.startOffset_ = position;
            this.startedAt_ = now;
        }
        this.playbackRate_ = rate;
    }

    get isPlaying(): boolean {
        return this.playing_;
    }

    get currentTime(): number {
        if (this.stopped_) return 0;
        if (!this.playing_) return this.pausedAt_;
        const elapsed = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
        return this.startOffset_ + elapsed;
    }

    get duration(): number {
        return this.buffer_.duration;
    }
}

/** Decoded PCM size of a WebAudio buffer: frames × channels × 4 (Float32). */
function decodedBytes(buf: AudioBuffer): number {
    return buf.length * buf.numberOfChannels * 4;
}

interface BufferRecord {
    buffer: AudioBuffer;
    url: string;
}

interface SourceRecord {
    pending: number;
    bufferId?: number;
}

export class WebAudioBackend implements PlatformAudioBackend {
    readonly name = 'WebAudio';
    readonly delivery = 'bytes' as const;

    private context_: AudioContext | null = null;
    private mixer_: AudioMixer | null = null;
    private pool_: AudioPool | null = null;
    private buffers_ = new Map<number, BufferRecord>();
    private loadingUrls_ = new Map<string, Promise<AudioBufferHandle>>();
    /** Only current cached or pending sources; identity separates invalidated loads. */
    private sources_ = new Map<string, SourceRecord>();
    private nextBufferId_ = 0;
    private nextHandleId_ = 0;
    private resumeHandler_: (() => void) | null = null;
    private explicitlySuspended_ = false;
    private deviceIntentRevision_ = 0;
    private contextGeneration_ = 0;
    private analyser_: AnalyserNode | null = null;

    get mixer(): AudioMixer | null {
        return this.mixer_;
    }

    get isReady(): boolean {
        return this.context_?.state === 'running';
    }

    async initialize(options: AudioBackendInitOptions = {}): Promise<void> {
        this.contextGeneration_++;
        this.deviceIntentRevision_++;
        this.explicitlySuspended_ = false;
        this.context_ = new AudioContext();
        this.mixer_ = new AudioMixer(this.context_, options.mixerConfig);
        this.pool_ = new AudioPool(this.context_, options.initialPoolSize);

        // Tap the master bus for spectrum analysis (a side branch — the analyser
        // is a sink, so it never alters the audio reaching the destination).
        this.analyser_ = this.context_.createAnalyser();
        this.analyser_.fftSize = 128;
        this.analyser_.smoothingTimeConstant = 0.7;
        this.mixer_.master.node.connect(this.analyser_);

        if (this.context_.state === 'suspended') {
            const resume = () => {
                if (this.explicitlySuspended_) return;
                this.resume();
                document.removeEventListener('touchstart', resume);
                document.removeEventListener('mousedown', resume);
                document.removeEventListener('keydown', resume);
                this.resumeHandler_ = null;
            };
            document.addEventListener('touchstart', resume);
            document.addEventListener('mousedown', resume);
            document.addEventListener('keydown', resume);
            this.resumeHandler_ = resume;
        }
    }

    async ensureResumed(): Promise<void> {
        if (!this.explicitlySuspended_ && this.context_?.state === 'suspended') {
            await this.requestDeviceIntent_(false);
        }
    }

    private requestDeviceIntent_(suspended: boolean): Promise<void> {
        if (this.explicitlySuspended_ !== suspended) {
            this.explicitlySuspended_ = suspended;
            this.deviceIntentRevision_++;
        }
        const revision = this.deviceIntentRevision_;
        const context = this.context_;
        if (!context || context.state === 'closed') return Promise.resolve();
        return this.applyDeviceIntent_(context, suspended, revision, this.contextGeneration_);
    }

    private async applyDeviceIntent_(context: AudioContext, suspended: boolean, revision: number, generation: number): Promise<void> {
        // Invoke synchronously to preserve the original user-gesture stack.
        await (suspended ? context.suspend() : context.resume());
        if (context !== this.context_ || generation !== this.contextGeneration_ || context.state === 'closed') return;
        // Browser transitions can settle out of order. Reapply the latest intent
        // only when a newer request superseded this operation; blocked autoplay
        // or an OS interruption must not produce an unbounded retry loop.
        if (revision !== this.deviceIntentRevision_
            && context.state !== (this.explicitlySuspended_ ? 'suspended' : 'running')) {
            await this.applyDeviceIntent_(context, this.explicitlySuspended_, this.deviceIntentRevision_, generation);
        }
    }

    private fireDeviceIntent_(suspended: boolean): void {
        const context = this.context_;
        const generation = this.contextGeneration_;
        void this.requestDeviceIntent_(suspended).catch(error => {
            if (context === this.context_ && generation === this.contextGeneration_) {
                log.warn('audio', 'Audio device transition failed', error);
            }
        });
    }

    async loadBuffer(url: string): Promise<AudioBufferHandle> {
        if (!this.context_) {
            throw new Error('AudioContext not initialized');
        }

        const cached = this.cachedBuffer_(url);
        if (cached) return cached;

        const inFlight = this.loadingUrls_.get(url);
        if (inFlight) return inFlight;

        const promise = this.loadSource_(url, () => getPlatform().readFile(url));
        this.loadingUrls_.set(url, promise);
        try {
            return await promise;
        } finally {
            if (this.loadingUrls_.get(url) === promise) this.loadingUrls_.delete(url);
        }
    }

    async loadBufferFromData(url: string, data: ArrayBuffer): Promise<AudioBufferHandle> {
        return this.loadSource_(url, async () => data);
    }

    private cachedBuffer_(url: string): AudioBufferHandle | null {
        const id = this.sources_.get(url)?.bufferId;
        if (id === undefined) return null;
        const record = this.buffers_.get(id);
        return record ? { id, duration: record.buffer.duration, bytes: decodedBytes(record.buffer) } : null;
    }

    private async loadSource_(url: string, read: () => Promise<ArrayBuffer>): Promise<AudioBufferHandle> {
        const context = this.context_;
        if (!context) {
            throw new Error('AudioContext not initialized');
        }
        const generation = this.contextGeneration_;
        const cached = this.cachedBuffer_(url);
        if (cached) return cached;
        let source = this.sources_.get(url);
        if (!source) {
            source = { pending: 0 };
            this.sources_.set(url, source);
        }
        source.pending++;
        try {
            const data = await read();
            this.assertLoadContext_(context, generation);
            return await this.decodeBuffer_(url, data, source, context, generation);
        } finally {
            source.pending--;
            if (this.sources_.get(url) === source && source.pending === 0 && source.bufferId === undefined) {
                this.sources_.delete(url);
            }
        }
    }

    private assertLoadContext_(context: AudioContext, generation: number): void {
        if (this.context_ !== context || this.contextGeneration_ !== generation) {
            throw new Error('AudioContext changed while loading audio');
        }
    }

    private async decodeBuffer_(
        url: string, data: ArrayBuffer, source: SourceRecord,
        context: AudioContext, generation: number,
    ): Promise<AudioBufferHandle> {
        if (this.sources_.get(url) === source) {
            const cached = this.cachedBuffer_(url);
            if (cached) return cached;
        }

        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await context.decodeAudioData(data);
        } catch (err) {
            this.assertLoadContext_(context, generation);
            throw new Error(`Failed to decode audio ${url}: ${(err as Error).message}`);
        }
        this.assertLoadContext_(context, generation);

        const id = ++this.nextBufferId_;
        this.buffers_.set(id, { buffer: audioBuffer, url });
        if (this.sources_.get(url) === source) source.bufferId = id;

        return { id, duration: audioBuffer.duration, bytes: decodedBytes(audioBuffer) };
    }

    invalidateSource(url: string): void {
        this.sources_.delete(url);
        this.loadingUrls_.delete(url);
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        const record = this.buffers_.get(handle.id);
        if (!record) return;
        this.buffers_.delete(handle.id);
        const source = this.sources_.get(record.url);
        if (source?.bufferId === handle.id) {
            delete source.bufferId;
            if (source.pending === 0) this.sources_.delete(record.url);
        }
    }

    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        if (!this.context_ || !this.pool_ || !this.mixer_) {
            throw new Error('Audio system not initialized');
        }

        const audioBuffer = this.buffers_.get(buffer.id)?.buffer;
        if (!audioBuffer) {
            throw new Error(`Buffer ${buffer.id} not found`);
        }

        const startOffset = config.startOffset ?? 0;
        const poolNode = this.pool_.acquire();
        let source: AudioBufferSourceNode;
        try {
            source = this.context_.createBufferSource();
            poolNode.source = source;
            source.buffer = audioBuffer;
            source.loop = config.loop ?? false;
            source.playbackRate.value = config.playbackRate ?? 1.0;
            source.connect(poolNode.gain);

            poolNode.gain.gain.value = config.volume ?? 1.0;
            poolNode.panner.pan.value = config.pan ?? 0;

            const busName = config.bus ?? 'sfx';
            const bus = this.mixer_.getBus(busName) ?? this.mixer_.sfx;
            poolNode.panner.connect(bus.input);
            source.start(0, startOffset);
        } catch (error) {
            this.pool_.release(poolNode);
            throw error;
        }

        const handleId = ++this.nextHandleId_;
        const handle = new WebAudioHandle(
            handleId, source, audioBuffer, poolNode, this.pool_, this.context_, startOffset
        );

        return handle;
    }

    getFrequencyData(out: Uint8Array): boolean {
        if (!this.analyser_) return false;
        // lib.dom narrowed getByteFrequencyData to Uint8Array<ArrayBuffer> in TS 5.7;
        // out is a plain Uint8Array (ArrayBufferLike) — safe to cast.
        this.analyser_.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
        return true;
    }

    suspend(): void {
        this.fireDeviceIntent_(true);
    }

    resume(): void {
        this.fireDeviceIntent_(false);
    }

    dispose(): void {
        this.contextGeneration_++;
        this.deviceIntentRevision_++;
        this.explicitlySuspended_ = false;
        if (this.resumeHandler_) {
            document.removeEventListener('touchstart', this.resumeHandler_);
            document.removeEventListener('mousedown', this.resumeHandler_);
            document.removeEventListener('keydown', this.resumeHandler_);
            this.resumeHandler_ = null;
        }
        this.analyser_ = null;
        this.pool_ = null;
        this.mixer_ = null;
        this.buffers_.clear();
        this.sources_.clear();
        this.loadingUrls_.clear();
        this.context_?.close();
        this.context_ = null;
    }

}
