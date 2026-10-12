// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Parent, Children } from '../src/ecs/component';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('subtree teardown through real WASM', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    function realm() {
        const registry = new engine.Registry() as unknown as CppRegistry;
        const world = new World(); world.connectCpp(registry, engine);
        const dispose = () => {
            for (const e of [...world.getAllEntities()].reverse()) if (world.valid(e)) world.despawn(e);
            world.disconnectCpp(); (registry as unknown as { delete(): void }).delete();
        };
        return { world, registry, dispose };
    }

    it('deletes a 10,000-level root and releases every entity scope in postorder', () => {
        const { world, dispose } = realm();
        const scopes = new EntityAssetScopes(), events: Entity[] = [], released = new Set<Entity>();
        const ids: Entity[] = [];
        try {
            for (let i = 0; i < 10000; i++) {
                const e = world.spawn(); ids.push(e);
                if (i) world.setParent(e, ids[i - 1]);
                scopes.ensure(world, e).add({ key: `entity:${e}`, generation: 1, value: e,
                    release: () => { released.add(e); }, retain: () => null });
            }
            world.onDespawn(e => events.push(e));
            world.despawn(ids[0]);
            expect(world.entityCount()).toBe(0);
            expect(scopes.size).toBe(0);
            expect(released.size).toBe(10000);
            expect(events).toEqual([...ids].reverse());
        } finally { dispose(); }
    });

    it('reads a snapshot length once and releases its native vector', () => {
        const { world, registry, dispose } = realm();
        const original = registry.getChildren;
        try {
            const root = world.spawn(), a = world.spawn(), b = world.spawn();
            world.setParent(a, root); world.setParent(b, root);
            const size = vi.fn(() => 2), release = vi.fn();
            registry.getChildren = () => ({ entities: { size, get: (i: number) => [a, b][i], delete: release } }) as never;
            world.despawn(root);
            expect(size).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
            expect(world.entityCount()).toBe(0);
        } finally { registry.getChildren = original; dispose(); }
    });

    it('releases all entity receipts after an unload throws and still notifies later observers', () => {
        const { world, dispose } = realm(), scopes = new EntityAssetScopes();
        try {
            const entity = world.spawn(), released = vi.fn(), observed = vi.fn();
            const scope = scopes.ensure(world, entity);
            scope.add({ key: 'good', generation: 1, value: null, release: released, retain: () => null });
            scope.add({ key: 'bad', generation: 1, value: null, release: () => { throw new Error('bad unload'); }, retain: () => null });
            world.onDespawn(observed); world.despawn(entity);
            expect(released).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalledWith(entity);
            expect(world.entityCount()).toBe(0); expect(scopes.size).toBe(0);
            expect(scope.size).toBe(0);
        } finally { dispose(); }
    });

    it('rejects acquiring an entity scope while that entity or a queued ancestor is dying', () => {
        const { world, dispose } = realm(), scopes = new EntityAssetScopes();
        try {
            const root = world.spawn(), child = world.spawn(); world.setParent(child, root);
            const rejected: boolean[] = [];
            world.onDespawn(entity => {
                for (const candidate of [entity, root]) {
                    try { scopes.ensure(world, candidate); rejected.push(false); } catch { rejected.push(true); }
                }
            });
            world.despawn(root); expect(rejected).toEqual([true, true, true, true]);
            expect(scopes.size).toBe(0); expect(world.entityCount()).toBe(0);
            expect(() => scopes.ensure(world, root)).toThrow(/destroyed|destruction/);
        } finally { dispose(); }
    });

    it('releases a failing native snapshot and aborts teardown before notifications or link changes', () => {
        const { world, registry, dispose } = realm();
        const original = registry.getChildren;
        try {
            const root = world.spawn(), a = world.spawn(), b = world.spawn();
            world.setParent(a, root); world.setParent(b, root);
            const release = vi.fn(), events: Entity[] = [], error = new Error('child snapshot failed');
            registry.getChildren = () => ({ entities: { size: () => 2,
                get: (i: number) => { if (i) throw error; return a; }, delete: release } }) as never;
            world.onDespawn(e => events.push(e));
            expect(() => world.despawn(root)).toThrow(error);
            expect(release).toHaveBeenCalledTimes(1);
            expect(events).toEqual([]);
            expect(world.entityCount()).toBe(3);
            expect(registry.getParent(a).entity).toBe(root);
            expect(registry.getParent(b).entity).toBe(root);
            expect(registry.destructionPending!(root)).toBe(false);
            const survivor = world.spawn();
            expect(world.trySetParent(root, survivor)).toBe(true);
        } finally { registry.getChildren = original; dispose(); }
    });

    it('does not emit duplicate callbacks when a callback deletes its own entity or ancestor', () => {
        const { world, dispose } = realm();
        try {
            const root = world.spawn(), child = world.spawn(); world.setParent(child, root);
            const events: Entity[] = [];
            world.onDespawn(e => { events.push(e); if (events.length < 4) { world.despawn(e); world.despawn(root); } });
            world.despawn(root);
            expect(events).toEqual([child, root]);
            expect(world.entityCount()).toBe(0);
        } finally { dispose(); }
    });

    it('joins a queued sibling deletion requested by a child callback', () => {
        const { world, dispose } = realm();
        try {
            const root = world.spawn(), a = world.spawn(), b = world.spawn();
            world.setParent(a, root); world.setParent(b, root);
            const events: Entity[] = [];
            world.onDespawn(e => { events.push(e); if (e === a) world.despawn(b); });
            world.despawn(root);
            expect(events).toEqual([a, b, root]);
            expect(world.entityCount()).toBe(0);
        } finally { dispose(); }
    });

    it('rejects attaching a new child to an ancestor currently being torn down', () => {
        const { world, dispose } = realm();
        try {
            const root = world.spawn(), child = world.spawn(); world.setParent(child, root);
            let created: Entity | undefined, accepted: boolean | undefined;
            world.onDespawn(e => { if (e === child) { created = world.spawn(); accepted = world.trySetParent(created, root); } });
            world.despawn(root);
            expect(accepted).toBe(false);
            expect(world.valid(created!)).toBe(true);
            expect(world.has(created!, Parent)).toBe(false);
            expect(world.entityCount()).toBe(1);
        } finally { dispose(); }
    });

    it('rejects moving a dying entity into a surviving parent from its callback', () => {
        const { world, dispose } = realm();
        try {
            const root = world.spawn(), child = world.spawn(), survivor = world.spawn();
            world.setParent(child, root);
            let accepted: boolean | undefined;
            world.onDespawn(e => { if (e === child) accepted = world.trySetParent(e, survivor); });
            world.despawn(root);
            expect(accepted).toBe(false);
            expect(world.entityCount()).toBe(1);
            expect(world.has(survivor, Children)).toBe(false);
        } finally { dispose(); }
    });

    it('shares teardown ownership with raw native hierarchy calls and releases reused slots', () => {
        const { world, registry, dispose } = realm();
        try {
            const root = world.spawn(), child = world.spawn(), survivor = world.spawn();
            world.setParent(child, root);
            const accepted: unknown[] = [], pending: boolean[] = [];
            world.onDespawn(e => {
                if (e !== child) return;
                pending.push(registry.destructionPending!(root), registry.destructionPending!(child));
                accepted.push(registry.setParent(child, survivor));
                const fresh = world.spawn();
                accepted.push(registry.setParent(fresh, root));
            });
            world.despawn(root);
            expect(pending).toEqual([true, true]);
            expect(accepted).toEqual([false, false]);
            expect(registry.destructionPending!(root)).toBe(false);
            expect(registry.destructionPending!(child)).toBe(false);
            const next = world.spawn();
            expect(registry.setParent(next, survivor)).toBe(true);
            expect(registry.hasChildren(survivor)).toBe(true);
        } finally { dispose(); }
    });

    it('does not release a new native reservation when a child slot is reused during its root callback', () => {
        const { world, registry, dispose } = realm();
        let fresh: Entity | undefined;
        try {
            const root = world.spawn(), child = world.spawn(); world.setParent(child, root);
            let reserved: boolean | undefined;
            world.onDespawn(e => { if (e === root) { fresh = world.spawn(); reserved = registry.reserveDestruction!(fresh); } });
            world.despawn(root);
            expect(reserved).toBe(true);
            expect(world.valid(fresh!)).toBe(true);
            expect(registry.destructionPending!(fresh!)).toBe(true);
            expect(registry.destructionPending!(child)).toBe(false);
            registry.releaseDestruction!(fresh!);
            world.despawn(fresh!);
            expect(world.entityCount()).toBe(0);
        } finally { if (fresh !== undefined) registry.releaseDestruction!(fresh); dispose(); }
    });

    it('keeps SDK hierarchy bookkeeping unchanged while a native owner holds the entity', () => {
        const { world, registry, dispose } = realm();
        let child: Entity | undefined;
        try {
            const root = world.spawn(); child = world.spawn(); world.setParent(child, root);
            expect(registry.reserveDestruction!(child)).toBe(true);
            world.removeParent(child);
            const state = { nativeParent: registry.getParent(child).entity,
                sdkHasParent: world.has(child, Parent),
                queried: world.getEntitiesWithComponents([Parent]).includes(child),
                accepted: world.trySetParent(child, root) };
            expect(state).toEqual({ nativeParent: root, sdkHasParent: true, queried: true, accepted: false });
            registry.releaseDestruction!(child);
            world.removeParent(child);
            expect(world.has(child, Parent)).toBe(false);
            expect(registry.hasParent(child)).toBe(false);
        } finally { if (child !== undefined) registry.releaseDestruction!(child); dispose(); }
    });

    it('also protects queued descendants and hierarchy component writes', () => {
        const { world, dispose } = realm();
        try {
            const root = world.spawn(), a = world.spawn(), b = world.spawn(), survivor = world.spawn();
            world.setParent(a, root); world.setParent(b, root);
            const parents: Entity[] = [];
            world.onDespawn(e => {
                if (e !== a) return;
                world.set(b, Parent, { entity: survivor });
                parents.push(world.get(b, Parent).entity);
                world.insert(survivor, Children, { entities: [b] });
                parents.push(world.get(b, Parent).entity);
            });
            world.despawn(root);
            expect(parents).toEqual([root, root]);
            expect(world.entityCount()).toBe(1);
            expect(world.has(survivor, Children)).toBe(false);
            const next = world.spawn();
            expect(world.trySetParent(next, survivor)).toBe(true);
        } finally { dispose(); }
    });
});
