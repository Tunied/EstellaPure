// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @brief Measure 1000 resident skeletons and check inactive frames cross no event ABI. */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Transform, SpineAnimation } from '../src/ecs/component';
import { SkeletalEnableMirror } from '../src/skeletal/enableSync';
import { SpineManager } from '../src/spine/SpineManager';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { CppRegistry } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM || !hasSideModule('spine38'))('resident skeletal activity costs', () => {
    it('retains 1000 instances while stopping event ABI polling for an inactive hierarchy', async () => {
        setDefaultContext(new AppContext());
        const engine = await loadWasmModule();
        const registry = new engine.Registry() as unknown as CppRegistry;
        const app = App.new(); app.connectCpp(registry, engine);
        const world = app.world;
        const raw = await loadSideModule<SpineWasmModule>('spine38');
        const cwrap = raw.cwrap.bind(raw);
        let polls = 0;
        raw.cwrap = (name, result, args) => {
            const fn = cwrap(name, result, args);
            return name === 'spine_getEventCount' ? (...values) => { polls++; return fn(...values); } : fn;
        };
        const manager = new SpineManager(engine, new Map([['3.8', async () => raw]]));
        const root = world.spawn(); world.insert(root, Transform, {});
        const fixture = resolve(__dirname, '../benchmarks/fixtures/spine/spineboy-38');
        const era: SpineEraBinding = {
            id: 'scale-spineboy', culling: { kind: 'unknown' },
            pair: { skeleton: 'spineboy.skel', atlas: 'spineboy.atlas' },
            value: {
                skelData: new Uint8Array(readFileSync(resolve(fixture, 'spineboy-pro.skel'))),
                atlasText: readFileSync(resolve(fixture, 'spineboy.atlas'), 'utf8'), isBinary: true,
                textures: new Map([['spineboy.png', { glId: 3, w: 1024, h: 1024 }]]),
            }, retain: () => ({ release: () => {} }),
        };
        try {
            for (let i = 0; i < 1000; i++) {
                const entity = world.spawn(); world.insert(entity, Transform, {});
                world.setParent(entity, root); world.insert(entity, SpineAnimation, {});
                expect(await manager.loadEntity(entity, era, registry)).toBe('3.8');
                manager.setAnimation(entity, 'walk', true);
            }
            const mirror = new SkeletalEnableMirror(SpineAnimation);
            const isActive = (e: Parameters<typeof world.isEntityActive>[0]) => world.isEntityActive(e);
            const frame = () => {
                const a = performance.now(); mirror.sync(world, manager, isActive);
                const b = performance.now(); manager.updateAnimations(1 / 60, isActive);
                const c = performance.now(); manager.collectAllEvents(isActive);
                const d = performance.now(); return [b - a, c - b, d - c, d - a];
            };
            const measure = () => {
                for (let i = 0; i < 3; i++) frame();
                polls = 0;
                const samples = Array.from({ length: 11 }, frame);
                const stageNames = ['enableMirror', 'pose', 'events', 'total'];
                return { pollsPerFrame: polls / 11, stages: Object.fromEntries(stageNames.map((name, i) => {
                    const values = samples.map(v => v[i]).sort((a, b) => a - b);
                    return [name, { minMs: values[0], medianMs: values[5] }];
                })) };
            };
            const active = measure();
            registry.setEntityEnabled!(root, false);
            const inactive = measure();
            registry.setEntityEnabled!(root, true);
            const resumed = measure();
            const report = { entities: 1000, gpuMeasured: false, active, inactive, resumed };
            const phase = process.env.ES_SKELETAL_AUDIT_PHASE;
            if (phase === 'before' || phase === 'after') writeFileSync(resolve(__dirname, `../../output/engine-audit-2026-10-11/skeletal-scale-${phase}.json`), JSON.stringify(report, null, 2));
            expect([...manager.boundEntities()]).toHaveLength(1000);
            expect(active.pollsPerFrame).toBe(1000);
            expect(inactive.pollsPerFrame).toBe(0);
            expect(resumed.pollsPerFrame).toBe(1000);
        } finally { manager.dispose(); registry.delete(); }
    }, 120_000);
});
