// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The scene is authored; keys poke at it (the HUD lists them) and the HUD says what the engine is still baking.
import { addPlugin, defineSystem, GetWorld, Res, Query, Mut, Input, Time, Transform, Camera, Quality, Weather, Text, Name, BakesRes,
    spawnUIEntity, UIPositionType, px, type Entity,
    WEATHER_CLEAR, WEATHER_MIST, WEATHER_OVERCAST, WEATHER_RAIN, WEATHER_STORM } from 'esengine';
import { WatersRes, Floating } from 'esengine/water';

type Pose = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } };

/** A camera turned `yaw` radians left of north (-z) and `pitch` up. */
function pose(x: number, y: number, z: number, yaw: number, pitch: number): Pose {
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { position: { x, y, z }, rotation: { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp } };
}

/** What W steps through, and what the HUD calls them. */
const WEATHERS = [WEATHER_CLEAR, WEATHER_MIST, WEATHER_OVERCAST, WEATHER_RAIN, WEATHER_STORM];
const WEATHER_NAMES = ['Clear', 'Mist', 'Overcast', 'Rain', 'Storm'];

/** The other places to look from; the first viewpoint is the scene's own camera. */
const VIEWS: { name: string; pose: Pose }[] = [
    { name: 'Above the lake', pose: pose(5600, 2100, 700, 1.25, -0.2) },
    { name: 'Up the river', pose: pose(-700, 3000, -4300, 0.35, -0.16) },
    { name: 'On the beach', pose: pose(-2600, 260, 7400, 0.6, -0.05) },
];

const KEYS = [
    'W   next weather (clear, mist, overcast, rain, storm)',
    'R   a shower on the water in front of you',
    'Space   a wave round every crate',
    'C   next viewpoint',
    'U   dive under the sea, and back up',
    '1 2 3   quality: low (flat water) / medium / high',
];

