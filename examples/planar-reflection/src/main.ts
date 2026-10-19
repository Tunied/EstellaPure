// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { addPlugin, defineTag, defineSystem, Res, Query, Mut, Time, Input, Transform,
    PlanarReflection, Quality } from 'esengine';

export const ReflectionSubject = defineTag('ReflectionSubject');
addPlugin({
    name: 'planar-reflection-demo',
    build(app) {
        let elapsed = 0;
        app.addSystem(defineSystem([
            Res(Time), Res(Input), Res(Quality),
            Query(Mut(Transform), ReflectionSubject), Query(Mut(PlanarReflection)),
        ], (time, input, quality, subjects, surfaces) => {
            elapsed += time.delta;
            for (const [, transform] of subjects) {
                transform.position.x = -1.2 + Math.sin(elapsed) * 0.8;
                transform.rotation = { x: 0, y: Math.sin(elapsed * 0.4), z: 0, w: Math.cos(elapsed * 0.4) };
            }
            if (input.isKeyPressed('Space')) {
                for (const [, surface] of surfaces) surface.enabled = !surface.enabled;
            }
            for (const [key, mode] of [['Digit1', 'low'], ['Digit2', 'medium'], ['Digit3', 'high']] as const) {
                if (input.isKeyPressed(key)) quality?.setMode(mode);
            }
        }, { name: 'PlanarReflectionDemo' }));
    },
});
