// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { SpineModuleController } from '../src/spine/SpineController';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';

describe.skipIf(!hasSideModule('spine42'))('PMA tint source survives every Spine blend mode', () => {
    let controller: SpineModuleController;
    const dir = resolve(__dirname, '../../third_party/spine-runtimes-4.2/examples/spineboy/export');
    beforeAll(async () => {
        const factory = (await import(resolve(WASM_DIR, 'spine42.js'))).default;
        const raw = await factory({ wasmBinary: readFileSync(resolve(WASM_DIR, 'spine42.wasm')) });
        controller = new SpineModuleController(raw, wrapSpineModule(raw));
    });
    it.each(['normal', 'additive', 'multiply', 'screen'])('reports straight and PMA color for %s', mode => {
        const index = ['normal', 'additive', 'multiply', 'screen'].indexOf(mode);
        for (const pma of [false, true]) {
            const json = JSON.parse(readFileSync(resolve(dir, 'spineboy-pro.json'), 'utf8'));
            for (const slot of json.slots) slot.blend = mode;
            const atlas = readFileSync(resolve(dir, pma ? 'spineboy-pma.atlas' : 'spineboy.atlas'), 'utf8');
            const skeleton = controller.loadSkeleton(JSON.stringify(json), atlas, false);
            expect(skeleton).toBeGreaterThan(0);
            const instance = controller.createInstance(skeleton);
            try {
                controller.setAtlasPageTexture(skeleton, 0, 7, 1024, 256);
                controller.update(instance, 0);
                const states: Array<[number, boolean | undefined]> = [];
                controller.forEachMeshBatch(instance, (_v, _i, _vc, _ic, _tex, blend, premultiplied) => states.push([blend, premultiplied]));
                expect(states.length).toBeGreaterThan(0);
                expect(states.every(([blend, premultiplied]) => blend === (pma && index < 2 ? index + 4 : index) && premultiplied === pma)).toBe(true);
            } finally { controller.destroyInstance(instance); controller.unloadSkeleton(skeleton); }
        }
    });
});
