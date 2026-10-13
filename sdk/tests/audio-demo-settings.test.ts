// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { parseBusVolumes } from '../../examples/audio-demo/src/volumeSettings';

it('restores all three bus settings and preserves mute', () => {
    expect(parseBusVolumes({ master: 0, music: .33, sfx: .66 })).toEqual({ master: 0, music: .33, sfx: .66 });
});
it('rejects malformed values and bounds stored volumes', () => {
    expect(parseBusVolumes({ master: -1, music: 2, sfx: 'muted' })).toEqual({ master: 0, music: 1, sfx: 1 });
    expect(parseBusVolumes({ master: NaN, music: Infinity })).toEqual({ master: 1, music: 1, sfx: 1 });
});
it('uses defaults when no settings have been saved', () => {
    for (const stored of [undefined, null, [], false, 'bad data']) {
        expect(parseBusVolumes(stored)).toEqual({ master: 1, music: 1, sfx: 1 });
    }
});
it('retains saved values through a JSON round trip', () => {
    const values = { master: 0, music: .33, sfx: .66 };
    expect(parseBusVolumes(JSON.parse(JSON.stringify(values)))).toEqual(values);
});
