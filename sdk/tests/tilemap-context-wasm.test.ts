// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('headless tilemap context bindings', () => {
    let engine: ESEngineModule;
    beforeAll(async () => {
        engine = await loadWasmModule();
        expect(typeof engine.tilemap_initLayer).toBe('function');
    });

    it('reads, exports and imports tile data without initializing a renderer', () => {
        engine.setActiveContext(null);
        engine.tilemap_initLayer!(10, 8, 8, 16, 16);
        engine.tilemap_initLayer!(11, 8, 8, 16, 16);
        try {
            engine.tilemap_setTile!(10, 2, 3, 7);
            expect(engine.tilemap_getTile!(10, 2, 3)).toBe(7);
            const blob = engine.tilemap_exportChunks!(10);
            expect(blob.length).toBeGreaterThan(0);
            expect(engine.tilemap_importChunks!(11, blob)).toBe(true);
            expect(engine.tilemap_getTile!(11, 2, 3)).toBe(7);
        } finally {
            engine.tilemap_destroyLayer!(10);
            engine.tilemap_destroyLayer!(11);
        }
    });

    it('keeps identical layer handles isolated between headless engine contexts', () => {
        const first = new engine.EstellaContext();
        const second = new engine.EstellaContext();
        try {
            engine.setActiveContext(first);
            engine.tilemap_initLayer!(10, 8, 8, 16, 16);
            engine.tilemap_setTile!(10, 2, 3, 7);
            engine.setActiveContext(second);
            engine.tilemap_initLayer!(10, 8, 8, 16, 16);
            engine.tilemap_setTile!(10, 2, 3, 9);
            expect(engine.tilemap_getTile!(10, 2, 3)).toBe(9);
            engine.setActiveContext(first);
            expect(engine.tilemap_getTile!(10, 2, 3)).toBe(7);
        } finally {
            engine.setActiveContext(null);
            first.delete();
            second.delete();
        }
    });
});
