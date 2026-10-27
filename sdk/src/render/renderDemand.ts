// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  renderDemand.ts
 * @brief Drawing only the frames that can look different: a still screen costs the game's logic and nothing else.
 *
 * A card table, a puzzle between moves, a menu: for most of a session such a game's picture does not change, and the GPU draws it sixty times a
 * second anyway, which is the heat and the battery. With render-on-demand on, a frame is drawn when
 *  - something asked for it ({@link RenderDemand.request}) or is holding the screen live ({@link RenderDemand.hold}: a tween, a video, a
 *    particle burst, anything the engine cannot see move on its own);
 *  - the player did something (a key, a button, a finger, the pointer moved, the wheel turned);
 *  - the surface changed size, or entities were created or destroyed;
 *  - shaders are still compiling in the background, which leaves draws out until they are ready.
 * and for `tailFrames` frames after the last of those, so what settles over a few frames (an exposure adapting, a blend finishing) does.
 *
 * What the engine does NOT see is a component's value changing by script or an animation playing: those are what `request` and `hold` are for.
 * That is why this is opt-in; a game that turns it on states which of its screens are still.
 */
import type { InputState } from '../input/input';

/** @experimental */
export interface RenderOnDemandOptions {
    /** Frames still drawn after the last reason to draw. Default 30: a half second, enough for an exposure or a fade to settle. */
    tailFrames?: number;
}

/** What one frame is asked about. */
export interface RenderDemandProbe {
    width: number;
    height: number;
    /** The world's structural version (entities and components added or removed). */
    worldVersion: number;
    /** Shaders still compiling in the background. */
    pendingShaders: number;
    input: InputState | null;
}

/** Everything about the player's hands that can show in a picture, folded into one number that changes when any of it does. */
export function inputSignature(input: InputState): number {
    let h = 17;
    const mix = (v: number): void => { h = (Math.imul(h, 31) + (v | 0) + ((v * 1024) | 0)) | 0; };
    mix(input.mouseX); mix(input.mouseY);
    mix(input.scrollDeltaX); mix(input.scrollDeltaY);
    mix(input.keysDown.size); mix(input.keysPressed.size); mix(input.keysReleased.size);
    mix(input.mouseButtons.size); mix(input.mouseButtonsPressed.size); mix(input.mouseButtonsReleased.size);
    mix(input.touches.size); mix(input.touchesStarted.size); mix(input.touchesEnded.size);
    for (const touch of input.touches.values()) { mix(touch.x); mix(touch.y); }
    return h;
}

/** @experimental */
export class RenderDemand {
    private enabled_ = false;
    private tailFrames_ = 30;
    private remaining_ = 0;
    private requested_ = false;
    private holds_ = 0;
    private lastWidth_ = -1;
    private lastHeight_ = -1;
    private lastWorldVersion_ = -1;
    private lastInput_ = 0;
    private drawn_ = 0;
    private skipped_ = 0;

    get enabled(): boolean { return this.enabled_; }
    /** Frames drawn and frames left out since this was turned on. */
    get stats(): { drawn: number; skipped: number } { return { drawn: this.drawn_, skipped: this.skipped_ }; }

    enable(options: RenderOnDemandOptions = {}): void {
        this.enabled_ = true;
        this.tailFrames_ = Math.max(1, Math.floor(options.tailFrames ?? 30));
        this.remaining_ = this.tailFrames_;
        this.drawn_ = this.skipped_ = 0;
    }

    disable(): void {
        this.enabled_ = false;
    }

    /** Draw the next frame (and the tail after it): something changed that the engine could not see. */
    request(): void {
        this.requested_ = true;
    }

    /**
     * Draw every frame until the returned function is called: for what moves on its own (a tween, a video, an animation). Holds add up, so two
     * owners do not release each other's.
     */
    hold(): () => void {
        ++this.holds_;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.holds_ = Math.max(0, this.holds_ - 1);
            this.requested_ = true;
        };
    }

    /** Asked once per frame, by the frame that would draw. False leaves the frame out; the screen keeps the last picture. */
    shouldRender(probe: RenderDemandProbe): boolean {
        if (!this.enabled_) return true;
        let reason = this.requested_ || this.holds_ > 0 || probe.pendingShaders > 0;
        this.requested_ = false;
        if (probe.width !== this.lastWidth_ || probe.height !== this.lastHeight_) reason = true;
        if (probe.worldVersion !== this.lastWorldVersion_) reason = true;
        if (probe.input) {
            // A held key, button or finger is a player steering something the engine cannot see move: it draws for as long as it is down.
            if (probe.input.keysDown.size > 0 || probe.input.mouseButtons.size > 0 || probe.input.touches.size > 0) reason = true;
            const signature = inputSignature(probe.input);
            if (signature !== this.lastInput_) reason = true;
            this.lastInput_ = signature;
        }
        this.lastWidth_ = probe.width;
        this.lastHeight_ = probe.height;
        this.lastWorldVersion_ = probe.worldVersion;
        if (reason) this.remaining_ = this.tailFrames_;
        else if (this.remaining_ > 0) --this.remaining_;
        else {
            ++this.skipped_;
            return false;
        }
        ++this.drawn_;
        return true;
    }
}
