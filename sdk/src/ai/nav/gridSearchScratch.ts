// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { NavGrid } from './NavGrid';
import { MinHeap } from './minHeap';

export interface GridSearchScratch {
    gScore: Float64Array;
    cameFrom: Int32Array;
    seen: Uint32Array;
    closed: Uint32Array;
    heap: MinHeap;
    epoch: number;
    leased: boolean;
}

const buffers = new WeakMap<NavGrid, GridSearchScratch>();
const create = (count: number): GridSearchScratch => ({
    gScore: new Float64Array(count), cameFrom: new Int32Array(count),
    seen: new Uint32Array(count), closed: new Uint32Array(count),
    heap: new MinHeap(count), epoch: 0, leased: false,
});

/** Reentrant queries get private temporary storage while the grid's buffer is leased. */
export function leaseGridSearch(grid: NavGrid): GridSearchScratch {
    let state = buffers.get(grid);
    if (!state) {
        state = create(grid.width * grid.height);
        buffers.set(grid, state);
    } else if (state.leased) {
        state = create(grid.width * grid.height);
    }
    state.leased = true;
    state.epoch = (state.epoch + 1) >>> 0;
    if (state.epoch === 0) {
        state.seen.fill(0); state.closed.fill(0);
        state.epoch = 1;
    }
    state.heap.size = 0;
    return state;
}

/** Returned routes contain cell objects, so no caller retains these working arrays. */
export function releaseGridSearch(state: GridSearchScratch): void {
    state.leased = false;
}
