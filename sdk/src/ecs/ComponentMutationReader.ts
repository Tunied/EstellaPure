// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { World } from './world';
import type { CppRegistry } from '../wasm';
import { Children, Transform, isBuiltinComponent, type AnyComponentDef } from './component';
import { worldEngineApi, type EngineApi } from './bridge/engineApi';
import { withMalloc } from '../wasm/wasmScratch';
import { ENTITY_CHANGE_CAPACITY, ENTITY_CHANGE_WORDS, ENTITY_CHANGE_SUBTREE,
    ENTITY_CHANGE_RESET, ENTITY_CHANGE_REPLACED, ENTITY_CHANGE_NO_COMPONENT } from '../wasm/constants.generated';

export interface ComponentMutationBatch {
    readonly full: boolean;
    readonly reset: boolean;
    readonly entities: Set<Entity>;
    readonly changed: Map<AnyComponentDef, Set<Entity>>;
    readonly nativeSequence: number;
    readonly resetEpoch: number;
    readonly writeSequence: number;
    readonly topologySequence: number;
}

/** Projects SDK and native mutation cursors onto World-owned entities. Readers
 * acknowledge only successful runs and release history while their consumer stops. */
export class ComponentMutationReader {
    private api: EngineApi | null = null;
    private registry: CppRegistry | null = null;
    private lease: number | null = null;
    private cursor = 0;
    private first = true;
    private resetEpoch: number | null = null;
    private lastRegistry: CppRegistry | null = null;
    private readonly nativeTypes = new Map<number, AnyComponentDef>();
    private readonly writes = new Map<AnyComponentDef, number>();
    private readonly topology = new Map<AnyComponentDef, number>();
    private readonly offDisconnect: () => void;
    private readonly members: Set<AnyComponentDef>;
    private readonly values: Set<AnyComponentDef>;

    constructor(private readonly world: World, components: readonly AnyComponentDef[],
                topologyOnly: readonly AnyComponentDef[], private readonly subtree: readonly AnyComponentDef[]) {
        this.values = new Set([...components, ...subtree]);
        this.members = new Set([...this.values, ...topologyOnly]);
        this.offDisconnect = world.onCoreDisconnect(() => {
            try { this.pause(); } finally { this.lastRegistry = null; this.resetEpoch = null; }
        });
    }

    private open(): boolean {
        if (this.lease !== null) return true;
        const api = worldEngineApi(this.world), registry = this.world.getCppRegistry();
        if (!registry?.componentTypeId || !api?.registry_watchEntityChanges || !api.registry_unwatchEntityChanges
            || !api.registry_entityChangeSequence || !api.registry_entityChangeResetEpoch || !api.registry_readEntityChanges
            || !api._malloc || !api._free || !api.HEAPU32) return false;
        for (const component of this.members) {
            if (!isBuiltinComponent(component)) continue;
            const id = registry.componentTypeId(component._cppName);
            if (!Number.isInteger(id) || id < 0) { this.nativeTypes.clear(); return false; }
            this.nativeTypes.set(id, component);
        }
        this.api = api; this.registry = registry;
        if (this.lastRegistry !== registry) {
            this.lastRegistry = registry;
            this.resetEpoch = api.registry_entityChangeResetEpoch(registry);
        }
        this.lease = api.registry_watchEntityChanges(registry);
        for (const component of this.values) this.writes.set(component, this.world.registerMutationCursor(component, 'write'));
        for (const component of this.members) this.topology.set(component, this.world.registerMutationCursor(component, 'topology'));
        return true;
    }

