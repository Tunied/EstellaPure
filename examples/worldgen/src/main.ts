// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The rules the scene's WorldGen names, as a game's would be; mining and building are changes the world keeps.
import { addPlugin, defineSystem, GetWorld, Res, Query, Mut, Input, Time, Transform, Camera, Text, Name, BakesRes,
    spawnUIEntity, UIPositionType, px, type Entity } from 'esengine';
import { registerWorldRules, WorldGenRes, type WorldRules } from 'esengine/worldgen';

const PINE = 'assets/models/pine.esmesh', ROCK = 'assets/models/rock.esmesh';
/** A pine far off: a tent of cards showing the tree's part of its colour strip. */
const PINE_FAR = { u0: 0.2, v0: 0.22, u1: 0.8, v1: 0.95, tent: true };

/**
 * Three biomes by the fields (moisture, rock, how steep), each with its recipes: groves of pines with saplings round a tall one in
 * the forest, a scatter of single pines on the meadow's edge, rock groups where the stone comes up, and copper to mine near rock.
 */
const rules: WorldRules = {
    id: 'worldgen-demo:wilds',
    versions: [1],
    biomes: [
        { id: 'forest', conditions: [{ field: 'moisture', min: 0.52, blend: 0.08 }, { field: 'up', min: 0.82, blend: 0.05 }],
            transition: 120, paint: [0.55, 0.45, 0, 0], paintStrength: 0.5,
            recipes: [{ recipe: 'grove', layer: 'groups', density: 0.75 }, { recipe: 'lone pine', layer: 'detail', density: 0.25 }] },
        { id: 'meadow', conditions: [{ field: 'moisture', max: 0.52, blend: 0.08 }, { field: 'rock', max: 0.58, blend: 0.06 }],
            transition: 120, paint: [1, 0, 0, 0], paintStrength: 0.45,
            recipes: [{ recipe: 'lone pine', layer: 'detail', density: 0.04 }, { recipe: 'stones', layer: 'detail', density: 0.03 }] },
        { id: 'rocky', conditions: [{ field: 'rock', min: 0.58, blend: 0.06 }, { field: 'moisture', max: 0.52, blend: 0.08 }],
            transition: 80, paint: [0.15, 0.35, 0, 0.5], paintStrength: 0.6,
            recipes: [{ recipe: 'outcrop', layer: 'groups', density: 0.6 }, { recipe: 'copper', layer: 'resources', density: 0.5 }] },
    ],
    recipes: [
        { id: 'grove', version: 1, tags: ['tree'],
            anchor: { id: 'elder', mesh: PINE, material: 'assets/materials/pine.esmaterial', scale: [1.4, 1.8], footprint: 10, canopy: 35, minUp: 0.82, far: PINE_FAR },
            members: [
                { id: 'pine', mesh: PINE, material: 'assets/materials/pine.esmaterial', count: [3, 6], ring: [45, 110], scale: [0.9, 1.3], footprint: 8, canopy: 25, minUp: 0.8, far: PINE_FAR },
                { id: 'sapling', mesh: PINE, material: 'assets/materials/pine.esmaterial', count: [2, 5], ring: [110, 170], scale: [0.35, 0.6], footprint: 4, minUp: 0.8, chance: 0.8, far: PINE_FAR },
                { id: 'stone', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [0, 2], ring: [20, 60], scale: [0.8, 1.6], footprint: 6, tags: ['rock'] },
            ] },
        { id: 'lone pine', version: 1, tags: ['tree'],
            anchor: { id: 'pine', mesh: PINE, material: 'assets/materials/pine.esmaterial', scale: [0.8, 1.4], footprint: 8, minUp: 0.8, far: PINE_FAR } },
        { id: 'outcrop', version: 1, tags: ['rock'],
            anchor: { id: 'boulder', mesh: ROCK, material: 'assets/materials/stone.esmaterial', scale: [4, 6.5], footprint: 26, attach: 'align' },
            members: [
                { id: 'rock', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [2, 4], ring: [32, 60], scale: [1.6, 3], footprint: 12, attach: 'align' },
                { id: 'scree', mesh: ROCK, material: 'assets/materials/stone.esmaterial', count: [4, 9], ring: [50, 95], scale: [0.4, 0.9], footprint: 4, attach: 'align' },
            ] },
        { id: 'stones', version: 1, tags: ['rock'],
            anchor: { id: 'stone', mesh: ROCK, material: 'assets/materials/stone.esmaterial', scale: [0.6, 1.4], footprint: 6, attach: 'align' } },
        { id: 'copper', version: 1, tags: ['ore'],
            anchor: { id: 'vein', mesh: ROCK, material: 'assets/materials/copper.esmaterial', interactive: 'copper', scale: [1.2, 1.8], footprint: 10, attach: 'align' } },
    ],
    layers: [
        { id: 'groups', spacing: 260, drawDistance: 4200, lodDistance: 1400, chunkSize: 512 },
        { id: 'resources', spacing: 220, drawDistance: 2400, chunkSize: 512 },
        { id: 'detail', spacing: 90, drawDistance: 2400, lodDistance: 1200, chunkSize: 384 },
    ],
};
registerWorldRules(rules);

