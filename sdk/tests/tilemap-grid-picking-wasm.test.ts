// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import { createTilemapAPI } from '../src/tilemap/tilemapAPI';
import { tileCellCenter, tileCellOutline, type TileGridParams } from '../src/tilemap/tileGeometry';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const layouts: TileGridParams[] = [];
for (const orientation of [2, 3]) for (const staggerAxisX of [false, true]) {
    for (const staggerIndexEven of [false, true]) for (const hexSideLength of [0, 6, 999]) {
        for (const [tileWidth, tileHeight] of [[16, 24], [64, 32]]) {
            layouts.push({ orientation, staggerAxisX, staggerIndexEven, hexSideLength, tileWidth, tileHeight });
        }
    }
}

describe.skipIf(!HAS_WASM)('native staggered and hexagonal polygon picking', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });
    it.each(layouts)('picks polygon interiors under translation and rotation: %j', grid => {
        core.setActiveContext(null);
        const tiles = createTilemapAPI(core as EngineApi);
        tiles.initInfiniteLayer(10, grid.tileWidth, grid.tileHeight);
        tiles.setGridType(10, grid.orientation);
        tiles.setHexParams(10, grid.hexSideLength!, grid.staggerAxisX!, grid.staggerIndexEven!);
        const outline = tileCellOutline(grid);
        const probes = [{ x: 0, y: 0 }, ...outline.map(point => ({ x: point.x * .85, y: point.y * .85 })),
            ...outline.map((point, i) => ({ x: (point.x + outline[(i + 1) % outline.length].x) * .425,
                y: (point.y + outline[(i + 1) % outline.length].y) * .425 }))];
        try {
            for (const [x, y] of [[0, 0], [1, 0], [-1, -1], [64, -33], [-65, 17]]) {
                const center = tileCellCenter(grid, x, y);
                const anchor = tiles.tileToWorld(10, x, y, 0, 0);
                expect(anchor.x + grid.tileWidth * .5).toBeCloseTo(center.x, 4);
                expect(anchor.y - grid.tileHeight * .5).toBeCloseTo(center.y, 4);
                for (const rotation of [0, Math.PI / 2, -.37]) for (const probe of probes) {
                    const lx = center.x + probe.x, ly = center.y + probe.y;
                    const wx = 21 + Math.cos(rotation) * lx - Math.sin(rotation) * ly;
                    const wy = -35 + Math.sin(rotation) * lx + Math.cos(rotation) * ly;
                    expect(tiles.worldToTile(10, wx, wy, 21, -35, rotation)).toEqual({ x, y });
                }
                for (const boundary of outline) {
                    const px = center.x + boundary.x, py = center.y + boundary.y;
                    const owner = tiles.worldToTile(10, px, py, 0, 0);
                    const picked = tileCellCenter(grid, owner.x, owner.y);
                    const cross = outline.map((a, i) => {
                        const b = outline[(i + 1) % outline.length];
                        return (b.x - a.x) * (py - picked.y - a.y) - (b.y - a.y) * (px - picked.x - a.x);
                    });
                    const tolerance = .01 * Math.max(grid.tileWidth, grid.tileHeight);
                    expect(Math.min(...cross) >= -tolerance || Math.max(...cross) <= tolerance).toBe(true);
                }
            }
        } finally { tiles.destroyLayer(10); }
    });
});
