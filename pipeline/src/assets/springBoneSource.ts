// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  springBoneSource.ts
 * @brief The spring-bone data a glTF states outright, as per-node facts the prefab assembly turns into components.
 *
 * Two sources, in the order they are trusted. `VRMC_springBone` (the VRM 1.0 extension) lists springs and colliders with their numbers; a node's own
 * `extras.estella` can carry the same for one chain root (`springBone`) or one collider (`springCollider`), which is how a Blender custom property gets in
 * without a name to parse. Names (`Hair_...`, `SBC_...`) are the fallback, handled by the assembly for whatever these leave unsaid.
 *
 * Sizes stay in the model's metres here; the assembly applies the import scale. A VRM spring becomes a SpringBone on its FIRST joint's node (that bone is
 * held, the ones below it are simulated), since several springs may start under one parent and a bone holds only one SpringBone.
 */
import type { ImportedSpringBone, ImportedSpringCollider } from './modelImport';

type Vec3 = [number, number, number];

interface GltfNodeLike { name?: string; children?: number[]; extras?: unknown }

export interface SpringNodeData {
    springBone?: ImportedSpringBone;
    springColliders?: ImportedSpringCollider[];
}

/** VRM stiffness is per second and ours is per 60 Hz frame; VRM drag is already a per-step share. */
const REFERENCE_RATE = 60;

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vec3 = (v: unknown, fallback: Vec3): Vec3 =>
    Array.isArray(v) && v.length >= 3 ? [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])] : fallback;
const record = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

/** The shortest rotation (x, y, z, w) that turns +Y onto `dir`. */
export function rotationFromY(dir: Vec3): [number, number, number, number] {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-9) return [0, 0, 0, 1];
    const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    // cross(Y, d) = (d.z, 0, -d.x); dot(Y, d) = d.y
    if (d[1] < -0.999999) return [1, 0, 0, 0];
    const w = 1 + d[1];
    const n = Math.hypot(d[2], w, d[0]);
    return [d[2] / n, 0, -d[0] / n, w / n];
}

function readExtras(index: number, node: GltfNodeLike, out: Map<number, SpringNodeData>): void {
    const estella = record(record(node.extras)?.estella);
    if (!estella) return;
    const spring = record(estella.springBone);
    const collider = record(estella.springCollider);
    const slot = out.get(index) ?? {};
    if (spring) {
        const g = spring.gravity;
        slot.springBone = {
            ...(typeof spring.stiffness === 'number' ? { stiffness: spring.stiffness } : {}),
            ...(typeof spring.drag === 'number' ? { drag: spring.drag } : {}),
            ...(Array.isArray(g) ? { gravity: vec3(g, [0, -9.8, 0]) } : {}),
            ...(typeof spring.radius === 'number' ? { radius: spring.radius } : {}),
            ...(typeof spring.endLength === 'number' ? { endLength: spring.endLength } : {}),
        };
    }
    if (collider) {
        const capsule = collider.shape === 'capsule' || collider.shape === 1;
        (slot.springColliders ??= []).push({
            shape: capsule ? 1 : 0, radius: num(collider.radius, 0.05),
            ...(capsule ? { height: num(collider.height, 0.1) } : {}),
            ...(Array.isArray(collider.offset) ? { offset: vec3(collider.offset, [0, 0, 0]) } : {}),
        });
    }
    out.set(index, slot);
}

/** Every node of the subtree below `root` (not counting it). */
function below(nodes: ReadonlyArray<GltfNodeLike>, root: number): Set<number> {
    const out = new Set<number>();
    const stack = [...(nodes[root]?.children ?? [])];
    while (stack.length > 0 && out.size < 4096) {
        const i = stack.pop()!;
        if (out.has(i)) continue;
        out.add(i);
        stack.push(...(nodes[i]?.children ?? []));
    }
    return out;
}

