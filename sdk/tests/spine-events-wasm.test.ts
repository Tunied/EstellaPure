// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { SpineModuleController } from '../src/spine/SpineController';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';

for (const version of ['2.1', '3.8', '4.1', '4.2', '4.3']) {
    const moduleName = 'spine' + version.replace('.', '');
    describe.skipIf(!hasSideModule(moduleName))('Spine ' + version + ' event ownership', () => {
        it('retains separate queues across updates, decodes packed integers, and unloads safely', async () => {
            const factory = (await import(resolve(WASM_DIR, moduleName + '.js'))).default;
            const raw: SpineWasmModule = await factory({ wasmBinary: readFileSync(resolve(WASM_DIR, moduleName + '.wasm')) });
            const controller = new SpineModuleController(raw, wrapSpineModule(raw));
            const root = resolve(__dirname, '../../third_party/spine-runtimes-' + version);
            const dir = version === '2.1' ? resolve(root, 'spine-c/data') : resolve(root, 'examples/spineboy/export');
            const json = JSON.parse(readFileSync(resolve(dir, version === '2.1' ? 'spineboy.json' : 'spineboy-pro.json'), 'utf8'));
            json.events = { ...json.events, audit: { int: -7, float: 0.125, string: 'marker' } };
            json.animations.walk.events = [{ time: 0.05, name: 'audit' }];
            const handle = controller.loadSkeleton(new TextEncoder().encode(JSON.stringify(json)), readFileSync(resolve(dir, 'spineboy.atlas'), 'utf8'), false);
            expect(handle).toBeGreaterThan(0);
            const a = controller.createInstance(handle);
            const b = controller.createInstance(handle);
            try {
                controller.enableEvents(a);
                controller.enableEvents(b);
                expect(controller.play(a, 'walk', false, 2)).toBe(true);
                expect(controller.play(b, 'run', false, 1)).toBe(true);
                controller.update(a, 0.1);
                controller.update(b, 0.1);
                const aEvents = controller.collectEvents(a);
                const bEvents = controller.collectEvents(b);
                expect(aEvents).toContainEqual(expect.objectContaining({ type: 0, track: 2, animationName: 'walk' }));
                expect(aEvents).toContainEqual(expect.objectContaining({ type: 5, track: 2, intValue: -7, floatValue: 0.125, eventName: 'audit', stringValue: 'marker' }));
                expect(bEvents).toContainEqual(expect.objectContaining({ type: 0, track: 1, animationName: 'run' }));
                expect(bEvents.every(event => event.animationName === 'run')).toBe(true);
                expect(controller.collectEvents(a)).toEqual([]);
                controller.update(a, 10);
                controller.update(b, 10);
                expect(controller.collectEvents(a)).toContainEqual(expect.objectContaining({ type: 3, track: 2, animationName: 'walk' }));
                controller.destroyInstance(a);
                expect(controller.collectEvents(b)).toContainEqual(expect.objectContaining({ type: 3, track: 1, animationName: 'run' }));
                controller.unloadSkeleton(handle);
                expect(controller.collectEvents(b)).toEqual([]);
            } finally {
                controller.destroyInstance(a);
                controller.destroyInstance(b);
                controller.unloadSkeleton(handle);
            }
        }, 30_000);
    });
}
