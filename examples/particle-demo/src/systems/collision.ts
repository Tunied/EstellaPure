import {
    defineSystem, EventReader, Mut, Query, ParticleCollisionEvent, Text,
    type EventReaderInstance, type ParticleCollisionEventPayload,
} from 'esengine';
import { CollisionCounter } from '../components';

export const collisionSystem = defineSystem(
    [EventReader(ParticleCollisionEvent), Query(Mut(CollisionCounter), Mut(Text))],
    (events: EventReaderInstance<ParticleCollisionEventPayload>, counters) => {
        const counts = new Map<number, number>();
        for (const event of events) counts.set(event.mode, (counts.get(event.mode) ?? 0) + 1);
        for (const [, counter, text] of counters) {
            counter.total += counts.get(counter.mode) ?? 0;
            text.content = `${counter.total} contacts`;
        }
    },
    { name: 'ParticleCollisionCounter' },
);
