// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { SoundEventSource } from './AudioComponents';
import type { SoundEventEmitter, SoundEventHandle, SoundEventPlayback } from './SoundEventPlayback';
import type { AudioAPI } from './Audio';
import { isEditor, isPlayMode } from '../ecs/env';
import { disposeAll } from '../util/disposeAll';
import { log } from '../util/logger';

const controllers = new WeakMap<World, SoundEventSourceController>();
const MAX_PENDING = 256;
interface Intent { generation: number; resolve: (handle: SoundEventHandle | null) => void }
interface Source {
    entity: Entity; event: string; seed: number; incarnation: number; awake: boolean;
    emitter: SoundEventEmitter | null; loading: boolean; epoch: number; pending: Intent[];
}

/** Play one source intent, independently of other triggers in the same frame.
 * While the definition loads, at most 256 intents per source wait in FIFO order.
 * Returns null when unavailable, cancelled, overflowing, or the definition fails;
 * otherwise the handle exposes event/global admission and clip-load results.
 * @beta */
export function triggerSoundEventSource(world: World, entity: Entity): Promise<SoundEventHandle | null> {
    return controllers.get(world)?.trigger(entity) ?? Promise.resolve(null);
}

/** Cancel this component's queued intents and voices, preserving other emitters on the entity. @beta */
export function stopSoundEventSource(world: World, entity: Entity): void {
    controllers.get(world)?.stop(entity);
}

/** @internal Per-world component adapter; playback, selection and budgets remain in SoundEvents. */
export class SoundEventSourceController {
    private readonly sources = new Map<Entity, Source>();
    private readonly offStop: () => void;
    private disposed = false;

    constructor(private readonly world: World, private readonly playback: SoundEventPlayback, private readonly audio: AudioAPI) {
        controllers.get(world)?.dispose();
        world.enableIncarnationTracking(SoundEventSource);
        controllers.set(world, this);
        this.offStop = audio.onPlaybackStop(generation => {
            for (const source of this.sources.values()) this.cancelPending(source, generation);
        });
    }

    trigger(entity: Entity): Promise<SoundEventHandle | null> {
        const source = this.source(entity);
        if (!source) return Promise.resolve(null);
        source.awake = true;
        if (source.emitter && !source.emitter.disposed) return Promise.resolve(source.emitter.trigger());
        if (source.pending.length >= MAX_PENDING) return Promise.resolve(null);
        const result = new Promise<SoundEventHandle | null>(resolve => source.pending.push({ generation: this.audio.playbackGeneration, resolve }));
        this.prepare(source);
        return result;
    }

    update(): void {
        if (this.disposed) return;
        for (const source of this.sources.values()) if (!this.current(source)) this.remove(source.entity);
        for (const entity of this.world.getEntitiesWithComponents([SoundEventSource])) {
            const data = this.world.get(entity, SoundEventSource);
            if (!data.playOnAwake) continue;
            const source = this.source(entity);
            if (source && !source.awake) { source.awake = true; void this.trigger(entity); }
        }
    }

    stop(entity: Entity): void {
        const source = this.source(entity);
        if (!source) return;
        source.awake = true;
        this.cancelPending(source);
        source.epoch++; source.loading = false;
        const emitter = source.emitter; source.emitter = null;
        emitter?.dispose();
    }

    remove(entity: Entity): void {
        const source = this.sources.get(entity);
        if (!source) return;
        this.sources.delete(entity);
        this.cancelPending(source);
        source.epoch++;
        const emitter = source.emitter; source.emitter = null;
        emitter?.dispose();
    }

    reset(): void {
        if (this.sources.size) disposeAll([...this.sources.keys()], entity => this.remove(entity));
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (controllers.get(this.world) === this) controllers.delete(this.world);
        this.offStop(); this.reset();
    }

    private enabled(entity: Entity): boolean {
        return !this.disposed && (!isEditor() || isPlayMode()) && this.world.isEntityActive(entity)
            && this.world.has(entity, SoundEventSource) && this.world.get(entity, SoundEventSource).enabled;
    }

    private current(source: Source): boolean {
        if (this.sources.get(source.entity) !== source || !this.enabled(source.entity)) return false;
        const data = this.world.get(source.entity, SoundEventSource);
        return data.event === source.event && data.seed === source.seed
            && this.world.getComponentIncarnation(source.entity, SoundEventSource) === source.incarnation;
    }

    private source(entity: Entity): Source | null {
        let source = this.sources.get(entity);
        if (source && !this.current(source)) { this.remove(entity); source = undefined; }
        if (!this.enabled(entity)) return null;
        const data = this.world.get(entity, SoundEventSource);
        if (!data.event) return null;
        if (!source) {
            source = { entity, event: data.event, seed: data.seed,
                incarnation: this.world.getComponentIncarnation(entity, SoundEventSource), awake: false,
                emitter: null, loading: false, epoch: 0, pending: [] };
            this.sources.set(entity, source);
        }
        return source;
    }

    private cancelPending(source: Source, beforeGeneration = Infinity): void {
        const pending = source.pending; source.pending = [];
        for (const intent of pending) {
            if (intent.generation < beforeGeneration) intent.resolve(null);
            else source.pending.push(intent);
        }
    }

    private prepare(source: Source): void {
        if (source.loading) return;
        source.loading = true;
        const epoch = source.epoch;
        const alive = () => epoch === source.epoch && this.current(source);
        void this.playback.load(source.event, { owner: source.entity, seed: source.seed, alive }).then(emitter => {
            if (!alive()) {
                emitter?.dispose();
                if (epoch === source.epoch && this.sources.get(source.entity) === source) this.remove(source.entity);
                return;
            }
            source.loading = false; source.emitter = emitter;
            const pending = source.pending; source.pending = [];
            try {
                for (const intent of pending) {
                    intent.resolve(intent.generation === this.audio.playbackGeneration && alive() && emitter ? emitter.trigger() : null);
                }
            } finally {
                // A throwing host callback must not leave the remaining callers unresolved.
                for (const intent of pending) intent.resolve(null);
            }
        }).catch(error => {
            if (!alive()) return;
            source.loading = false; this.cancelPending(source);
            log.warn('audio', `SoundEventSource ${source.entity}: ${source.event}`, error);
        });
    }
}
