// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The scene is authored; keys poke at it: W weather, R a shower, Space a wave per crate, C viewpoint, U dive, 1/2/3 quality.
import { addPlugin, defineSystem, Res, Query, Mut, Input, Time, Transform, Camera, Quality, Weather,
    WEATHER_CLEAR, WEATHER_MIST, WEATHER_OVERCAST, WEATHER_RAIN, WEATHER_STORM } from 'esengine';
import { WatersRes, Floating } from 'esengine/water';

type Pose = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } };

/** A camera turned `yaw` radians left of north (-z) and `pitch` up. */
function pose(x: number, y: number, z: number, yaw: number, pitch: number): Pose {
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { position: { x, y, z }, rotation: { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp } };
}

/** The other places to look from; the first viewpoint is the scene's own camera. */
/** What W steps through. */
const WEATHERS = [WEATHER_CLEAR, WEATHER_MIST, WEATHER_OVERCAST, WEATHER_RAIN, WEATHER_STORM];

const VIEWS: Pose[] = [
    pose(5600, 2100, 700, 1.25, -0.2),
    pose(-700, 3000, -4300, 0.35, -0.16),
];

addPlugin({
    name: 'water-showcase',
    build(app) {
        let under = false;
        // Rain falls on the water in front of the shore camera: [x, surface, z] at the middle of where it lands.
        const rainAt = [2000, 0, 9800];
        let shore: Pose | null = null;
        let start: Pose | null = null;
        let view = 0;
        let rain = 0;
        app.addSystem(defineSystem([
            Res(Input), Res(Time), Res(Quality), Query(Mut(Transform), Camera), Query(Transform, Floating), Query(Mut(Weather)),
        ], (input, time, quality, cameras, crates, weathers) => {
            if (input.isKeyPressed('KeyW')) {
                for (const [, w] of weathers) {
                    // Turn from where it is toward the next one, and stop the cycle so it stays there.
                    const at = w.target >= 0 && w.progress > 0.5 ? w.target : w.preset;
                    const next = WEATHERS[(Math.max(0, WEATHERS.indexOf(at)) + 1) % WEATHERS.length]!;
                    w.preset = at;
                    w.target = next;
                    w.progress = 0;
                    w.sequence = '';
                }
            }
            const waters = app.hasResource(WatersRes) ? app.getResource(WatersRes) : null;
            if (input.isKeyPressed('KeyR')) rain = 2;
            if (waters && rain > 0) {
                rain -= time.delta;
                for (let k = 0; k < 6; k++) {
                    const x = rainAt[0] + (Math.random() - 0.5) * 5000, z = rainAt[2] + (Math.random() - 0.5) * 4000;
                    waters.disturb(x, rainAt[1], z, 60, -6);
                }
            }
            if (waters && input.isKeyPressed('Space')) {
                for (const [, t] of crates) waters.disturb(t.position.x, t.position.y, t.position.z, 260, -40);
            }
            if (input.isKeyPressed('KeyC') && !under) {
                for (const [, t] of cameras) {
                    start ??= { position: { ...t.position }, rotation: { ...t.rotation } };
                    view = (view + 1) % (VIEWS.length + 1);
                    const next = view === 0 ? start : VIEWS[view - 1]!;
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
                if (input.isKeyPressed(key)) quality?.setMode(mode);
            }
        }, { name: 'WaterShowcase' }));
    },
});
