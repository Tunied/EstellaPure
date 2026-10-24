// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { waveParamsOf, rainOnRipples } from '../src/water/waterPlugin';
import { WaterZone } from '../src/water/zone';
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

describe('rain on water that keeps ripples', () => {
    const disturbed = (field: RippleField): number => {
        let n = 0;
        for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) if (field.heightAt((i + 0.5) / 64 * field.size, (j + 0.5) / 64 * field.size) !== 0) n++;
        return n;
    };

    it('falls as drops over the window while it rains', () => {
        const field = new RippleField(64, 64);
        under(WEATHER_RAIN);
        rainOnRipples(field, 0.5);
        expect(disturbed(field)).toBeGreaterThan(0);
    });

    it('is none under a clear sky, or when the weather does not drive the rain', () => {
        const clear = new RippleField(64, 64);
        under(WEATHER_CLEAR);
        rainOnRipples(clear, 1);
        expect(disturbed(clear)).toBe(0);
        const off = new RippleField(64, 64);
        under(WEATHER_STORM, WeatherDrive.All & ~WeatherDrive.Rain);
        rainOnRipples(off, 1);
        expect(disturbed(off)).toBe(0);
    });

    it('carries part of a drop from one frame to the next, so a slow frame rate rains as hard', () => {
        const field = new RippleField(64, 64);
        under(WEATHER_RAIN);
        for (let k = 0; k < 10; k++) rainOnRipples(field, 0.001);
        expect(field.rainOwed).toBeGreaterThan(0);
        expect(field.rainOwed).toBeLessThan(1.5);
    });
});
