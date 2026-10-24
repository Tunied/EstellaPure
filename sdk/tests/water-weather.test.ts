// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { waveParamsOf, rainOnWater, grown, exposureOf } from '../src/water/waterPlugin';
import { WaterField, WaterZone, type ZoneLake } from '../src/water/zone';
import { RippleField } from '../src/water/ripples';
import {
    blendWeather, setCurrentWeather, WeatherDrive, WEATHER_CLEAR, WEATHER_MIST, WEATHER_RAIN, WEATHER_STORM, WEATHER_NONE,
} from '../src/postprocess/weather';

const zone = WaterZone._default;
const under = (preset: number, drive: number = WeatherDrive.All): void => setCurrentWeather(blendWeather(preset, WEATHER_NONE, 0), drive);

afterEach(() => setCurrentWeather(null));

describe('the wind in a weather', () => {
    it('rises from mist to a storm, and is still at clear', () => {
        const wind = (p: number) => blendWeather(p, WEATHER_NONE, 0).wind;
        const waves = (p: number) => blendWeather(p, WEATHER_NONE, 0).waves;
        expect(wind(WEATHER_CLEAR)).toBe(1);
        expect(waves(WEATHER_CLEAR)).toBe(1);
        expect(wind(WEATHER_MIST)).toBeLessThan(1);
        expect(wind(WEATHER_RAIN)).toBeGreaterThan(1);
        expect(wind(WEATHER_STORM)).toBeGreaterThan(wind(WEATHER_RAIN));
        expect(waves(WEATHER_STORM)).toBeGreaterThan(waves(WEATHER_RAIN));
    });

    it('turns with the weather, halfway at half a turn', () => {
        const half = blendWeather(WEATHER_CLEAR, WEATHER_STORM, 0.5);
        expect(half.waves).toBeCloseTo((1 + blendWeather(WEATHER_STORM, WEATHER_NONE, 0).waves) / 2, 6);
    });
});

describe('the waves under a weather', () => {
    it('stand as the bodies say with no weather', () => {
        expect(waveParamsOf(zone).height).toBe(1);
        expect(waveParamsOf(zone).length).toBe(zone.waveLength);
    });

    it('are scaled by the weather\'s waves, in what is drawn and what the surface answers alike', () => {
        under(WEATHER_STORM);
        expect(waveParamsOf(zone).height).toBeCloseTo(blendWeather(WEATHER_STORM, WEATHER_NONE, 0).waves, 6);
    });

    it('are left alone by a weather that does not drive the wind', () => {
        under(WEATHER_STORM, WeatherDrive.All & ~WeatherDrive.Wind);
        expect(waveParamsOf(zone).height).toBe(1);
    });
});

describe('rain on the water', () => {
    it('is the weather\'s rain, and none under a clear sky or a weather that does not drive the rain', () => {
        under(WEATHER_RAIN);
        expect(rainOnWater()).toBeGreaterThan(0);
        under(WEATHER_CLEAR);
        expect(rainOnWater()).toBe(0);
        under(WEATHER_STORM, WeatherDrive.All & ~WeatherDrive.Rain);
        expect(rainOnWater()).toBe(0);
    });

    it('is drawn, not simulated: a storm puts nothing in the ripples a zone keeps', () => {
        under(WEATHER_STORM);
        const field = new RippleField(64, 64);
        field.step(1, 10, 0.5, 1);
        expect(field.peak()).toBe(0);
    });
});

describe('how open water is to the wind', () => {
    const lake = (half: number, exposure?: number): ZoneLake => ({
        kind: 'lake', key: 1, level: 0, waveHeight: 1, shoreWidth: 1, exposure,
        outline: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }],
        toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z],
    });

    it('is whole on the sea, and on a lake the more the wider it is', () => {
        expect(exposureOf({ kind: 'ocean', key: 3, level: 0, waveHeight: 1, shoreWidth: 1 }, 100)).toBe(1);
        const pond = exposureOf(lake(20), 100), mere = exposureOf(lake(200), 100);
        expect(pond).toBeLessThan(mere);
        expect(mere).toBeLessThanOrEqual(1);
        expect(pond).toBeGreaterThan(0);
    });

    it('lets a storm raise a sheltered lake\'s waves less than the sea\'s, and changes nothing in calm weather', () => {
        under(WEATHER_CLEAR);
        expect(grown(0.2)).toBe(1);
        under(WEATHER_STORM);
        expect(grown(1)).toBeCloseTo(blendWeather(WEATHER_STORM, WEATHER_NONE, 0).waves, 6);
        expect(grown(0.2)).toBeLessThan(grown(1));
        expect(grown(0.2)).toBeGreaterThan(1);
    });

    it('is baked with the water, and the dry ground by a lake keeps the lake\'s, so its shore is not read as open sea', () => {
        const field = WaterField.bake({ minX: -40, minZ: -40, sizeX: 80, sizeZ: 80, nx: 81, nz: 81 }, [lake(20, 0.3)]);
        expect(field.sample(0, 0)!.exposure).toBeCloseTo(0.3, 3);
        expect(field.at(30, 0)!.exposure).toBeCloseTo(0.3, 3);
    });
});
