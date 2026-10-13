// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { SceneManagerState } from '../src/scene/sceneManager';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('scene completion failure on real WASM', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    it('reports the callback error after swapping and releases the switch lock', async () => {
        const app = App.new();
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const manager = new SceneManagerState(app);
        try {
            for (const name of ['first', 'second', 'third'])
                manager.register({ name, setup: ctx => { ctx.spawn(); } });
            const first = await manager.load('first');
            const previous = [...first.entities][0];
            const error = new Error('completion failed');
            let outcome: unknown;
            let settled = false;
            const failed = manager.switchTo('second', { transition: 'fade', duration: .1,
                onComplete: () => { throw error; } }).catch(value => { outcome = value; }).finally(() => { settled = true; });
            for (let i = 0; i < 100 && !settled; i++) {
                expect(() => manager.updateTransition(1 / 30)).not.toThrow();
                await Promise.resolve();
            }
            expect(settled).toBe(true); await failed;
            expect(outcome).toBe(error);
            expect(manager.getActive()).toBe('second');
            expect(app.world.valid(previous)).toBe(false);
            expect(app.world.getAllEntities()).toHaveLength(1);
            settled = false;
            const next = manager.switchTo('third', { transition: 'fade', duration: .1 })
                .finally(() => { settled = true; });
            for (let i = 0; i < 100 && !settled; i++) {
                manager.updateTransition(1 / 30); await Promise.resolve();
            }
            expect(settled).toBe(true); await next;
            expect(manager.getActive()).toBe('third');
            expect(app.world.getAllEntities()).toHaveLength(1);
        } finally { app.quit(); }
    });
});