/** A point `ahead` world units in front of the camera, along its heading on the ground plane. */
function inFront(t: { position: { x: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }, ahead: number): [number, number] {
    const q = t.rotation;
    // The camera looks down -z: its forward is the rotation of (0, 0, -1).
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const len = Math.hypot(fx, fz) || 1;
    return [t.position.x + (fx / len) * ahead, t.position.z + (fz / len) * ahead];
}

addPlugin({
    name: 'water-showcase',
    build(app) {
        let under = false;
        let shore: Pose | null = null;
        let start: Pose | null = null;
        let view = 0;
        let rain = 0;
        let level: 'low' | 'medium' | 'high' = 'high';
        let hud: Entity | null = null;
        let status: Entity | null = null;
        let notice = '';
        let noticeUntil = 0;
        const say = (text: string, now: number): void => { notice = text; noticeUntil = now + 3; };

        app.addSystem(defineSystem([
            GetWorld(), Res(Input), Res(Time), Res(Quality), Query(Mut(Transform), Camera), Query(Transform, Floating), Query(Mut(Weather)),
        ], (world, input, time, quality, cameras, crates, weathers) => {
            const now = time.elapsed;
            if (hud === null) {
                const canvas = world.findEntityByName('Canvas');
                if (canvas !== null) {
                    const panel = { position: UIPositionType.Absolute, insetLeft: px(20), insetTop: px(18), width: px(470), pointerEvents: 0 };
                    hud = spawnUIEntity({ world, parent: canvas, node: { ...panel, height: px(176) },
                        visual: { color: { r: 0.02, g: 0.05, b: 0.08, a: 0.55 } },
                        text: { content: `TERRAIN & WATER\n${KEYS.join('\n')}`, fontSize: 13, color: { r: 0.9, g: 0.94, b: 0.97, a: 1 }, align: 0 } });
                    world.insert(hud, Name, { value: 'Keys' });
                    status = spawnUIEntity({ world, parent: canvas, node: { ...panel, insetTop: px(200), height: px(64) },
                        visual: { color: { r: 0.02, g: 0.05, b: 0.08, a: 0.55 } },
                        text: { content: '', fontSize: 13, color: { r: 0.62, g: 0.86, b: 0.95, a: 1 }, align: 0 } });
                    world.insert(status, Name, { value: 'Status' });
                }
            }

            if (input.isKeyPressed('KeyW')) {
                for (const [, w] of weathers) {
                    // Turn from where it is toward the next one, over two seconds, and stop the cycle so it stays there.
                    const at = w.target >= 0 && w.progress > 0.5 ? w.target : w.preset;
                    const next = WEATHERS[(Math.max(0, WEATHERS.indexOf(at)) + 1) % WEATHERS.length]!;
                    w.preset = at;
                    w.target = next;
                    w.progress = 0;
                    w.duration = 2;
                    w.sequence = '';
                    say(`Weather turning to ${WEATHER_NAMES[WEATHERS.indexOf(next)]}`, now);
                }
            }
            const waters = app.hasResource(WatersRes) ? app.getResource(WatersRes) : null;
            const eye = [...cameras][0]?.[1] ?? null;
            if (input.isKeyPressed('KeyR')) {
                rain = 2;
                say('A shower falls on the water ahead', now);
            }
            if (waters && eye && rain > 0) {
                rain -= time.delta;
                const [cx, cz] = inFront(eye, 2500);
                for (let k = 0; k < 8; k++) {
                    const x = cx + (Math.random() - 0.5) * 4000, z = cz + (Math.random() - 0.5) * 4000;
                    waters.disturb(x, 0, z, 60, -6);
                }
            }
            if (waters && input.isKeyPressed('Space')) {
                for (const [, t] of crates) waters.disturb(t.position.x, t.position.y, t.position.z, 260, -40);
                say('A wave round every crate', now);
            }
            if (input.isKeyPressed('KeyC') && !under) {
                for (const [, t] of cameras) {
                    start ??= { position: { ...t.position }, rotation: { ...t.rotation } };
                    view = (view + 1) % (VIEWS.length + 1);
                    const next = view === 0 ? start : VIEWS[view - 1]!.pose;
                    t.position = { ...next.position };
                    t.rotation = { ...next.rotation };
                }
            }
            if (input.isKeyPressed('KeyU')) {
                for (const [, t] of cameras) {
                    if (!under) {
                        shore = { position: { ...t.position }, rotation: { ...t.rotation } };
                        // Two metres down among the crates off the beach, looking up at the surface and the light through it.
                        t.position = { x: 1800, y: -160, z: 11000 };
                        t.rotation = { x: 0.13, y: 0.04, z: -0.005, w: 0.991 };
                    } else if (shore) {
                        t.position = shore.position;
                        t.rotation = shore.rotation;
                    }
                }
                under = !under;
            }
            for (const [key, mode] of [['Digit1', 'low'], ['Digit2', 'medium'], ['Digit3', 'high']] as const) {
                if (!input.isKeyPressed(key)) continue;
                if (quality) { quality.setMode(mode); level = mode; say(`Quality: ${mode}`, now); } else say('This project has no quality levels', now);
            }

            if (status !== null) {
                const w = [...weathers][0]?.[1];
                const named = (preset: number): string => WEATHER_NAMES[WEATHERS.indexOf(preset)] ?? '?';
                const weather = w ? (w.target >= 0 ? `${named(w.preset)} → ${named(w.target)}` : named(w.preset)) : '—';
                const place = under ? 'Under the sea' : view === 0 ? 'Over the sea' : VIEWS[view - 1]!.name;
                const bakes = app.hasResource(BakesRes) ? app.getResource(BakesRes).active : [];
                const baking = bakes.length ? `\n${bakes.map((b) => `${b.label} ${Math.round(b.progress * 100)}%`).join('   ')}` : '';
                const line = now < noticeUntil ? `\n${notice}` : '';
                const content = `Weather: ${weather}    Quality: ${level}    View: ${place}${baking}${line}`;
                const text = world.get(status, Text);
                if (text.content !== content) world.insert(status, Text, { ...text, content });
            }
        }, { name: 'WaterShowcase' }));
    },
});