const KEYS = [
    'W A S D   walk        Q E   turn',
    'M   mine the nearest copper',
    'B   build a house in front of you (keeps the wild out of it)',
];

addPlugin({
    name: 'worldgen-showcase',
    build(app) {
        let hud: Entity | null = null;
        let status: Entity | null = null;
        let notice = '';
        let noticeUntil = 0;
        let built = 0;
        const say = (text: string, now: number): void => { notice = text; noticeUntil = now + 3; };

        app.addSystem(defineSystem([GetWorld(), Res(Input), Res(Time), Query(Mut(Transform), Camera)], (world, input, time, cameras) => {
            const now = time.elapsed;
            if (hud === null) {
                const canvas = world.findEntityByName('Canvas');
                if (canvas !== null) {
                    const panel = { position: UIPositionType.Absolute, insetLeft: px(20), insetTop: px(18), width: px(470), pointerEvents: 0 };
                    hud = spawnUIEntity({ world, parent: canvas, node: { ...panel, height: px(80) },
                        visual: { color: { r: 0.02, g: 0.05, b: 0.08, a: 0.55 } },
                        text: { content: `GENERATED WORLD\n${KEYS.join('\n')}`, fontSize: 13, color: { r: 0.9, g: 0.94, b: 0.97, a: 1 }, align: 0 } });
                    world.insert(hud, Name, { value: 'Keys' });
                    status = spawnUIEntity({ world, parent: canvas, node: { ...panel, insetTop: px(104), height: px(64) },
                        visual: { color: { r: 0.02, g: 0.05, b: 0.08, a: 0.55 } },
                        text: { content: '', fontSize: 13, color: { r: 0.62, g: 0.86, b: 0.95, a: 1 }, align: 0 } });
                    world.insert(status, Name, { value: 'Status' });
                }
            }
            const gens = app.hasResource(WorldGenRes) ? app.getResource(WorldGenRes) : null;
            const plan = gens?.plan() ?? null;
            const eye = [...cameras][0]?.[1] ?? null;
            if (!eye) return;

            // Walking: along the ground plane, the camera's height following the ground under it.
            const q = eye.rotation;
            let yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
            const pitch = -0.2;
            const turn = (input.isKeyDown('KeyE') ? -1 : 0) + (input.isKeyDown('KeyQ') ? 1 : 0);
            yaw += turn * time.delta * 0.9;
            const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
            const walk = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
            const side = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
            const speed = 420 * time.delta;
            const x = eye.position.x + (fx * walk - fz * side) * speed, z = eye.position.z + (fz * walk + fx * side) * speed;
            const ground = plan?.env.sample(x, z).height;
            const y = Number.isFinite(ground) ? ground! + 180 : eye.position.y;
            if (walk || side || turn) {
                const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
                eye.position = { x, y: eye.position.y + (y - eye.position.y) * Math.min(1, time.delta * 4), z };
                eye.rotation = { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
            }

            if (gens && plan && input.isKeyPressed('KeyM')) {
                // The nearest copper within reach; mining it is a change to the world, kept by its placement id.
                const reach = 600;
                const near = plan.placementsIn(x - reach, z - reach, x + reach, z + reach, ['resources'])
                    .filter((p) => p.interactive === 'copper' && !gens.diffs().isRemoved(p.id))
                    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
                if (near) { gens.diffs().remove(near.id); say(`Mined ${near.id}`, now); } else say('No copper within reach', now);
            }
            if (gens && input.isKeyPressed('KeyB')) {
                const at = { x: x + fx * 260, z: z + fz * 260 };
                gens.zones().set({ id: `house ${++built}`, kind: 'building', shape: { type: 'rect', x: at.x, z: at.z, halfX: 40, halfZ: 30, yaw },
                    falloff: 12, priority: 20, excludes: ['*'], flatten: 'ground' });
                say(`House ${built} built: its plot levelled and the wild kept out of it`, now);
            }

            if (status !== null && plan) {
                const biome = plan.biomeAt(x, z) ?? '—';
                const bakes = app.hasResource(BakesRes) ? app.getResource(BakesRes).active : [];
                const making = bakes.length ? `\n${bakes.map((b) => `${b.label} ${Math.round(b.progress * 100)}%`).join('   ')}` : '';
                const line = now < noticeUntil ? `\n${notice}` : '';
                const content = `Biome: ${biome}    Mined: ${gens!.diffs().toJSON().removed.length}    Houses: ${built}${making}${line}`;
                const text = world.get(status, Text);
                if (text.content !== content) world.insert(status, Text, { ...text, content });
            }
        }, { name: 'WorldGenShowcase' }));
    },
});
