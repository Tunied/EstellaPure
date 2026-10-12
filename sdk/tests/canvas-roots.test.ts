// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it } from 'vitest';
import { canvasRootEntities } from '../src/ui/core/canvas-roots';

it('selects independent outer canvases in input order across ordinary scene groups', () => {
    const parents = new Map([[1, 2], [2, 3], [4, 3]]);
    expect(canvasRootEntities([1, 5, 3, 4], entity => parents.get(entity) ?? null)).toEqual([5,3]);
});
it('memoizes common ancestor chains rather than walking them once per canvas', () => {
    const parents = new Map<number,number>();
    for (let id = 0; id < 10000; id++) parents.set(id, id + 1);
    const canvases = Array.from({ length: 1000 }, (_, index) => index + 20000);
    for (const canvas of canvases) parents.set(canvas, 0);
    let calls = 0;
    expect(canvasRootEntities(canvases, entity => { calls++; return parents.get(entity) ?? null; })).toEqual(canvases);
    expect(calls).toBeLessThan(12000);
});
it('stops malformed ancestor cycles and leaves the input untouched', () => {
    const parents = new Map([[1, 7], [7, 8], [8, 7]]), candidates = [1, 2];
    expect(canvasRootEntities(candidates, entity => parents.get(entity) ?? null)).toEqual([1,2]);
    expect(candidates).toEqual([1,2]);
});
