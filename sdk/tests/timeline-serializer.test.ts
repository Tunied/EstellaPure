// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { serializeTimelineAsset, serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { WrapMode, TrackType, InterpType, TIMELINE_FORMAT_VERSION, type TimelineAsset } from '../src/timeline/TimelineTypes';

const ASSET: TimelineAsset = {
    version: TIMELINE_FORMAT_VERSION,
    type: 'timeline',
    duration: 5,
    wrapMode: WrapMode.Loop,
    tracks: [
        {
            type: TrackType.Property,
            name: 'Move',
            childPath: 'child1',
            component: 'Transform',
            channels: [{
                property: 'position.x',
                keyframes: [
                    { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                    { time: 5, value: 100, inTangent: 0, outTangent: 0 },
                ],
            }],
        },
        {
            type: TrackType.Audio,
            name: 'SFX',
            childPath: '',
            events: [{ time: 1, clip: 'a.mp3', volume: 0.8 }],
        },
        {
            type: TrackType.AnimFrames,
            name: 'Frames',
            childPath: 'fx',
            frames: [{ texture: 't0' }, { texture: 't1', duration: 0.1 }],
        },
        {
            type: TrackType.Camera,
            name: 'Shots',
            childPath: '',
            clips: [{ start: 0, duration: 2, camera: 'CamWide' }, { start: 1.5, duration: 2, camera: 'CamHero', curve: 1 }],
        },
        {
            type: TrackType.Sequence,
            name: 'Subs',
            childPath: '',
            clips: [{ start: 1, duration: 2, timeline: 'sub.estimeline', root: 'Hero', speed: 2, loop: true }],
        },
    ],
};

describe('TimelineSerializer', () => {
    it('encodes wrapMode as a string and AnimFrames under the on-disk key', () => {
        const doc = serializeTimelineAsset(ASSET) as any;
        expect(doc.version).toBe(TIMELINE_FORMAT_VERSION);
        expect(doc.wrapMode).toBe('loop');
        const frames = doc.tracks.find((t: any) => t.type === 'animFrames');
        expect(frames.animFrames).toHaveLength(2);
        expect(frames.frames).toBeUndefined();
    });

    it('round-trips through the loader (parse ∘ serialize == identity)', () => {
        const roundTripped = parseTimelineAsset(JSON.parse(serializeTimelineToJson(ASSET)));
        expect(roundTripped).toEqual(ASSET);
    });
});
