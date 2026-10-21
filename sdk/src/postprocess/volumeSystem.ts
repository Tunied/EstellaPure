// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineSystem } from '../ecs/system';
import { defineResource, Res } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, Camera, type PostProcessVolumeData, type TransformData, type CameraData } from '../ecs/component';
import { PostProcess, type PostProcessAPI } from './PostProcessAPI';
import { getEffectDef } from './effects';
import { blendVolumeEffects, computeVolumeFactor, type ActiveVolume, type BlendedEffect, type VolumeTransform } from './volumeBlending';
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { applyWeatherToEffects, currentWeather, currentWeatherDrive } from './weather';
import { applyTimeToEffects, currentTimeOfDay, currentTimeDrive, timeLightsApplied } from './timeOfDay';

export interface PostProcessVolumeConfig {
    enabled: boolean;
}

export const PostProcessVolumeConfigResource = defineResource<PostProcessVolumeConfig>(
    { enabled: true },
    'PostProcessVolumeConfig'
);

// Texture-param refs resolve through the App's Assets (set by PostProcessPlugin);
// preloaded by PostProcessVolume's discoverAssets, so lookups are cache hits.
let volumeTextureResolver: ((ref: string) => number) | null = null;

export function setVolumeTextureResolver(resolver: ((ref: string) => number) | null): void {
    volumeTextureResolver = resolver;
}

function getOrCreateShader(api: PostProcessAPI, key: string, factory: () => ShaderHandle): ShaderHandle {
    const existing = api.volumeShaders.get(key);
    if (existing !== undefined) return existing;

    const shader = factory();
    api.volumeShaders.set(key, shader);
    return shader;
}

function applyTextures(
    stack: ReturnType<PostProcessAPI['createStack']>,
    passName: string,
    textures: Map<string, string>,
): void {
    if (textures.size === 0 || !volumeTextureResolver) return;
    for (const [uniformName, ref] of textures) {
        const handle = volumeTextureResolver(ref);
        if (handle) stack.setTexture(passName, uniformName, handle);
    }
}

type ResolvedEffects = Map<string, BlendedEffect>;

function applyColors(
    stack: ReturnType<PostProcessAPI['createStack']>,
    passName: string,
    colors: BlendedEffect['colors'],
): void {
    for (const [uniformName, c] of colors) {
        stack.setUniformVec4(passName, uniformName, { x: c.r, y: c.g, z: c.b, w: c.a });
    }
}

// Per-stack signature of the last-applied effect set, so an unchanged frame can
// skip the whole wasm-boundary rebuild. Keyed by the stack object (auto-cleared
// when the stack is destroyed/GC'd).
const lastEffectSig = new WeakMap<object, string>();
// And of its SHAPE alone — which effects, which parameters, which textures — so a frame that only moved numbers
// (a weather in transition, a fading volume) writes them into the passes it has instead of building them again.
const lastShapeSig = new WeakMap<object, string>();

function shapeSignature(effects: ResolvedEffects): string {
    let sig = '';
    for (const [type, data] of effects) {
        if (!data.enabled) continue;
        sig += type + ':';
        for (const k of data.uniforms.keys()) sig += k + ',';
        sig += '|';
        for (const [k, ref] of data.textures) sig += k + '=' + ref + ';';
        sig += '|';
        for (const k of data.colors.keys()) sig += k + ',';
        sig += '#';
    }
    return sig;
}

/** The names of the passes an effect becomes: one, or the several a multi-pass effect is made of. */
function passNamesOf(effectType: string): string[] {
    const def = getEffectDef(effectType);
    if (def?.multiPass) return def.multiPass.map((p) => p.name);
    return [effectType];
}

function writeValues(stack: ReturnType<PostProcessAPI['createStack']>, effects: ResolvedEffects): void {
    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled || !getEffectDef(effectType)) continue;
        for (const passName of passNamesOf(effectType)) {
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(passName, uniformName, uniformValue);
            }
            applyColors(stack, passName, effectData.colors);
        }
    }
}

/** Stable string of the enabled effects (type + uniforms + textures). */
function effectsSignature(effects: ResolvedEffects): string {
    let sig = '';
    for (const [type, data] of effects) {
        if (!data.enabled) continue;
        sig += type + ':';
        for (const [k, v] of data.uniforms) sig += k + '=' + v + ';';
        sig += '|';
        for (const [k, ref] of data.textures) sig += k + '=' + ref + ';';
        sig += '|';
        for (const [k, c] of data.colors) sig += k + '=' + c.r + ',' + c.g + ',' + c.b + ',' + c.a + ';';
        sig += '#';
    }
    return sig;
}

