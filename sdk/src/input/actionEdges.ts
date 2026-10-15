// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface ActionEdge {
    source: 'key' | 'mouse';
    code: string | number;
    down: boolean;
    sequence: number;
}
interface EdgeState {
    readonly owner: { fixed: boolean; cancellation: number };
    sequence: number;
    readonly events: ActionEdge[];
}
const states = new WeakMap<object, EdgeState>();

function stateFor(input: object): EdgeState {
    let state = states.get(input);
    if (!state) {
        state = { owner: { fixed: false, cancellation: 0 }, sequence: 0, events: [] };
        states.set(input, state);
    }
    return state;
}

/** Ordered physical transitions, shared read-only by all maps until frame cleanup. */
export function recordActionEdge(input: object, source: ActionEdge['source'], code: ActionEdge['code'], down: boolean): void {
    const state = stateFor(input);
    const event = { source, code, down, sequence: ++state.sequence };
    state.events.push(event);
}

export function actionEdges(input: object): Readonly<EdgeState> { return stateFor(input); }

export function beginFixedActionEdges(input: object): void { stateFor(input).owner.fixed = true; }
export function endFixedActionEdges(input: object): void {
    const state = states.get(input);
    if (state) { state.owner.fixed = false; }
}

/** A claimed release cancels that source without manufacturing gameplay edges. */
export function discardActionEdges(input: object, source: ActionEdge['source'], code: ActionEdge['code']): void {
    const state = states.get(input);
    if (!state) return;
    const events = state.events;
    let keep = 0;
    for (const event of events) if (event.source !== source || event.code !== code) events[keep++] = event;
    events.length = keep;
}

export function clearActionEdges(input: object): void {
    const state = states.get(input);
    if (state) state.events.length = 0;
}

export function cancelActionEdges(input: object): void {
    const state = states.get(input);
    if (state) { state.events.length = 0; state.owner.cancellation++; }
}
