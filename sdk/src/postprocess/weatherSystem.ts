// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  weatherSystem.ts
 * @brief Runs the scene's Weather: advances its turns and cycle, and puts it on the lights.
 *
 * @details Only the lights are written to — the effects are read from `currentWeather()` by the volume system a step later,
 *          which is what lets the editor preview the post-process half of a weather without the scene's own lights being
 *          changed (and saved) by it. The lights are rewritten only in play mode, from the strengths they were authored
 *          with, and put back when the weather goes.
 */
import { defineSystem } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query, Mut } from '../ecs/query';
import { GetWorld } from '../ecs/system';
import { Weather, Light, type WeatherData, type LightData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { isEditor, isPlayMode } from '../ecs/env';
import {
    blendWeather, setCurrentWeather, weatherPresetId, WEATHER_NONE, WeatherDrive, type WeatherState,
} from './weather';

/** What a light was authored with, kept so a weather scales the author's number and never its own last answer. */
interface LightBase {
    intensity: number;
    color: { r: number; g: number; b: number; a: number };
    reflectionScale: number;
    reflectionSaturation: number;
    applied: number;
}

const bases = new Map<Entity, LightBase>();

/** Where each Weather is in its sequence, and how long it has held. Not in the component: a scene file need not carry it. */
const cycles = new Map<Entity, { index: number; held: number }>();

const LIGHT_DIRECTIONAL = 1;
const LIGHT_AMBIENT = 2;

function restoreLights(world: World): void {
    for (const [entity, base] of bases) {
        if (world.has(entity, Light)) {
            const data = world.get(entity, Light) as LightData;
            world.set(entity, Light, {
                ...data, intensity: base.intensity, color: { ...base.color },
                reflectionScale: base.reflectionScale, reflectionSaturation: base.reflectionSaturation,
            });
        }
    }
    bases.clear();
}

function applyLights(world: World, state: WeatherState, drive: number): void {
    for (const entity of world.getEntitiesWithComponents([Light])) {
        const data = world.get(entity, Light) as LightData;
        if (data.type !== LIGHT_DIRECTIONAL && data.type !== LIGHT_AMBIENT) continue;
        let base = bases.get(entity);
        if (!base) {
            base = {
                intensity: data.intensity, color: { ...data.color },
                reflectionScale: data.reflectionScale ?? 1, reflectionSaturation: data.reflectionSaturation ?? 1,
                applied: Number.NaN,
            };
            bases.set(entity, base);
        }
        const sun = data.type === LIGHT_DIRECTIONAL;
        const lights = (drive & WeatherDrive.Lights) !== 0;
        const reflections = (drive & WeatherDrive.Reflections) !== 0 && !sun;
        const scale = lights ? (sun ? state.sun : state.sky) : 1;
        // The key is what the light would be told: nothing is written for a frame that would say the same again.
        const key = scale + (lights && sun ? state.sunTint[0] * 7 + state.sunTint[1] * 13 + state.sunTint[2] * 29 : 0)
            + (reflections ? state.reflection * 101 + state.reflectionSaturation * 211 : 0);
        if (base.applied === key) continue;
        base.applied = key;
        const color = lights && sun
            ? { r: base.color.r * state.sunTint[0], g: base.color.g * state.sunTint[1], b: base.color.b * state.sunTint[2], a: base.color.a }
            : { ...base.color };
        world.set(entity, Light, {
            ...data, intensity: base.intensity * scale, color,
            reflectionScale: reflections ? base.reflectionScale * state.reflection : base.reflectionScale,
            reflectionSaturation: reflections ? base.reflectionSaturation * state.reflectionSaturation : base.reflectionSaturation,
        });
    }
}

/** The preset a name or an id in a sequence stands for. */
function presetOf(token: string): number | undefined {
    const trimmed = token.trim();
    if (trimmed === '') return undefined;
    const named = weatherPresetId(trimmed.toLowerCase());
    if (named !== undefined) return named;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

function advance(entity: Entity, data: WeatherData, dt: number): void {
    if (data.target !== WEATHER_NONE) {
        data.progress += dt / Math.max(data.duration, 0.01);
        if (data.progress >= 1) {
            data.preset = data.target;
            data.target = WEATHER_NONE;
            data.progress = 0;
        }
        return;
    }
    if (!data.sequence) return;
    const list = data.sequence.split(',').map(presetOf).filter((v): v is number => v !== undefined);
    if (list.length < 2) return;
    let cycle = cycles.get(entity);
    if (!cycle) {
        // Joins the sequence where the scene is: the first entry that is the weather now, else the start.
        const at = list.indexOf(data.preset);
        cycle = { index: at < 0 ? 0 : at, held: 0 };
        cycles.set(entity, cycle);
    }
    cycle.held += dt;
    if (cycle.held < data.hold) return;
    cycle.held = 0;
    cycle.index = (cycle.index + 1) % list.length;
    data.target = list[cycle.index];
    data.progress = 0;
}

export const weatherSystem = defineSystem(
    [Query(Mut(Weather)), Res(Time), GetWorld()],
    (weathers: Iterable<[Entity, WeatherData]>, time: TimeData, world: World) => {
        let found: [Entity, WeatherData] | null = null;
        for (const entry of weathers) { found = entry; break; }
        if (!found) {
            if (bases.size > 0) restoreLights(world);
            cycles.clear();
            setCurrentWeather(null);
            return;
        }
        const [entity, data] = found;
        const playing = !isEditor() || isPlayMode();
        if (playing) advance(entity, data, time.delta);

        const state = blendWeather(data.preset, data.target, data.progress);
        setCurrentWeather(state, data.drive);

        if (playing && (data.drive & (WeatherDrive.Lights | WeatherDrive.Reflections))) applyLights(world, state, data.drive);
        else if (bases.size > 0) restoreLights(world);
    },
    { name: 'WeatherSystem' }
);

/** Forgets what the system remembers: a device loss, a test, an app shut down. */
export function resetWeatherSystem(): void {
    bases.clear();
    cycles.clear();
    setCurrentWeather(null);
}
