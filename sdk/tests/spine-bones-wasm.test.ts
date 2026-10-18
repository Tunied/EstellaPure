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
    describe.skipIf(!hasSideModule(moduleName))('Spine ' + version + ' bone tree', () => {
        it('names every bone with its parent first, and agrees with the per-bone queries', async () => {
            const factory = (await import(resolve(WASM_DIR, moduleName + '.js'))).default;
            const raw: SpineWasmModule = await factory({ wasmBinary: readFileSync(resolve(WASM_DIR, moduleName + '.wasm')) });
            const controller = new SpineModuleController(raw, wrapSpineModule(raw));
            const root = resolve(__dirname, '../../third_party/spine-runtimes-' + version);
            const dir = version === '2.1' ? resolve(root, 'spine-c/data') : resolve(root, 'examples/spineboy/export');
            const file = version === '2.1' ? 'spineboy.json' : 'spineboy-pro.json';
            const bytes = readFileSync(resolve(dir, file));
            const handle = controller.loadSkeleton(new Uint8Array(bytes), readFileSync(resolve(dir, 'spineboy.atlas'), 'utf8'), false);
            expect(handle).toBeGreaterThan(0);
            const id = controller.createInstance(handle);
            try {
                expect(controller.play(id, 'walk', true)).toBe(true);
                controller.update(id, 0.3);
                const bones = controller.getBoneTree(id);
                expect(bones).not.toBeNull();
                const authored = JSON.parse(bytes.toString('utf8')).bones as Array<{ name: string; parent?: string; length?: number }>;
                // The tree is the file's own bone list, in its order, with the parent each names.
                expect(bones!.map((b) => b.name)).toEqual(authored.map((b) => b.name));
                bones!.forEach((b, i) => {
                    const parent = authored[i]!.parent;
                    expect(b.parent).toBe(parent ? authored.findIndex((a) => a.name === parent) : -1);
                    expect(b.parent).toBeLessThan(i);
                    expect(b.length).toBeCloseTo(authored[i]!.length ?? 0, 3);
                });
                // Posed, not the setup pose: it matches what the single-bone queries say this frame.
                for (const b of bones!.slice(0, 12)) {
                    const at = controller.getBonePosition(id, b.name)!;
                    expect(b.x).toBeCloseTo(at.x, 4);
                    expect(b.y).toBeCloseTo(at.y, 4);
                    expect(b.degrees).toBeCloseTo(controller.getBoneRotation(id, b.name), 3);
                }
                const before = bones!.map((b) => b.x + b.y);
                controller.update(id, 0.2);
                const after = controller.getBoneTree(id)!.map((b) => b.x + b.y);
                expect(after).not.toEqual(before);
            } finally {
                controller.destroyInstance(id);
                controller.unloadSkeleton(handle);
            }
        }, 30_000);
    });
}
