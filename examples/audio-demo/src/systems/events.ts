import {
    defineResource, defineSystem, Query, Mut, Res, ResMut, GetWorld,
    Input, UIEvents, Text, SoundEvents, SoundEventSource,
    triggerSoundEventSource, stopSoundEventSource,
} from 'esengine';
import { EventPad, EventStatusLabel } from '../components';

// Per-App counters, with no retained trigger history or second voice pool.
const EventReadout = defineResource({
    revision: 0, epoch: 0, selectionRevision: 0, attempts: 0, cancelled: 0,
    selection: 'No event selected', last: 'Ready',
}, 'AudioEventDemo');
const NAMES = ['Footsteps', 'Button', 'Collision'];

export const eventSystem = defineSystem(
    [Query(EventPad, SoundEventSource), Query(Mut(Text), EventStatusLabel),
        Res(Input), Res(UIEvents), Res(SoundEvents), ResMut(EventReadout), GetWorld()],
    (pads, labels, input, ui, playback, readout, world) => {
        const clicks = ui.query('click');
        const stopping = input.isKeyPressed('Digit0');
        for (const [entity, pad] of pads) {
            if (stopping) {
                stopSoundEventSource(world, entity);
                continue;
            }
            const clicked = clicks.some((event) => event.target === entity);
            const count = pad.index === 2
                ? (input.isKeyDown('Digit7') ? 8 : clicked ? 16 : 0)
                : (input.isKeyPressed(`Digit${pad.index + 5}`) || clicked ? 1 : 0);
            for (let i = 0; i < count; i++) {
                readout.modify((state) => { state.attempts++; state.revision++; });
                const serial = readout.get().revision;
                const epoch = readout.get().epoch;
                void triggerSoundEventSource(world, entity).then(async (handle) => {
                    if (!handle) {
                        readout.modify((state) => { state.cancelled++; });
                        return;
                    }
                    await handle.ready;
                    if (readout.get().epoch !== epoch) return;
                    const selection = handle.selection;
                    readout.modify((state) => {
                        // Keep the latest selected parameters visible even if
                        // the following attempts are rejected before selection.
                        if (selection && serial > state.selectionRevision) {
                            state.selectionRevision = serial;
                            state.selection = `${NAMES[pad.index]} slot ${selection.slot + 1} | volume ${selection.volume.toFixed(2)} | rate ${selection.playbackRate.toFixed(2)}`;
                        }
                        if (state.revision === serial) state.last = handle.reason ?? handle.status;
                    });
                }).catch((error: unknown) => {
                    if (readout.get().revision === serial) {
                        readout.modify((state) => { state.last = String(error); });
                    }
                });
            }
        }
        if (stopping) {
            // Invalidate any pending readout as well as the owned event voices.
            readout.modify((state) => { state.epoch++; state.revision++; state.last = 'Stopped'; });
        }
        const stats = playback.getStats();
        const state = readout.get();
        const content = `${state.selection} | ${state.last}\nAttempts ${state.attempts} | played ${stats.played} | rejected ${stats.rejected} | active ${stats.active} | pending ${stats.pendingClips} | cancelled ${state.cancelled}`;
        for (const [, text] of labels) {
            if (text.content !== content) text.content = content;
        }
    },
    { name: 'AudioEventSystem', touches: { reads: [EventPad._name, SoundEventSource._name] } },
);
