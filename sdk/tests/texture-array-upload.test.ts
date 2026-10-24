// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { createTextureArrayFromPixels } from '../src/runtime/runtimeAssets';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../src/wasm';

function harness() {
    const heap = new Uint8Array(1024);
    const module = { HEAPU8: heap, _malloc: vi.fn(() => 64), _free: vi.fn() } as unknown as ESEngineModule;
    let seen: Uint8Array | null = null;
    const createTextureArray = vi.fn((_w: number, _h: number, _l: number, ptr: number, len: number) => {
        seen = heap.slice(ptr, ptr + len);
        return 7;
    });
    return { module, rm: { createTextureArray } as unknown as CppResourceManager, createTextureArray, seen: () => seen };
}

describe('createTextureArrayFromPixels', () => {
    it('lays the layers back to back and passes createTextureEx codes', () => {
        const h = harness();
        const layers = [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2), new Uint8Array(16).fill(3)];
        const handle = createTextureArrayFromPixels(h.module, { width: 2, height: 2, layers }, TextureContent.Retained,
            { filterMode: 'linear', wrapMode: 'repeat', mipmaps: true, srgb: false }, h.rm);
        expect(handle).toBe(7);
        expect(h.createTextureArray).toHaveBeenCalledWith(2, 2, 3, 64, 48, 1, 3, 0, TextureContent.Retained);
        expect([...h.seen()!]).toEqual([...layers[0]!, ...layers[1]!, ...layers[2]!]);
        expect(h.module._free).toHaveBeenCalledWith(64);
    });

    it('refuses a layer of the wrong size before touching the heap', () => {
        const h = harness();
        expect(() => createTextureArrayFromPixels(h.module, { width: 2, height: 2, layers: [new Uint8Array(16), new Uint8Array(12)] },
            TextureContent.Retained, undefined, h.rm)).toThrow(/2x2 RGBA8/);
        expect(h.module._malloc).not.toHaveBeenCalled();
    });
});
