// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { fxPreviewOrPlayMode } from '../ecs/env';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { SpringBoneRes, SpringBoneAPI } from './SpringBoneAPI';

/**
 * Runs the spring-bone chains after the frame's animation has posed the skeleton (animators write in Update; this is PostUpdate)
 * and before it is drawn. Frozen in editor edit mode like the rest of gameplay, so a chain never swings while it is being authored;
 * the FX preview flag is the one exception (env.ts).
 */
export class SpringBonePlugin implements Plugin {
    name = 'springBone';

    build(app: App): void {
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        app.insertResource(SpringBoneRes, new SpringBoneAPI(engine, registry));
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(Time), Res(SpringBoneRes)],
            (time: TimeData, springBone: SpringBoneAPI) => { springBone.update(time.delta); },
            { name: 'SpringBoneSystem' },
        ), { runIf: fxPreviewOrPlayMode });
    }
}

export const springBonePlugin = new SpringBonePlugin();
