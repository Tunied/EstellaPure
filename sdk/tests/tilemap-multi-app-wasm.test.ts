// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HAS_WASM, WASM_DIR, WASM_FILE, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule } from '../src/wasm';
import { App } from '../src/app/app';
import { Transform, TilemapLayer } from '../src/ecs/component';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { TilemapAPI, Tilemaps } from '../src/tilemap/tilemapAPI';
import { isTileSolid } from '../src/tilemap/tileQuery';
import { serializeEntityComponents } from '../src/scene/scene';

let mainCore: ESEngineModule, previewCore: ESEngineModule;
const apps: App[] = [];
const registries: Array<{ delete(): void }> = [];
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    for (const registry of registries.splice(0)) registry.delete();
});
describe.skipIf(!HAS_WASM)('tilemap runtimes in independent apps', () => {
    beforeAll(async () => {
        mainCore = await loadWasmModule();
        const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
        previewCore = await factory({ wasmBinary: readFileSync(WASM_FILE) });
        mainCore.setActiveContext(null); previewCore.setActiveContext(null);
    });
    async function scene(engine: ESEngineModule, tile: number) {
        const registry = new engine.Registry(); registries.push(registry as unknown as { delete(): void });
        const app = App.new(); app.connectCpp(registry, engine); app.addPlugin(new TilemapPlugin()); apps.push(app);
        const entity = app.world.spawn(); app.world.insert(entity, Transform);
        app.world.insert(entity, TilemapLayer, { cellSize: { x: 16, y: 16 } });
        const tiles = app.getResource(Tilemaps);
        const runtime = app.getResource(TilemapRuntimeState);
        runtime.setLayerTilesets(entity, ['builtin:collision']);
        tiles.initInfiniteLayer(entity, 16, 16); tiles.setTile(entity, 0, 0, tile);
        await app.tick(1 / 60);
        return { app, entity, tiles, runtime };
    }
    it('applies fractional cell dimensions without a combined-key collision', async () => {
        const { app, entity, tiles } = await scene(mainCore, 1);
        const before = tiles.tileToWorld(entity, 1, 1, 0, 0);
        const reinitialize = vi.spyOn(tiles, 'initInfiniteLayer');
        app.world.update(entity, TilemapLayer, value => { value.cellSize = { x: 16 + 8 / 65536, y: 8 }; });
        await app.tick(1 / 60);
        expect(reinitialize).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 20; i++) await app.tick(1 / 60);
        expect(reinitialize).toHaveBeenCalledTimes(1);
        const edited = tiles.tileToWorld(entity, 1, 1, 0, 0);
        tiles.initInfiniteLayer(entity, 16 + 8 / 65536, 8);
        const rebuilt = tiles.tileToWorld(entity, 1, 1, 0, 0);
        expect(rebuilt).not.toEqual(before);
        expect(edited).toEqual(rebuilt);
        expect(tiles.getTile(entity, 0, 0)).toBe(1);
    });

    it('quitting the older app leaves the newer map and runtime alive', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        expect(main.entity).toBe(preview.entity);
        main.app.quit();
        expect(preview.tiles.getTile(preview.entity, 0, 0)).toBe(2);
        preview.tiles.setTile(preview.entity, 0, 0, 1); await preview.app.tick(1 / 60);
        expect(previewCore.tilemap_hasLayer!(preview.entity)).toBe(true);
        const colliders = (preview.runtime as unknown as { collisionEntities_: Map<number, number[]> })
            .collisionEntities_.get(preview.entity);
        expect(colliders?.length).toBeGreaterThan(0);
    });
    it('quitting the preview lets the main runtime keep rebuilding collision', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        preview.app.quit();
        main.tiles.setTile(main.entity, 0, 0, 0); await main.app.tick(1 / 60);
        main.tiles.setTile(main.entity, -1, -1, 1); await main.app.tick(1 / 60);
        const colliders = (main.runtime as unknown as { collisionEntities_: Map<number, number[]> })
            .collisionEntities_.get(main.entity);
        expect(colliders?.length).toBeGreaterThan(0);
        expect(main.tiles.getTile(main.entity, -1, -1)).toBe(1);
        expect(TilemapAPI.getTile(main.entity, -1, -1)).toBe(1);
        expect(isTileSolid(main.entity, -1, -1)).toBe(true);
    });
    it('serializes each world with its own tile chunks', async () => {
        const main = await scene(mainCore, 1), preview = await scene(previewCore, 2);
        const mainBlob = main.tiles.exportChunks(main.entity);
        const previewBlob = preview.tiles.exportChunks(preview.entity);
        expect(mainBlob).not.toBe(previewBlob);
        const saved = (scene: typeof main) => serializeEntityComponents(scene.app.world, scene.entity)
            .find(component => component.type === 'TilemapLayer')?.data.chunks;
        expect(saved(main)).toBe(mainBlob);
        expect(saved(preview)).toBe(previewBlob);
    });
    it('retires 100 previews without losing the main map or retaining native allocations', async () => {
        const main = await scene(mainCore, 1);
        const cycle = async () => {
            const preview = await scene(previewCore, 2);
            preview.app.quit(); apps.pop(); registries.pop()!.delete();
            expect(main.tiles.getTile(main.entity, 0, 0)).toBe(1);
        };
        for (let i = 0; i < 10; i++) await cycle();
        const memory = previewCore as unknown as { es_getMallocBytes(): number };
        const before = memory.es_getMallocBytes();
        for (let i = 0; i < 100; i++) await cycle();
        expect(memory.es_getMallocBytes()).toBe(before);
        main.tiles.setTile(main.entity, -1, -1, 1); await main.app.tick(1 / 60);
        expect(isTileSolid(main.entity, -1, -1)).toBe(true);
    });
});
