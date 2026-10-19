// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineEvent, type EventDef } from '../ecs/event';
import type { Entity } from '../types';

/** A bounded contact in project world units; body is INVALID_ENTITY for a plane. @beta */
export interface ParticleCollisionEventPayload {
    emitter: Entity; particle: number; body: Entity; mode: number;
    x: number; y: number; z: number;
    normalX: number; normalY: number; normalZ: number;
    velocityX: number; velocityY: number; velocityZ: number;
}
/** Read with EventReader; like other engine events, contacts are readable next frame. @beta */
export const ParticleCollisionEvent: EventDef<ParticleCollisionEventPayload> = defineEvent('ParticleCollisionEvent', {
    emitter: 0 as Entity, particle: 0, body: 0xffffffff as Entity, mode: 0,
    x: 0, y: 0, z: 0, normalX: 0, normalY: 1, normalZ: 0, velocityX: 0, velocityY: 0, velocityZ: 0,
});
/** One emitter's latest completed update. Events count accepted notifications/sub-bursts. @beta */
export interface ParticleCollisionStats {
    emitter: Entity; queries: number; hits: number; budgetSkipped: number; distanceSkipped: number;
    unavailable: number; events: number; eventDropped: number; fallbacks: number; mode: number;
}
/** App-wide limits, shared fairly by all scene emitters. Zero disables that work. @beta */
export interface ParticleCollisionBudget { queries: number; events: number }
