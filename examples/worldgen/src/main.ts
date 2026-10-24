// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The rules are a project file (assets/worlds/wilds.esworld) the scene's WorldGen names; mining and building are changes the world keeps.
import { addPlugin, defineSystem, GetWorld, Res, Query, Mut, Input, Time, Transform, Camera, Text, Name, BakesRes,
    spawnUIEntity, UIPositionType, px, Draw, registerDrawCallback, type Entity } from 'esengine';
import { WorldGenRes } from 'esengine/worldgen';
import { TerrainsRes } from 'esengine/terrain';

const KEYS = [
    'W A S D   walk        Q E   turn',
    'M   mine the nearest copper',
    'B   build a house in front of you (keeps the wild out of it)',
    'R   find the way home on foot (no ground steeper than 32 degrees)',
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
        // The way home last found, drawn over the ground until the next is asked for.
        let way: { x: number; y: number; z: number }[] = [];
        registerDrawCallback('worldgen-way-home', () => {
            for (let i = 1; i < way.length; i++) {
                const a = way[i - 1]!, b = way[i]!;
                Draw.line3D({ x: a.x, y: a.y + 4, z: a.z }, { x: b.x, y: b.y + 4, z: b.z }, { r: 1, g: 0.78, b: 0.2, a: 1 }, 3);
            }
        });

        app.addSystem(defineSystem([GetWorld(), Res(Input), Res(Time), Query(Mut(Transform), Camera)], (world, input, time, cameras) => {
            const now = time.elapsed;
            if (hud === null) {
                const canvas = world.findEntityByName('Canvas');
                if (canvas !== null) {
                    const panel = { position: UIPositionType.Absolute, insetLeft: px(20), insetTop: px(18), width: px(470), pointerEvents: 0 };
                    hud = spawnUIEntity({ world, parent: canvas, node: { ...panel, height: px(96) },
                        visual: { color: { r: 0.02, g: 0.05, b: 0.08, a: 0.55 } },
                        text: { content: `GENERATED WORLD\n${KEYS.join('\n')}`, fontSize: 13, color: { r: 0.9, g: 0.94, b: 0.97, a: 1 }, align: 0 } });
                    world.insert(hud, Name, { value: 'Keys' });
                    status = spawnUIEntity({ world, parent: canvas, node: { ...panel, insetTop: px(120), height: px(64) },
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

            if (input.isKeyPressed('KeyR') && app.hasResource(TerrainsRes)) {
                // Home is the Home zone at the origin; the search reads the ground as it stands, levelled plots and all.
                const started = performance.now();
                const found = app.getResource(TerrainsRes).findPath({ x, z }, { x: 0, z: 0 }, { step: 12, maxSlope: 32 });
                const ms = (performance.now() - started).toFixed(0);
                way = found.path;
                say(found.state === 'reached'
                    ? `The way home: ${Math.round(found.length)} along the ground (${found.cells} cells, ${ms} ms)`
                    : `No way home on foot: ${found.state} (${found.cells} cells, ${ms} ms)`, now);
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
