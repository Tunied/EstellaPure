// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    underwater.ts
 * @brief   Seeing from under the water: the effect that fogs the world by how much water the light has crossed, and the system that says when.
 *
 * @details The effect is the water's own: its definition and shader are registered here, with the rest of the water module, so a build with no water carries
 *          none of it. Every pixel's light has crossed the distance from the eye to what it came from (the far range for the sky), and the
 *          water takes it out colour by colour (red first: the same absorption and density the surface's material draws with) and gives back its own
 *          colour, which dims with the camera's depth. The system reads the camera's place in the water from {@link Waters.sample} each frame
 *          and tells the post-process volume system (see postprocess/underwater.ts), which adds the effect for as long as the camera is under.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Camera, Transform, type CameraData, type TransformData } from '../ecs/component';
import { Material } from '../render/material';
import { registerEffect } from '../postprocess/effects';
import { setUnderwaterState, submersion } from '../postprocess/underwater';
import { WatersRes } from './waterPlugin';

const SOURCE = `#pragma shader "PP Underwater"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_scatterColor color default(0.03,0.2,0.28,1)
#pragma param u_density float default(0.12) range(0,4)
#pragma param u_amount float default(1) range(0,1)
#pragma param u_cameraDepth float default(0) range(0,100000)
#pragma param u_lightFalloff float default(0.004) range(0,1)
#pragma param u_range float default(4000) range(10,100000)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float depth = texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
    // How much water the light of this pixel has crossed: the distance from the eye to the surface it came off, and for the sky (no surface) the longest
    // the water is seen through.
    float dist = u_range;
    if (depth < 1.0) {
        vec3 world = worldFromDepth(v_texCoord, depth);
        vec3 entry = worldFromDepth(v_texCoord, 0.0);
        dist = min(length(world - entry), u_range);
    }
    vec3 transmit = exp(-u_absorption.rgb * (u_density * dist));
    // The water gives back its own colour, less of it the deeper the camera is: the light it scatters is what reached it from above.
    vec3 scatter = u_scatterColor.rgb;
#ifdef ES_LINEAR
    scatter = srgbToLinear(scatter);
#endif
    scatter *= exp(-u_lightFalloff * u_cameraDepth);
    vec3 col = src.rgb * transmit + scatter * (1.0 - dot(transmit, vec3(1.0 / 3.0)));
    fragColor = vec4(mix(src.rgb, col, u_amount), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let depth = textureLoad(t7, vec2i(v.pos.xy), 0);
    var dist = mc.u_range;
    if (depth < 1.0) {
        let world = worldFromDepth(v.v_texCoord, depth);
        let entry = worldFromDepth(v.v_texCoord, 0.0);
        dist = min(length(world - entry), mc.u_range);
    }
    let transmit = exp(-mc.u_absorption.rgb * (mc.u_density * dist));
    var scatter = mc.u_scatterColor.rgb;
#ifdef ES_LINEAR
    scatter = srgbToLinear(scatter);
#endif
    scatter = scatter * exp(-mc.u_lightFalloff * mc.u_cameraDepth);
    let col = src.rgb * transmit + scatter * (1.0 - dot(transmit, vec3f(1.0 / 3.0)));
    return vec4f(mix(src.rgb, col, vec3f(mc.u_amount)), src.a);
}
#pragma end
`;

let registered = false;

/** Registers the effect with the post-process registry, once. */
export function registerUnderwaterEffect(): void {
    if (registered) return;
    registered = true;
    registerEffect({
        type: 'underwater',
        label: 'Underwater',
        category: 'atmosphere',
        factory: () => Material.compileShader(SOURCE),
        uniforms: [
            // Per WORLD unit of water: how much of the light a unit takes out (times each colour's absorption).
            { name: 'u_density', label: 'Density', min: 0, max: 4, step: 0.005, defaultValue: 0.12, neutralValue: 0 },
            { name: 'u_amount', label: 'Amount', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
            // How far under the surface the camera is; the water module sets it.
            { name: 'u_cameraDepth', label: 'Camera Depth', min: 0, max: 100000, step: 1, defaultValue: 0 },
            // How fast the water's own light dims with the camera's depth, per world unit.
            { name: 'u_lightFalloff', label: 'Light Falloff', min: 0, max: 1, step: 0.0005, defaultValue: 0.004 },
            // The longest the water is seen through: what the sky, which has no surface, is fogged by.
            { name: 'u_range', label: 'Range', min: 10, max: 100000, step: 10, defaultValue: 4000 },
        ],
        colors: [
            { name: 'u_absorption', label: 'Absorption', defaultValue: { r: 0.45, g: 0.09, b: 0.05, a: 1 } },
            { name: 'u_scatterColor', label: 'Colour', defaultValue: { r: 0.03, g: 0.2, b: 0.28, a: 1 } },
        ],
    });
}

type Triple = [number, number, number];

/** A colour or vector uniform of a material as three numbers, or the fallback where it says nothing readable. */
function triple(instance: number, name: string, fallback: Triple): Triple {
    if (!instance) return fallback;
    const v = Material.getUniform(instance, name) as unknown;
    if (Array.isArray(v) && v.length >= 3) return [Number(v[0]), Number(v[1]), Number(v[2])];
    if (v && typeof v === 'object') {
        const o = v as Record<string, number>;
        if ('r' in o) return [o.r!, o.g!, o.b!];
        if ('x' in o) return [o.x!, o.y!, o.z!];
    }
    return fallback;
}

function single(instance: number, name: string, fallback: number): number {
    if (!instance) return fallback;
    const v = Material.getUniform(instance, name);
    return typeof v === 'number' ? v : fallback;
}

/** The plugin that keeps the post-process volume system told whether the camera is under water. */
export class UnderwaterPlugin implements Plugin {
    name = 'underwater';
    build(app: App): void {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(WatersRes)) return;
            const waters = app.getResource(WatersRes);
            let eye: [number, number, number] | null = null;
            for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
                if (!(app.world.get(entity, Camera) as CameraData).isActive) continue;
                const t = app.world.get(entity, Transform) as TransformData;
                eye = [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z];
                break;
            }
            const sample = eye ? waters.sample(eye[0], eye[1], eye[2]) : null;
            if (!sample || !(sample.depth < 0)) { setUnderwaterState(null); return; }
            const built = waters.built_.get(sample.entity);
            const instance = built?.instance ?? 0;
            const depth = -sample.depth;
            const density = single(instance, 'u_density', 0.12);
            const shallow = triple(instance, 'u_shallowColor', [0.10, 0.42, 0.46]);
            const deep = triple(instance, 'u_deepColor', [0.01, 0.08, 0.15]);
            // Deeper, the water gives back more of its deep colour: the same blend the surface draws.
            const toDeep = 1 - Math.exp(-depth * density * 0.5);
            setUnderwaterState({
                amount: submersion(depth, Math.max(1, (built?.data.waveHeight ?? 0) * 0.5)),
                depth,
                absorption: triple(instance, 'u_absorption', [0.45, 0.09, 0.05]),
                density,
                scatter: [shallow[0] + (deep[0] - shallow[0]) * toDeep, shallow[1] + (deep[1] - shallow[1]) * toDeep, shallow[2] + (deep[2] - shallow[2]) * toDeep],
            });
        }, { name: 'UnderwaterSystem' }));
    }

    cleanup(): void {
        setUnderwaterState(null);
    }
}
