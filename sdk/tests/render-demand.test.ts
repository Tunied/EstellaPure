// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { InputState } from '../src/input/input';
import { RenderDemand, type RenderDemandProbe } from '../src/render/renderDemand';
import { parseQualityConfig } from '../src/render/quality';

const still = (input: InputState | null = null): RenderDemandProbe =>
    ({ width: 800, height: 600, worldVersion: 1, pendingShaders: 0, input });

/** How many of `frames` frames are drawn while `probe` describes each one. */
function drawn(demand: RenderDemand, frames: number, probe: () => RenderDemandProbe): number {
    let n = 0;
    for (let i = 0; i < frames; i++) if (demand.shouldRender(probe())) ++n;
    return n;
}

describe('render on demand', () => {
    it('draws every frame while off', () => {
        const demand = new RenderDemand();
        expect(drawn(demand, 50, () => still())).toBe(50);
    });

    it('settles to nothing on a still screen, after the tail', () => {
        const demand = new RenderDemand();
        demand.enable({ tailFrames: 5 });
        // The first frame sees a size and a world it has not seen, then the tail, then silence.
        expect(drawn(demand, 100, () => still())).toBe(1 + 5);
        expect(demand.stats.skipped).toBe(94);
    });

    it('draws again for a request, a hold, a resize, a new entity and pending shaders', () => {
        const demand = new RenderDemand();
        demand.enable({ tailFrames: 2 });
        drawn(demand, 20, () => still());
        demand.request();
        expect(drawn(demand, 20, () => still())).toBe(1 + 2);
        const release = demand.hold();
        expect(drawn(demand, 10, () => still())).toBe(10);
        release();
        expect(drawn(demand, 20, () => still())).toBe(1 + 2);
        expect(drawn(demand, 20, (() => { let w = 801; return () => ({ ...still(), width: w++ }); })())).toBe(20);
        drawn(demand, 10, () => still());
        expect(demand.shouldRender({ ...still(), worldVersion: 2 })).toBe(true);
        drawn(demand, 10, () => ({ ...still(), worldVersion: 2 }));
        expect(drawn(demand, 5, () => ({ ...still(), worldVersion: 2, pendingShaders: 3 }))).toBe(5);
    });

    it('holds add up: one owner cannot release another', () => {
        const demand = new RenderDemand();
        demand.enable({ tailFrames: 1 });
        const a = demand.hold();
        const b = demand.hold();
        a(); a();
        expect(drawn(demand, 10, () => still())).toBe(10);
        b();
        expect(drawn(demand, 10, () => still())).toBe(1 + 1);
    });

    it('draws for the player: pointer moves, edges, and anything held down', () => {
        const demand = new RenderDemand();
        demand.enable({ tailFrames: 1 });
        const input = new InputState();
        drawn(demand, 10, () => still(input));
        input.mouseX = 40;
        expect(demand.shouldRender(still(input))).toBe(true);
        drawn(demand, 5, () => still(input));
        input.noteMouseDown(0);
        // A button held is a player steering something the engine cannot see move.
        expect(drawn(demand, 10, () => still(input))).toBe(10);
        input.noteMouseUp(0);
        input.clearFrameState();
        expect(drawn(demand, 10, () => still(input))).toBeLessThanOrEqual(3);
        input.noteKeyDown('ArrowRight');
        expect(drawn(demand, 10, () => still(input))).toBe(10);
        input.noteKeyUp('ArrowRight');
        input.clearFrameState();
        drawn(demand, 10, () => still(input));
        expect(demand.shouldRender(still(input))).toBe(false);
    });

    it('is configured from the package quality config', () => {
        expect(parseQualityConfig({})?.renderOnDemand).toBeFalsy();
        const on = parseQualityConfig({ renderOnDemand: true, renderOnDemandTail: 12 });
        expect(on?.renderOnDemand).toBe(true);
        expect(on?.renderOnDemandTail).toBe(12);
    });
});
