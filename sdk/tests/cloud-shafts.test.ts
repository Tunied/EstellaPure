// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The fog's beams standing where the sky's clouds let the sun through: what the fog is told of the sky.
 */
import { describe, it, expect } from 'vitest';
import { applyCloudsToFog } from '../src/postprocess/cloudShafts';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';
import '../src/postprocess/effects';

const effect = (uniforms: Record<string, number> = {}, enabled = true): BlendedEffect => ({
    enabled, uniforms: new Map(Object.entries(uniforms)), textures: new Map(), colors: new Map(),
});

describe('applyCloudsToFog', () => {
    it('copies the sky\'s cloud layer onto a fog that asks for cloud shafts, with the wind as a velocity in kilometres a second', () => {
        const fog = effect({ u_cloudShade: 0.8 });
        const sky = effect({ u_cloudShadow: 0.6, u_clouds: 0.4, u_overcast: 0.5, u_cloudBase: 2, u_cloudThickness: 3, u_unitsPerKm: 100000, u_windSpeed: 0.1, u_windDirection: 90 });
        applyCloudsToFog(new Map([['heightFog', fog], ['skyAtmosphere', sky]]));
        // An overcast of half is a cover of 0.475, above the sky's own 0.4.
        expect(fog.uniforms.get('u_skyCover')).toBeCloseTo(0.475, 6);
        expect(fog.uniforms.get('u_skyBase')).toBe(2);
        expect(fog.uniforms.get('u_skyThickness')).toBe(3);
        expect(fog.uniforms.get('u_skyUnits')).toBe(100000);
        expect(fog.uniforms.get('u_skySigma')).toBeCloseTo(1.3 * 1.75, 6);
        expect(fog.uniforms.get('u_skyWindX')).toBeCloseTo(0.1, 6);
        expect(fog.uniforms.get('u_skyWindZ')).toBeCloseTo(0, 6);
    });

    it('leaves the fog with no clouds without Cloud Shafts, a sky, or clouds that cast shadows', () => {
        const cases: [BlendedEffect, BlendedEffect | undefined][] = [
            [effect({ u_cloudShade: 0 }), effect({ u_cloudShadow: 0.6 })],
            [effect({ u_cloudShade: 1 }), undefined],
            [effect({ u_cloudShade: 1 }), effect({ u_cloudShadow: 0 })],
            [effect({ u_cloudShade: 1 }), effect({ u_cloudShadow: 0.6 }, false)],
        ];
        for (const [fog, sky] of cases) {
            applyCloudsToFog(new Map(sky ? [['heightFog', fog], ['skyAtmosphere', sky]] : [['heightFog', fog]]));
            expect(fog.uniforms.get('u_skyCover')).toBe(0);
        }
    });

    it('does nothing for a scene with no fog', () => {
        const sky = effect({ u_cloudShadow: 0.6 });
        expect(() => applyCloudsToFog(new Map([['skyAtmosphere', sky]]))).not.toThrow();
    });
});
