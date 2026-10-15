// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    collisionBoxes.ts
 * @brief   Shared box placement and exact merging for runtime collision and previews.
 */
import { mergeCollisionTiles } from './collisionMerge';
import { tileIdOf } from './tileBits';
import { tileCellCenter, TilemapOrientation, type TileGridLayout, type TileGridParams } from './tileGeometry';

interface CollisionBox {
    center: { x: number; y: number };
    halfExtents: { x: number; y: number };
}

export function collisionGrid(tw: number, th: number, layout?: TileGridLayout): TileGridParams {
    return { ...layout, orientation: layout?.orientation ?? 0, tileWidth: tw, tileHeight: th };
}

export function collisionBoxes(
    tiles: ArrayLike<number>, width: number, height: number, ids: Set<number>,
    grid: TileGridParams, baseX = 0, baseY = 0,
): CollisionBox[] {
    const boxes: CollisionBox[] = [];
    const append = (x: number, y: number, w: number, h: number) => {
        const start = tileCellCenter(grid, baseX + x, baseY + y);
        boxes.push({ center: { x: start.x + (w - 1) * grid.tileWidth * .5,
            y: start.y - (h - 1) * grid.tileHeight * .5 },
        halfExtents: { x: w * grid.tileWidth * .5, y: h * grid.tileHeight * .5 } });
    };
    if (grid.orientation === TilemapOrientation.Orthogonal) {
        for (const rect of mergeCollisionTiles(tiles, width, height, ids)) append(rect.col, rect.row, rect.width, rect.height);
        return boxes;
    }
    // Merge only where projected tile boxes touch along a world axis.
    const iso = grid.orientation === TilemapOrientation.Isometric;
    const dx = iso || !grid.staggerAxisX ? 1 : 0, dy = iso || grid.staggerAxisX ? 1 : 0;
    const vertical = dy === 1;
    const solid = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const id = tileIdOf(tiles[y * width + x] ?? 0);
        return id !== 0 && ids.has(id);
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!solid(x, y) || solid(x - dx, y - dy)) continue;
        let count = 1;
        while (solid(x + count * dx, y + count * dy)) count++;
        append(x, y, vertical ? 1 : count, vertical ? count : 1);
    }
    return boxes;
}
