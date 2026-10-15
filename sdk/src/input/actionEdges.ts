// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface ActionEdge {
    source: 'key' | 'mouse';
    code: string | number;
    down: boolean;
    sequence: number;
}
interface EdgeState {
    readonly owner: object;
    sequence: number;
    readonly events: ActionEdge[];
}
const states = new WeakMap<object, EdgeState>();

/** Ordered physical transitions, shared read-only by all maps until frame cleanup. */
export function recordActionEdge(input: object, source: ActionEdge['source'], code: ActionEdge['code'], down: boolean): void {
    let state = states.get(input);
    if (!state) { state = { owner: {}, sequence: 0, events: [] }; states.set(input, state); }
    state.events.push({ source, code, down, sequence: ++state.sequence });
}

export function actionEdges(input: object): Readonly<EdgeState> | undefined { return states.get(input); }

/** A claimed release cancels that source without manufacturing gameplay edges. */
export function discardActionEdges(input: object, source: ActionEdge['source'], code: ActionEdge['code']): void {
    const events = states.get(input)?.events;
    if (!events) return;
    let keep = 0;
    for (const event of events) if (event.source !== source || event.code !== code) events[keep++] = event;
    events.length = keep;
}

export function clearActionEdges(input: object): void {
    const state = states.get(input);
    if (state) state.events.length = 0;
}