    read(): ComponentMutationBatch | null {
        if (!this.open()) return null;
        const world = this.world, api = this.api!, registry = this.registry!;
        const nativeSequence = api.registry_entityChangeSequence!(registry);
        const resetEpoch = api.registry_entityChangeResetEpoch!(registry);
        const writeSequence = world.mutationSequence('write'), topologySequence = world.mutationSequence('topology');
        const entities = new Set<Entity>(), roots = new Set<Entity>();
        const changed = new Map<AnyComponentDef, Set<Entity>>();
        const note = (component: AnyComponentDef, entity: Entity, membership: boolean) => {
            let ids = changed.get(component);
            if (!ids) { ids = new Set(); changed.set(component, ids); }
            ids.add(entity);
            if (membership || this.values.has(component)) entities.add(entity);
            if (this.subtree.includes(component)) roots.add(entity);
        };
        for (const [component, reader] of this.writes) {
            for (const entity of world.mutationsForCursor(component, 'write', reader)) note(component, entity, false);
        }
        for (const [component, reader] of this.topology) {
            for (const entity of world.mutationsForCursor(component, 'topology', reader)) note(component, entity, true);
        }
        let reset = resetEpoch < 0 || resetEpoch !== this.resetEpoch;
        let full = this.first || reset;
        if (nativeSequence !== this.cursor) {
            withMalloc({ _malloc: api._malloc!.bind(api), _free: api._free!.bind(api) },
                ENTITY_CHANGE_CAPACITY * ENTITY_CHANGE_WORDS * 4, ptr => {
                    if (!ptr) { full = true; return; }
                    const count = api.registry_readEntityChanges!(registry, this.cursor, ptr, ENTITY_CHANGE_CAPACITY);
                    if (count < 0) { full = true; return; }
                    if (!Number.isInteger(count) || count > ENTITY_CHANGE_CAPACITY) throw new Error('Invalid native mutation batch length');
                    const heap = api.HEAPU32!;
                    for (let i = 0; i < count; ++i) {
                        const at = (ptr >>> 2) + i * ENTITY_CHANGE_WORDS;
                        const entity = heap[at] as Entity, flags = heap[at + 1], type = heap[at + 2];
                        if (flags & ENTITY_CHANGE_RESET) { full = true; reset = true; continue; }
                        if (flags & ENTITY_CHANGE_SUBTREE) roots.add(entity);
                        if (type === ENTITY_CHANGE_NO_COMPONENT) entities.add(entity);
                        const component = this.nativeTypes.get(type);
                        if (!component) continue;
                        const membership = !(flags & ENTITY_CHANGE_REPLACED);
                        note(component, entity, membership);
                        world.refreshBuiltinMembership(entity, component);
                    }
                });
        }
        if (full) {
            for (const entity of world.getAllEntities()) {
                entities.add(entity);
                for (const component of this.nativeTypes.values()) world.refreshBuiltinMembership(entity, component);
            }
        } else if (roots.size) {
            const hasChildren = world.resolveHas(Children);
            const pending = [...roots], visited = new Set<Entity>();
            while (pending.length) {
                const entity = pending.pop()!;
                if (visited.has(entity) || !world.valid(entity)) continue;
                visited.add(entity); entities.add(entity);
                if (hasChildren?.(entity)) for (const child of world.get(entity, Children).entities) pending.push(child);
            }
        }
        if (roots.size) world.invalidateTransformComposition();
        // Native Transform replacement is a value write, independent of body membership.
        if (changed.has(Transform)) world.invalidateTransformComposition();
        return { full, reset, entities, changed, nativeSequence, resetEpoch, writeSequence, topologySequence };
    }

    commit(batch: ComponentMutationBatch): void {
        this.cursor = batch.nativeSequence; this.first = false;
        this.resetEpoch = batch.resetEpoch;
        for (const [component, reader] of this.writes) this.world.advanceMutationCursor(component, 'write', reader, batch.writeSequence);
        for (const [component, reader] of this.topology) this.world.advanceMutationCursor(component, 'topology', reader, batch.topologySequence);
    }

    pause(): void {
        for (const [component, reader] of this.writes) this.world.disposeMutationCursor(component, 'write', reader);
        for (const [component, reader] of this.topology) this.world.disposeMutationCursor(component, 'topology', reader);
        this.writes.clear(); this.topology.clear(); this.nativeTypes.clear();
        try {
            if (this.lease !== null) this.api!.registry_unwatchEntityChanges!(this.registry, this.lease);
        } finally {
            this.lease = null; this.registry = null; this.api = null; this.cursor = 0; this.first = true;
        }
    }

    dispose(): void {
        try { this.pause(); } finally { this.lastRegistry = null; this.offDisconnect(); }
    }
}
