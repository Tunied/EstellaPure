// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Which Ambient light is the scene's environment, read from a scene document the way the
 * frame reads it from the world: the first that is in play, enabled, lit and names an
 * environment the project holds — and every other one named, never removed.
 */
import { describe, it, expect } from 'vitest';
import {
    sceneAmbientLights, sceneEnvironment, carriesEnvironment, type EnvironmentLightEntity,
} from '../src/lightmap';

let next = 1;
function entity(name: string, light: Record<string, unknown>, visible?: boolean): EnvironmentLightEntity {
    return { id: next++, name, ...(visible === undefined ? {} : { visible }), components: [{ type: 'Light', data: light }] };
}
const AMBIENT = 2;
const ambient = (name: string, data: Record<string, unknown> = {}, visible?: boolean): EnvironmentLightEntity =>
    entity(name, { type: AMBIENT, ...data }, visible);
const all = (): boolean => true;

describe('the Ambient lights of a scene document', () => {
    it('reads only Ambient lights, in document order, and fills the component\'s defaults in', () => {
        const lights = sceneAmbientLights([
            entity('Sun', { type: 1 }), ambient('A'), ambient('B', { environment: 'b.esenv' }),
        ], all);
        expect(lights.map((l) => l.name)).toEqual(['A', 'B']);
        // Nothing was written for intensity or enabled, so the component's own defaults answer.
        expect(lights[0]).toMatchObject({ skipped: null, environment: null, drawEnvironment: false, rotation: 0 });
        expect(lights[0]!.intensity).toBeGreaterThan(0);
    });

    it('says why the frame passes over a light: hidden, switched off, or no intensity', () => {
        const lights = sceneAmbientLights([
            ambient('Hidden', { environment: 'a.esenv' }, false),
            ambient('Off', { environment: 'a.esenv', enabled: false }),
            ambient('Dark', { environment: 'a.esenv', intensity: 0 }),
            ambient('On', { environment: 'a.esenv' }),
        ], all);
        expect(lights.map((l) => l.skipped)).toEqual(['hidden', 'disabled', 'no-intensity', null]);
    });

    it('marks a named environment the project does not hold', () => {
        const [l] = sceneAmbientLights([ambient('Sky', { environment: 'gone.esenv' })], () => false);
        expect(l).toMatchObject({ environment: 'gone.esenv', environmentMissing: true });
        expect(carriesEnvironment(l!)).toBe(false);
    });
});

describe('the scene\'s environment', () => {
    const pick = (entities: EnvironmentLightEntity[], exists: (r: string) => boolean = all) =>
        sceneEnvironment(sceneAmbientLights(entities, exists));

    it('is none when no light names one', () => {
        expect(pick([ambient('Flat')]).effective).toBeNull();
        expect(pick([]).effective).toBeNull();
    });

    it('is the first light in play, skipping those the frame passes over', () => {
        const r = pick([
            ambient('Off', { environment: 'a.esenv', enabled: false }),
            ambient('Gone', { environment: 'gone.esenv' }),
            ambient('Zero', { environment: 'c.esenv', intensity: 0 }),
            ambient('Winner', { environment: 'd.esenv' }),
        ], (ref) => ref !== 'gone.esenv');
        expect(r.effective?.name).toBe('Winner');
        expect(r.shadowed).toEqual([]);
    });

    it('names the lights that lose to an earlier one, and keeps them', () => {
        const r = pick([
            ambient('First', { environment: 'a.esenv' }),
            ambient('Second', { environment: 'b.esenv' }),
            ambient('Third', { environment: 'c.esenv' }),
        ]);
        expect(r.effective?.name).toBe('First');
        expect(r.shadowed.map((l) => l.name)).toEqual(['Second', 'Third']);
    });
});
