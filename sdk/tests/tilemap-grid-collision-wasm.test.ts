// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, TilemapLayer, Parent, RuntimeOnly } from '../src/ecs/component';
import { Tilemap } from '../src/tilemap/components';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { Tilemaps } from '../src/tilemap/tilemapAPI';
import { tileCellCenter } from '../src/tilemap/tileGeometry';
import { Physics2DPlugin } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { Assets } from '../src/asset/Assets';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
import type { ESEngineModule, CppResourceManager } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

let core: ESEngineModule;
const apps: App[] = [], cleanup: Array<() => void> = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); for (const fn of cleanup.splice(0).reverse()) fn(); shutdownResourceManager(); vi.restoreAllMocks(); });
function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app);
    app.connectCpp(new core.Registry(), core, { ownedRegistry: true }); app.addPlugin(new TilemapPlugin());
    return { app, world: app.world, tiles: app.getResource(Tilemaps), runtime: app.getResource(TilemapRuntimeState) };
}
function generated(app: App, layer: number) {
    return (app.getResource(TilemapRuntimeState) as unknown as { collisionEntities_: Map<number, number[]> }).collisionEntities_.get(layer)!;
}
describe.skipIf(!HAS_WASM)('projected tile collision ownership', () => {
    beforeAll(async () => { core = await loadWasmModule(); });
    it.each([0, 1, 2, 3])('updates layout %s and shifts origin without replacing stable colliders', async orientation => {
        const { app, world, tiles, runtime } = scene(), layer = world.spawn();
        world.insert(layer, Transform); world.insert(layer, TilemapLayer, { cellSize: { x: 16, y: 24 }, orientation, hexSideLength: 6 });
        runtime.setLayerTilesets(layer, ['builtin:collision']); tiles.initInfiniteLayer(layer, 16, 24); tiles.setTile(layer, 3, 2, 1);
        await app.tick(1 / 60);
        const original = [...generated(app, layer)], expected = tileCellCenter({ orientation, tileWidth: 16, tileHeight: 24, hexSideLength: 6 }, 3, 2);
        expect(original).toHaveLength(1);
        expect(world.get(original[0], Transform).position).toMatchObject(expected);
        const exported = vi.spyOn(tiles, 'exportChunks');
        world.update(layer, TilemapLayer, value => { value.originOffset = { x: 7, y: -3 }; });
        await app.stepFrames(3, 1 / 60);
        expect(generated(app, layer)).toEqual(original); expect(exported).not.toHaveBeenCalled();
        expect(world.get(original[0], Transform).position).toMatchObject({ x: expected.x + 7, y: expected.y - 3 });
        world.update(layer, TilemapLayer, value => { value.orientation = (orientation + 1) % 4; });
        await app.tick(1 / 60);
        expect(generated(app, layer)).not.toEqual(original); expect(exported).toHaveBeenCalledOnce();
        expect(world.valid(original[0])).toBe(false);
        const next = tileCellCenter({ orientation: (orientation + 1) % 4, tileWidth: 16, tileHeight: 24, hexSideLength: 6 }, 3, 2);
        expect(world.get(generated(app, layer)[0], Transform).position).toMatchObject({ x: next.x + 7, y: next.y - 3 });
    });

    it.each([false, true])('derives imported colliders under their actual layer (infinite=%s)', async infinite => {
        registerTilemapSupport();
        const { app, world, tiles } = scene();
        // Collision-only fixture: image loading fails before any GPU allocation.
        initResourceManager({ acquireTextureByPath: () => 0, invalidateTexturePath: () => false,
            releaseTexture: () => {} } as unknown as CppResourceManager);
        const document = JSON.stringify({ orientation: 'hexagonal', hexsidelength: 6, staggeraxis: 'x', staggerindex: 'even',
            width: 4, height: 3, tilewidth: 16, tileheight: 24, infinite,
            tilesets: [{ firstgid: 1, name: 'collision', image: '', columns: 1, tilecount: 1,
                tiles: [{ id: 0, properties: [{ name: 'collision', value: true }] }] }],
            layers: [{ type: 'tilelayer', name: 'ground', width: 4, height: 3,
                ...(infinite ? { chunks: [{ x: 3, y: 2, width: 1, height: 1, data: [1] }] }
                    : { data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }) }] });
        const assets = Assets.create({ module: core, backend: { fetchText: async () => document,
            fetchBinary: async () => { throw Error('Collision-only fixture has no texture'); }, resolveUrl: path => path } });
        cleanup.push(() => assets.releaseAll()); app.insertResource(AssetsResource, assets);
        const held = await assets.acquireTyped('tilemap', 'collision.tmj'); cleanup.push(() => held.release());
        const owner = world.spawn(); world.insert(owner, Transform); world.insert(owner, Tilemap, { source: 'collision.tmj' });
        await app.stepFrames(3, 1 / 60);
        const layer = world.getEntitiesWithComponents([TilemapLayer]).find(id => world.has(id, RuntimeOnly))!;
        expect(layer).toBeDefined();
        const component = world.get(layer, TilemapLayer);
        expect(component.orientation).toBe(3); expect(component.staggerAxis).toBe(1); expect(component.staggerIndex).toBe(1);
        const colliders = [...generated(app, layer)]; expect(colliders).toHaveLength(1);
        expect(world.get(colliders[0], Parent).entity).toBe(layer);
        const exported = vi.spyOn(tiles, 'exportChunks');
        world.update(layer, Transform, value => { value.position.x = 40; }); await app.stepFrames(2, 1 / 60);
        world.ensureTransformsComposed();
        expect(generated(app, layer)).toEqual(colliders); expect(exported).not.toHaveBeenCalled();
        const center = tileCellCenter({ orientation: 3, tileWidth: 16, tileHeight: 24, hexSideLength: 6, staggerAxisX: true, staggerIndexEven: true }, 3, 2);
        expect(world.get(colliders[0], Transform).worldPosition.x).toBeCloseTo(center.x + 40, 4);
        const anchor = tiles.tileToWorld(layer, 3, 2, 0, 0);
        expect(anchor.x + 8).toBeCloseTo(center.x, 4); expect(anchor.y - 12).toBeCloseTo(center.y, 4);
        world.update(layer, TilemapLayer, value => { value.originOffset = { x: 7, y: -3 }; });
        await app.stepFrames(2, 1 / 60); world.ensureTransformsComposed();
        expect(generated(app, layer)).toEqual(colliders); expect(exported).not.toHaveBeenCalled();
        expect(world.get(colliders[0], Transform).worldPosition.x).toBeCloseTo(center.x + 47, 4);
        world.update(layer, TilemapLayer, value => { value.orientation = 1; }); await app.tick(1 / 60);
        expect(generated(app, layer)).not.toEqual(colliders); expect(world.valid(colliders[0])).toBe(false);
        const replacement = generated(app, layer)[0];
        world.remove(owner, Tilemap); await app.tick(1 / 60);
        expect(world.valid(layer)).toBe(false); expect(world.valid(replacement)).toBe(false);
    });
});

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('projected tile collision in Box2D', () => {
    beforeAll(async () => { core = await loadWasmModule(); });
    it.each([0, 1, 2, 3])('lands a body on the rendered layout %s tile under parent rotation', async orientation => {
        const { app, world, tiles, runtime } = scene(), angle = .37, nx = -Math.sin(angle), ny = Math.cos(angle);
        const module = await loadSideModule<PhysicsWasmModule>('physics');
        app.addPlugin(new Physics2DPlugin('', { gravity: { x: -nx * 9.81, y: -ny * 9.81 } }, async () => module));
        await app.getResource(Physics2DRuntime).initPromise;
        const parent = world.spawn(), layer = world.spawn();
        const rotation = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
        world.insert(parent, Transform, { position: { x: 20, y: -35, z: 0 }, rotation });
        world.insert(layer, Transform); world.setParent(layer, parent);
        world.insert(layer, TilemapLayer, { cellSize: { x: 16, y: 24 }, orientation, hexSideLength: 6, originOffset: { x: 3, y: -2 } });
        runtime.setLayerTilesets(layer, ['builtin:collision']); tiles.initInfiniteLayer(layer, 16, 24); tiles.setTile(layer, 3, 2, 1);
        await app.stepFrames(3, 1 / 60);
        const local = tileCellCenter({ orientation, tileWidth: 16, tileHeight: 24, hexSideLength: 6 }, 3, 2);
        const center = { x: 20 + Math.cos(angle) * (local.x + 3) - Math.sin(angle) * (local.y - 2),
            y: -35 + Math.sin(angle) * (local.x + 3) + Math.cos(angle) * (local.y - 2) };
        const hit = app.getResource(Physics2D).raycast({ x: center.x + nx * 40, y: center.y + ny * 40 }, { x: -nx, y: -ny }, 80)
            .find(value => value.entity === generated(app, layer)[0]);
        expect(hit).toBeDefined(); expect(hit!.point.x).toBeCloseTo(center.x + nx * 12, 2); expect(hit!.point.y).toBeCloseTo(center.y + ny * 12, 2);
        const actor = world.spawn();
        world.insert(actor, Transform, { position: { x: center.x + nx * 40, y: center.y + ny * 40, z: 0 }, rotation });
        world.insert(actor, RigidBody2D, { bodyType: BodyType.Dynamic, fixedRotation: true });
        world.insert(actor, BoxCollider2D, { halfExtents: { x: .02, y: .02 } });
        await app.stepFrames(120, 1 / 60);
        const position = world.get(actor, Transform).worldPosition;
        const distance = (position.x - center.x) * nx + (position.y - center.y) * ny;
        expect(distance).toBeGreaterThan(12); expect(distance).toBeLessThan(20);
    });
});