function applyBlendedEffects(
    api: PostProcessAPI,
    camera: Entity,
    effects: ResolvedEffects,
): void {
    if (effects.size === 0) {
        const existing = api.volumeStacks.get(camera);
        if (existing) {
            api.unbind(camera);
            existing.destroy();
            api.volumeStacks.delete(camera);
        }
        return;
    }

    let stack = api.volumeStacks.get(camera);
    if (!stack) {
        stack = api.createStack();
        api.volumeStacks.set(camera, stack);
    }

    // The rebuild below re-uploads the whole pass list + uniforms across the wasm
    // boundary; skip it when the resolved effect set is identical to last frame
    // (a static scene, or a fixed-weight global volume, never changes it).
    const sig = effectsSignature(effects);
    if (lastEffectSig.get(stack) === sig) return;
    lastEffectSig.set(stack, sig);

    // The same effects with other numbers: write the numbers.
    const shape = shapeSignature(effects);
    if (lastShapeSig.get(stack) === shape) {
        writeValues(stack, effects);
        return;
    }
    lastShapeSig.set(stack, shape);

    stack.clearPasses();

    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled) continue;

        const def = getEffectDef(effectType);
        if (!def) continue;

        if (def.multiPass) {
            for (const [index, subPass] of def.multiPass.entries()) {
                const shader = getOrCreateShader(api, subPass.name, subPass.factory);
                stack.addPass(subPass.name, shader, subPass.scale ?? 1, index > 0);
                for (const [uniformName, uniformValue] of effectData.uniforms) {
                    stack.setUniform(subPass.name, uniformName, uniformValue);
                }
                applyTextures(stack, subPass.name, effectData.textures);
                applyColors(stack, subPass.name, effectData.colors);
            }
        } else {
            const shader = getOrCreateShader(api, effectType, def.factory);
            stack.addPass(effectType, shader);
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(effectType, uniformName, uniformValue);
            }
            applyTextures(stack, effectType, effectData.textures);
            applyColors(stack, effectType, effectData.colors);
        }
    }

    if (stack.enabledPassCount > 0) {
        api.bind(camera, stack);
    } else {
        api.unbind(camera);
    }
}

export const postProcessVolumeSystem = defineSystem(
    [Res(PostProcess), Query(PostProcessVolume, Transform), Query(Camera, Transform)],
    (
        api: PostProcessAPI,
        volumeQuery: Iterable<[Entity, PostProcessVolumeData, TransformData]>,
        cameraQuery: Iterable<[Entity, CameraData, TransformData]>,
    ) => {
        const volumes: { data: PostProcessVolumeData; tx: VolumeTransform }[] = [];
        for (const [_entity, volumeData, transform] of volumeQuery) {
            volumes.push({
                data: volumeData,
                tx: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            });
        }

        // Recomputed per camera: a local volume's weight depends on the camera position.
        for (const [cameraEntity, cameraData, cameraTransform] of cameraQuery) {
            if (!cameraData.isActive) continue;

            const cx = cameraTransform.position.x;
            const cy = cameraTransform.position.y;
            const cz = cameraTransform.position.z;

            const activeVolumes: ActiveVolume[] = [];
            for (const { data, tx } of volumes) {
                const factor = computeVolumeFactor(data, tx, cx, cy, cz);
                if (factor > 0) activeVolumes.push({ data, factor });
            }

            const blended = activeVolumes.length > 0
                ? blendVolumeEffects(activeVolumes)
                : new Map() as ResolvedEffects;

            // The weather, if a Weather component is in the scene: scales and tints what the volumes resolved, and
            // brings the effects a weather implies.
            const weather = currentWeather();
            if (weather) applyWeatherToEffects(blended, weather, currentWeatherDrive());
            const clock = currentTimeOfDay();
            if (clock) applyTimeToEffects(blended, clock, currentTimeDrive(), timeLightsApplied());

            applyBlendedEffects(api, cameraEntity, blended);
        }
    },
    { name: 'PostProcessVolumeSystem' }
);

export function cleanupVolumeSystem(api: PostProcessAPI): void {
    for (const [camera, stack] of api.volumeStacks) {
        api.unbind(camera);
        stack.destroy();
    }
    api.volumeStacks.clear();

    for (const shader of api.volumeShaders.values()) {
        Material.releaseShader(shader);
    }
    api.volumeShaders.clear();
}
