// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  blobShadow.ts
 * @brief A soft dark disc on the ground under a thing: the cheapest shadow there is, and often the one a phone can afford.
 *
 * A real shadow is a map drawn from the light and read back by every pixel; a blob shadow is one disc of vertex colour lying on the ground,
 * drawn once, with no map, no light and no extra pass. It says "this stands here" and "this is this high" (the disc fades and shrinks as the
 * thing leaves the ground), which is most of what a shadow tells a player. It is NOT the light's shadow: it does not stretch with the sun, fall
 * across steps, or land on a wall.
 *
 * The component goes on the thing that casts. A disc is made for it (an entity of its own, never saved with the scene) and put on the ground
 * under it each frame. The ground is a height (`groundY`), or a function of where the thing stands ({@link setBlobShadowGround}) for a ground
 * that is not flat.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import {
    defineComponent, MeshRenderer, RuntimeOnly, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { CullMode, Material, MATERIAL_FORMAT_VERSION } from './material';
import { BlendMode } from './blend';
import { Renderer } from './renderer';
import { log } from '../util/logger';

/** The fields of the `BlobShadow` component. @experimental */
export interface BlobShadowData {
    enabled: boolean;
    /** Radius of the disc where the thing stands on the ground, in world units. */
    radius: number;
    /** How dark the disc is at its centre, 0 to 1. */
    opacity: number;
    /** How soft its edge is: 0 a hard-edged disc, 1 a disc that fades from its centre. */
    softness: number;
    /** Height of the flat ground, in world units, when no ground function is set. */
    groundY: number;
    /** How far above the ground the thing may be before its shadow is gone. 0 never fades it. */
    fadeHeight: number;
    /** How small the disc is at that height, as a share of its size on the ground: 0 keeps its size, 1 shrinks it to nothing. */
    shrink: number;
    /** How far above the ground the disc is drawn, so it does not flicker against it. */
    lift: number;
}

/**
 * Puts a soft shadow disc on the ground under the entity.
 * @experimental
 */
export const BlobShadow: ComponentDef<BlobShadowData> = defineComponent<BlobShadowData>(
    'BlobShadow',
    { enabled: true, radius: 50, opacity: 0.5, softness: 0.6, groundY: 0, fadeHeight: 200, shrink: 0.5, lift: 0.5 },
    {
        fields: {
            radius: { min: 0, step: 1, tooltip: 'Radius of the disc on the ground, in world units.' },
            opacity: { min: 0, max: 1, step: 0.01, tooltip: 'How dark the disc is at its centre.' },
            softness: { min: 0, max: 1, step: 0.01, tooltip: 'How soft its edge is (0 hard, 1 fading from the centre).' },
            groundY: { step: 1, tooltip: 'Height of the flat ground. A ground function set from code overrides it.' },
            fadeHeight: { min: 0, step: 1, tooltip: 'Height above the ground at which the shadow is gone (0 never fades it).' },
            shrink: { min: 0, max: 1, step: 0.01, tooltip: 'How small the disc gets at that height (0 keeps its size).' },
            lift: { min: 0, step: 0.1, advanced: true, tooltip: 'How far above the ground the disc is drawn.' },
        },
    },
);

/** Where the ground is under a point, for a ground that is not flat: its height there, or null where there is none (the flat `groundY` is used). @experimental */
export type BlobShadowGround = (x: number, z: number) => number | null;

interface GroundState { sample: BlobShadowGround | null }
const Ground = defineResource<GroundState>({ sample: null }, 'BlobShadowGround');

/** Sets how the ground height is found under each blob shadow; `null` goes back to each shadow's own `groundY`. @experimental */
export function setBlobShadowGround(app: App, sample: BlobShadowGround | null): void {
    if (!app.hasResource(Ground)) app.insertResource(Ground, { sample });
    else app.getResource(Ground).sample = sample;
}

const RINGS = 8;
const SEGMENTS = 28;

/**
 * A unit disc lying in the XZ plane (normal up), its vertex colour black and its alpha falling from the centre to the edge as `softness` says.
 * A resident mesh and not a MeshRenderer's inline geometry: the inline path is drawn in the XY plane only (it turns about Z and no other axis),
 * and a shadow lies on the ground.
 * @experimental
 */
export function buildBlobMesh(softness: number): MeshData {
    const soft = Math.min(Math.max(softness, 0), 1);
    // Where the fade begins: all the way in for a fully soft disc, a hair inside the rim for a hard one.
    const inner = (1 - soft) * 0.96;
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const [pos, uv, color, normal] = channels.map((c) => c.offset) as [number, number, number, number];
    const count = 1 + RINGS * SEGMENTS;
    const vertices = new Uint8Array(count * vertexStride);
    const view = new DataView(vertices.buffer);
    const put = (index: number, x: number, z: number, alpha: number): void => {
        const base = index * vertexStride;
        view.setFloat32(base + pos, x, true); view.setFloat32(base + pos + 4, 0, true); view.setFloat32(base + pos + 8, z, true);
        view.setFloat32(base + uv, x * 0.5 + 0.5, true); view.setFloat32(base + uv + 4, z * 0.5 + 0.5, true);
        view.setUint8(base + color, 0); view.setUint8(base + color + 1, 0); view.setUint8(base + color + 2, 0);
        view.setUint8(base + color + 3, Math.round(alpha * 255));
        view.setFloat32(base + normal, 0, true); view.setFloat32(base + normal + 4, 1, true); view.setFloat32(base + normal + 8, 0, true);
    };
    put(0, 0, 0, 1);
    for (let r = 1; r <= RINGS; r++) {
        const t = r / RINGS;
        const u = Math.min(Math.max((t - inner) / Math.max(1 - inner, 1e-3), 0), 1);
        // The edge is zero, the middle is one, and the way down is a smoothstep: no ring shows as a band.
        const alpha = 1 - u * u * (3 - 2 * u);
        for (let k = 0; k < SEGMENTS; k++) {
            const a = (k / SEGMENTS) * Math.PI * 2;
            put(1 + (r - 1) * SEGMENTS + k, Math.cos(a) * t, Math.sin(a) * t, alpha);
        }
    }
    const indices: number[] = [];
    // Counter-clockwise seen from above (+Y): the way a ground is lit.
    for (let k = 0; k < SEGMENTS; k++) indices.push(0, 1 + ((k + 1) % SEGMENTS), 1 + k);
    for (let r = 1; r < RINGS; r++) {
        const a = 1 + (r - 1) * SEGMENTS, b = 1 + r * SEGMENTS;
        for (let k = 0; k < SEGMENTS; k++) {
            const n = (k + 1) % SEGMENTS;
            indices.push(a + k, a + n, b + n, a + k, b + n, b + k);
        }
    }
    return { channels, vertexStride, vertexCount: count, vertices, indices: new Uint32Array(indices), aabbMin: [-1, -0.01, -1], aabbMax: [1, 0.01, 1] };
}

/** The alpha at a vertex of a blob mesh, 0 to 1. @experimental */
export function blobAlpha(mesh: MeshData, vertex: number): number {
    const colour = mesh.channels.find((c) => c.semantic === MeshChannel.Color)!;
    return mesh.vertices[vertex * mesh.vertexStride + colour.offset + 3]! / 255;
}

/** A disc's entity and the MeshRenderer it was given: an insert REPLACES a component, so each change is the whole of it, written again. */
interface Disc { entity: Entity; softness: number; shown: boolean; mesh: Partial<MeshRendererData> }

/** Installs the system that keeps each blob shadow on the ground. Called once by the mesh renderer's plugin. */
export function installBlobShadows(app: App): () => void {
    const discs = new Map<Entity, Disc>();
    // One resident mesh per softness (rounded to a tenth): a shadow's softness rarely changes, and a hundred shadows of one softness are one mesh.
    const meshes = new Map<number, number>();
    const meshFor = (softness: number): number => {
        const key = Math.round(Math.min(Math.max(softness, 0), 1) * 10);
        let mesh = meshes.get(key);
        if (mesh === undefined) {
            mesh = app.getResource(Assets).createMesh(buildBlobMesh(key / 10)) ?? 0;
            meshes.set(key, mesh);
        }
        return mesh;
    };
    let material = 0;
    let materialPending = false;

    const ensureMaterial = (): number => {
        if (material || materialPending) return material;
        materialPending = true;
        void (async () => {
            try {
                const assets = app.getResource(Assets);
                // The Matcap shader at strength 0: it asks no lamp and reads no shadow, and what it draws is black with the alpha the vertices and the
                // tint give, which is all a shadow is.
                const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:matcap');
                const shader = source.compile([]);
                // Blended over the ground, tested against what stands in front of it, and writing no depth: a thing in front hides the disc
                // behind it and the disc hides nothing.
                material = Material.createFromAsset({
                    version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:matcap', blendMode: BlendMode.Normal,
                    depthTest: true, depthWrite: false, cull: CullMode.None, properties: { u_matcapStrength: 0 },
                }, shader);
            } catch (error) {
                log.warn('render', 'blob shadow material failed', error);
            } finally {
                materialPending = false;
            }
        })();
        return material;
    };

    const drop = (owner: Entity): void => {
        const disc = discs.get(owner);
        if (!disc) return;
        discs.delete(owner);
        if (app.world.valid(disc.entity)) app.world.despawn(disc.entity);
    };
    const offDespawn = app.world.onDespawn((entity: Entity) => drop(entity));

    const hide = (disc: Disc | undefined): void => {
        if (!disc?.shown) return;
        app.world.insert(disc.entity, MeshRenderer, { ...disc.mesh, enabled: false });
        disc.shown = false;
    };

    const system = defineSystem([], () => {
        const world = app.world;
        const owners = world.getEntitiesWithComponents([BlobShadow, Transform]);
        for (const owner of [...discs.keys()]) {
            if (!world.valid(owner) || !world.has(owner, BlobShadow)) drop(owner);
        }
        if (owners.length === 0) return;
        const mat = ensureMaterial();
        if (!mat) return;
        // The owners' world poses are resolved when the frame draws; read here they would be the previous frame's, and a shadow a frame behind
        // its owner is visibly loose. Resolving them is a pass over the transforms the render system makes again, which costs next to nothing.
        const cpp = world.getCppRegistry();
        if (cpp) Renderer.updateTransforms({ _cpp: cpp });
        const sample = app.hasResource(Ground) ? app.getResource(Ground).sample : null;

        for (const owner of owners) {
            const data = world.get(owner, BlobShadow) as BlobShadowData;
            let disc = discs.get(owner);
            if (!data.enabled || data.radius <= 0 || data.opacity <= 0) { hide(disc); continue; }
            const at = (world.get(owner, Transform) as TransformData).worldPosition;
            const ground = sample?.(at.x, at.z) ?? data.groundY;
            const height = Math.max(at.y - ground, 0);
            const fade = data.fadeHeight > 0 ? Math.min(Math.max(1 - height / data.fadeHeight, 0), 1) : 1;
            if (fade <= 0) { hide(disc); continue; }
            if (!disc) {
                const entity = world.spawn('BlobShadow');
                world.insert(entity, RuntimeOnly);
                world.insert(entity, Transform, {});
                const mesh: Partial<MeshRendererData> = {
                    mesh: meshFor(data.softness), material: mat, lit: false, opaque: false, castShadows: false, enabled: true,
                };
                world.insert(entity, MeshRenderer, mesh);
                disc = { entity, softness: data.softness, shown: true, mesh };
                discs.set(owner, disc);
            } else if (disc.softness !== data.softness) {
                disc.mesh = { ...disc.mesh, mesh: meshFor(data.softness) };
                disc.softness = data.softness;
            }
            const radius = data.radius * (1 - data.shrink * (1 - fade));
            world.insert(disc.entity, Transform, {
                position: { x: at.x, y: ground + data.lift, z: at.z },
                scale: { x: radius, y: 1, z: radius },
            });
            world.insert(disc.entity, MeshRenderer, { ...disc.mesh, enabled: true, color: { r: 1, g: 1, b: 1, a: data.opacity * fade } });
            disc.shown = true;
        }
    }, { name: 'BlobShadowSystem' });
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        offDespawn();
        for (const owner of [...discs.keys()]) drop(owner);
        if (app.hasResource(Assets)) {
            for (const mesh of meshes.values()) if (mesh) app.getResource(Assets).releaseBuiltMesh(mesh);
        }
        meshes.clear();
    };
}
