// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetGravity.ts
 * @brief   A planet pulls bodies toward its centre: the world's one gravity is taken off each body it pulls and the planet's put on, as a force.
 *
 * @details The physics world has one gravity vector, which on a round world is down only at one place. A body (a `RigidBody3D` that moves) is pulled
 *          by the nearest planet whose `gravity` is above 0: each fixed step, before the world steps, it gets the force that turns what the world
 *          would give it (`gravity * gravityScale`) into `gravity` toward the planet's centre, `mass * (g * down - world gravity * gravityScale)`.
 *          A world gravity of zero (the usual choice on a planet) makes that just the planet's pull. A planet that pulls nothing, and a world
 *          with no planet, leave every body as it was.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Transform } from '../ecs/component';
import type { Entity } from '../types';
import { PlanetRegistryRes } from '../terrain/planetQuery';
import { Physics3DRuntime } from './Physics3DPlugin';
import { RigidBody3D, type RigidBody3DData } from './Physics3DComponents';

/** The force on a body of `mass` that the planet's pull is, over the world's gravity: all in metres, kilograms and seconds. */
export function planetPullForce(
    mass: number, gravityScale: number, down: readonly [number, number, number], pull: number, world: readonly [number, number, number],
): [number, number, number] {
    return [
        mass * (down[0] * pull - world[0] * gravityScale),
        mass * (down[1] * pull - world[1] * gravityScale),
        mass * (down[2] * pull - world[2] * gravityScale),
    ];
}

/** Installs the system that pulls bodies toward the planets: every fixed step, before the world steps. */
export function installPlanetGravity(app: App): void {
    app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
        if (!app.hasResource(PlanetRegistryRes) || !app.hasResource(Physics3DRuntime)) return;
        const registry = app.getResource(PlanetRegistryRes);
        if (registry.planets.size === 0) return;
        const runtime = app.getResource(Physics3DRuntime);
        const module = runtime.module, config = runtime.config;
        if (!module?._physics3d_addForce || !module._physics3d_getBodyDynamics || !config) return;
        const ppu = config.pixelsPerUnit;
        const world: [number, number, number] = [config.gravity.x, config.gravity.y, config.gravity.z];
        for (const entity of app.world.getEntitiesWithComponents([RigidBody3D, Transform])) {
            const body = app.world.get(entity, RigidBody3D) as RigidBody3DData;
            if (!body.enabled || body.bodyType !== 2) continue;
            const id = runtime.bodies.get(entity as Entity);
            if (!id || !module._physics3d_getBodyState(id)) continue;
            const f = module.HEAPF32;
            const state = module._physics3d_queryResult() >> 2;
            const x = f[state]! * ppu, y = f[state + 1]! * ppu, z = f[state + 2]! * ppu;
            const planet = registry.nearest(x, y, z);
            if (planet === null) continue;
            const facts = registry.planets.get(planet)!;
            const up = registry.up(planet, x, y, z);
            if (facts.gravity <= 0 || !up) continue;
            if (!module._physics3d_getBodyDynamics(id)) continue;
            const mass = module.HEAPF32[module._physics3d_queryResult() >> 2]!;
            const force = planetPullForce(mass, body.gravityScale, [-up[0], -up[1], -up[2]], facts.gravity, world);
            module._physics3d_addForce(id, force[0], force[1], force[2], f[state]!, f[state + 1]!, f[state + 2]!);
        }
    }, { name: 'PlanetGravitySystem' }));
}
