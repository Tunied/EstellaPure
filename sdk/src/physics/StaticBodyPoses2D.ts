// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';
import { quatToAngleZ } from './PhysicsTypes';
import { batchStaticPoses2D } from './batchStaticPoses2D';

interface StaticPose { x: number; y: number; angle: number; parent: Entity | null }

/** Static poses follow sparse authored writes and their immediate parent's world
 * frame. Dynamic writeback may invalidate composition without editing either. */
export class StaticBodyPoses2D {
    private poses = new Map<Entity, StaticPose>();
    private groups = new Map<Entity, Set<Entity>>();
    private parents = new Map<Entity, number[]>();
    private reader: number | null = null;
    private epoch = -1;
    private tick = -1;
    private ppu = -1;
    private legacyStale = false;

    constructor(private readonly world: World) {}

    set(entity: Entity, pose: StaticPose): void {
        if (this.poses.get(entity)?.parent !== pose.parent) this.delete(entity);
        this.poses.set(entity, pose);
        if (pose.parent !== null) {
            let group = this.groups.get(pose.parent);
            if (!group) { group = new Set(); this.groups.set(pose.parent, group); }
            group.add(entity);
        }
    }

    track(entity: Entity, parent: Entity | null): void {
        const previous = this.poses.get(entity);
        if (previous?.parent === parent) return;
        this.set(entity, previous ? { ...previous, parent } : { x: NaN, y: NaN, angle: NaN, parent });
    }

    delete(entity: Entity): void {
        const parent = this.poses.get(entity)?.parent;
        if (parent != null) {
            const group = this.groups.get(parent);
            group?.delete(entity);
            if (!group?.size) { this.groups.delete(parent); this.parents.delete(parent); }
        }
        this.poses.delete(entity);
    }

    /** A stopped simulation owes a full pose refresh, but retains no write history. */
    pause(): void {
        if (this.reader !== null) this.world.disposeWriteReader(Transform, this.reader);
        this.reader = null;
        this.epoch = -1;
    }

    sync(module: PhysicsWasmModule, ppu: number, reconcile: boolean, enabled: (entity: Entity) => boolean): void {
        const world = this.world;
        if (!this.poses.size) { this.pause(); return; }
        const first = this.reader === null;
        if (first) this.reader = world.registerWriteReaderFrom(Transform, world.getWorldTick());
        const epoch = world.transformEpoch();
        if (first || reconcile || epoch < 0 || epoch !== this.epoch || ppu !== this.ppu) {
            world.ensureTransformsComposed();
            const all = first || reconcile || epoch < 0 || ppu !== this.ppu;
            const changedParents = new Set<Entity>();
            for (const parent of this.groups.keys()) {
                let changed = true;
                if (world.has(parent, Transform)) {
                    const tf = world.get(parent, Transform) as TransformData;
                    const p = tf.worldPosition, r = tf.worldRotation, s = tf.worldScale;
                    const values = [p.x, p.y, p.z, r.x, r.y, r.z, r.w, s.x, s.y, s.z];
                    const old = this.parents.get(parent);
                    changed = !old || values.some((value, index) => value !== old[index]);
                    this.parents.set(parent, values);
                } else this.parents.delete(parent);
                if (!all && changed) changedParents.add(parent);
            }
            const selected: Entity[] = [];
            if (all) for (const entity of this.poses.keys()) selected.push(entity);
            else {
                for (const parent of changedParents) for (const entity of this.groups.get(parent)!) selected.push(entity);
                const written = new Set(world.getWrittenEntitiesSince(Transform, this.tick));
                for (const entity of written) {
                    const pose = this.poses.get(entity);
                    if (pose && (pose.parent === null || !changedParents.has(pose.parent))) selected.push(entity);
                }
            }
            if (batchStaticPoses2D(world, module, selected, ppu, enabled)) this.legacyStale = true;
            else {
                if (this.legacyStale) {
                    for (const pose of this.poses.values()) pose.x = NaN;
                    this.legacyStale = false;
                }
                const invPpu = 1 / ppu;
                const sync = (entity: Entity) => {
                    if (!enabled(entity) || !world.isEntityActive(entity)) return;
                    const pose = this.poses.get(entity)!;
                    const tf = world.get(entity, Transform) as TransformData;
                    const position = pose.parent !== null ? tf.worldPosition : tf.position;
                    const rotation = pose.parent !== null ? tf.worldRotation : tf.rotation;
                    const x = position.x * invPpu, y = position.y * invPpu, angle = quatToAngleZ(rotation);
                    if (pose.x !== x || pose.y !== y || pose.angle !== angle) {
                        module._physics_setBodyTransform(entity, x, y, angle);
                        pose.x = x; pose.y = y; pose.angle = angle;
                    }
                };
                for (const entity of selected) sync(entity);
            }
        }
        this.epoch = world.transformEpoch();
        this.tick = world.getWorldTick() - 1;
        this.ppu = ppu;
        world.advanceWriteReader(Transform, this.reader!, this.tick);
    }

    dispose(): void {
        this.pause(); this.poses.clear(); this.groups.clear(); this.parents.clear();
    }
}