function readVrm(nodes: ReadonlyArray<GltfNodeLike>, ext: Record<string, unknown>, out: Map<number, SpringNodeData>, warnings: string[]): void {
    const colliderDefs = Array.isArray(ext.colliders) ? ext.colliders : [];
    // The id each collider will have: its host node's own list position, which is the order they are pushed in here.
    const idOf: Array<string | null> = [];
    colliderDefs.forEach((raw) => {
        const c = record(raw);
        const node = c ? c.node : undefined;
        const shape = record(c?.shape);
        const sphere = record(shape?.sphere), capsule = record(shape?.capsule);
        if (!c || typeof node !== 'number' || !nodes[node] || (!sphere && !capsule)) {
            warnings.push('a VRMC_springBone collider names no node or no shape — skipped');
            idOf.push(null);
            return;
        }
        const slot = out.get(node) ?? {};
        const list = slot.springColliders ??= [];
        if (sphere) {
            list.push({ shape: 0, radius: num(sphere.radius, 0), offset: vec3(sphere.offset, [0, 0, 0]) });
        } else if (capsule) {
            const head = vec3(capsule.offset, [0, 0, 0]), tail = vec3(capsule.tail, [0, 0, 0]);
            const axis: Vec3 = [tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]];
            list.push({
                shape: 1, radius: num(capsule.radius, 0), height: Math.hypot(axis[0], axis[1], axis[2]),
                offset: [(head[0] + tail[0]) / 2, (head[1] + tail[1]) / 2, (head[2] + tail[2]) / 2], rotation: rotationFromY(axis),
            });
        }
        out.set(node, slot);
        idOf.push(`n${node}_sbc${list.length - 1}`);
    });
    const groups = Array.isArray(ext.colliderGroups) ? ext.colliderGroups : [];
    const springs = Array.isArray(ext.springs) ? ext.springs : [];
    for (const raw of springs) {
        const spring = record(raw);
        const joints = (Array.isArray(spring?.joints) ? spring!.joints as unknown[] : []).map(record).filter((j): j is Record<string, unknown> => !!j);
        const first = joints[0];
        const rootNode = first ? first.node : undefined;
        const label = typeof spring?.name === 'string' ? spring.name : 'a spring';
        if (typeof rootNode !== 'number' || !nodes[rootNode] || joints.length < 2) {
            warnings.push(`VRMC_springBone: ${label} has fewer than two joints — skipped`);
            continue;
        }
        const slot = out.get(rootNode) ?? {};
        if (slot.springBone) {
            warnings.push(`VRMC_springBone: ${label} starts on a bone another spring already holds — skipped`);
            continue;
        }
        const mean = (read: (j: Record<string, unknown>) => number): number => joints.reduce((a, j) => a + read(j), 0) / joints.length;
        const gravity: Vec3 = [0, 0, 0];
        for (const j of joints) {
            const dir = vec3(j.gravityDir, [0, -1, 0]);
            const power = num(j.gravityPower, 0);
            for (let k = 0; k < 3; k++) gravity[k]! += (dir[k]! * power * REFERENCE_RATE) / joints.length;
        }
        const colliders: string[] = [];
        for (const g of Array.isArray(spring?.colliderGroups) ? spring!.colliderGroups as unknown[] : []) {
            const group = record(typeof g === 'number' ? groups[g] : undefined);
            for (const c of Array.isArray(group?.colliders) ? group!.colliders as unknown[] : []) {
                const id = typeof c === 'number' ? idOf[c] : null;
                if (id && !colliders.includes(id)) colliders.push(id);
            }
        }
        slot.springBone = {
            stiffness: Math.min(1, Math.max(0, mean((j) => num(j.stiffness, 1)) / REFERENCE_RATE)),
            drag: Math.min(1, Math.max(0, mean((j) => num(j.dragForce, 0.5)))),
            gravity,
            radius: mean((j) => num(j.hitRadius, 0)),
            colliders,
        };
        out.set(rootNode, slot);
        // A SpringBone simulates everything below its bone; a VRM spring names exactly which bones.
        const named = new Set(joints.map((j) => j.node as number));
        const extra = [...below(nodes, rootNode)].filter((i) => !named.has(i)).length;
        if (extra > 0) warnings.push(`VRMC_springBone: ${label} also moves ${extra} bone(s) below its first joint that it does not name`);
    }
}

/** The per-node spring-bone facts a glTF's own data gives: VRM first, then each node's `extras.estella`. */
export function readSpringBones(json: { nodes?: ReadonlyArray<GltfNodeLike>; extensions?: Record<string, unknown> }, warnings: string[]): Map<number, SpringNodeData> {
    const out = new Map<number, SpringNodeData>();
    const nodes = json.nodes ?? [];
    const vrm = record(json.extensions?.VRMC_springBone);
    if (vrm) readVrm(nodes, vrm, out, warnings);
    nodes.forEach((node, i) => readExtras(i, node, out));
    return out;
}
