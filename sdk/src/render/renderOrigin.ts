// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    renderOrigin.ts
 * @brief   The point a frame is drawn relative to, so a world far from zero keeps its precision on the GPU.
 *
 * @details Single floats hold a position well only near zero: at 50 km from it a step is 4 mm, and the vertices of a mesh there jitter as the
 *          camera moves. The renderer takes every world position from an origin near the camera before it reaches the GPU, and the camera's
 *          view-projection is built for the same origin, so the picture is the same and the numbers in it are small. The origin is the
 *          camera's position rounded to `step`, and it stays where it is until the camera is further than `step` from it: shadow maps, the
 *          light grid and other caches that are laid out on the world's grid step only when it does, not with every frame. Off (step 0) it is
 *          zero, which changes nothing.
 */
export interface RenderOriginState {
    /** The grid the origin is rounded to, and how far the camera goes from it before it moves; 0 draws relative to the world's own zero. */
    step: number;
    x: number;
    y: number;
    z: number;
}

const state: RenderOriginState = { step: 0, x: 0, y: 0, z: 0 };
let pushed = { x: 0, y: 0, z: 0 };

/** The origin now. Read-only: it moves by {@link followRenderOrigin}. */
export function renderOrigin(): Readonly<RenderOriginState> {
    return state;
}

/** Turns the origin on (a step above 0, in world units) or off (0). Turning it off returns it to zero. */
export function setRenderOriginStep(step: number): void {
    state.step = Math.max(step, 0);
    if (state.step === 0) { state.x = 0; state.y = 0; state.z = 0; }
}

/**
 * Keeps the origin near the eye: it moves to the eye rounded to `step` once the eye is further than `step` from it. True if it moved.
 * Call it before the frame's cameras are built, with the eye the frame is drawn from.
 */
export function followRenderOrigin(eyeX: number, eyeY: number, eyeZ: number): boolean {
    const step = state.step;
    if (step <= 0) return false;
    if (Math.abs(eyeX - state.x) <= step && Math.abs(eyeY - state.y) <= step && Math.abs(eyeZ - state.z) <= step) return false;
    state.x = Math.round(eyeX / step) * step;
    state.y = Math.round(eyeY / step) * step;
    state.z = Math.round(eyeZ / step) * step;
    return true;
}

/** Hands the origin to the engine if it is not what the engine was last given. */
export function pushRenderOrigin(set: (x: number, y: number, z: number) => void): void {
    if (pushed.x === state.x && pushed.y === state.y && pushed.z === state.z) return;
    pushed = { x: state.x, y: state.y, z: state.z };
    set(state.x, state.y, state.z);
}

/** @internal Forgets what the engine was given (a new engine starts at zero). */
export function resetRenderOrigin(): void {
    state.step = 0; state.x = 0; state.y = 0; state.z = 0;
    pushed = { x: 0, y: 0, z: 0 };
}
