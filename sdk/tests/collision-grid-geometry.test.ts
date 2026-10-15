// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { collisionBoxes } from '../src/tilemap/collisionBoxes';
import { tileCellCenter, type TileGridParams } from '../src/tilemap/tileGeometry';

const grids: TileGridParams[] = [];
for (const orientation of [0, 1, 2, 3]) for (const staggerAxisX of [false, true]) {
    for (const staggerIndexEven of [false, true]) grids.push({ orientation, staggerAxisX, staggerIndexEven,
        tileWidth: 16, tileHeight: 24, hexSideLength: 6 });
}
describe('projected collision box merging', () => {
    it.each(grids)('preserves the exact union of authored boxes: %j', grid => {
        const cells = new Uint16Array([1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1]);
        const boxes = collisionBoxes(cells, 4, 4, new Set([1]), grid, -32, -48);
        const originals = [...cells].flatMap((id, i) => id ? [tileCellCenter(grid, -32 + i % 4, -48 + Math.floor(i / 4))] : []);
        const minX = Math.min(...originals.map(p => p.x)) - 10, maxX = Math.max(...originals.map(p => p.x)) + 10;
        const minY = Math.min(...originals.map(p => p.y)) - 14, maxY = Math.max(...originals.map(p => p.y)) + 14;
        for (let y = minY; y <= maxY; y += 2.3) for (let x = minX; x <= maxX; x += 2.7) {
            const expected = originals.some(p => Math.abs(x - p.x) <= 8 && Math.abs(y - p.y) <= 12);
            const actual = boxes.some(box => Math.abs(x - box.center.x) <= box.halfExtents.x && Math.abs(y - box.center.y) <= box.halfExtents.y);
            expect(actual).toBe(expected);
        }
    });
    it.each(grids)('keeps dense chunk body counts bounded: %j', grid => {
        const cells = new Uint16Array(256).fill(1);
        const boxes = collisionBoxes(cells, 16, 16, new Set([1]), grid);
        expect(boxes.length).toBeGreaterThan(0);
        expect(boxes.length).toBeLessThanOrEqual(32);
        if (grid.orientation === 0) expect(boxes).toHaveLength(1);
    });
});
