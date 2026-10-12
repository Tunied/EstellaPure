// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { ParticleAPI } from '../src/particle/ParticleAPI';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import type { CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';

it.each([
    ['setColorLut', 'particle_set_color_lut', 4],
    ['setSizeLut', 'particle_set_size_lut', 1],
    ['setSpeedLut', 'particle_set_speed_lut', 1],
] as const)('%s uploads to the current heap after allocation grows WASM memory', (method, entry, stride) => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
    const original = new Float32Array(memory.buffer), lut = new Float32Array(stride * 2).fill(.5);
    let uploaded: number[] = [];
    const fn = vi.fn((_entity: number, ptr: number, count: number) => {
        uploaded = Array.from(new Float32Array(memory.buffer, ptr, count * stride));
    });
    const free = vi.fn();
    const module = { _malloc: vi.fn(() => { memory.grow(1); return 16; }), _free: free,
        get HEAPF32() { return new Float32Array(memory.buffer); }, [entry]: fn } as unknown as EngineApi;
    const api = new ParticleAPI(module, {} as CppRegistry);
    api[method](1 as Entity, lut);
    expect(original.byteLength).toBe(0); expect(uploaded).toEqual(Array.from(lut));
    expect(fn).toHaveBeenCalledWith(1, 16, 2); expect(free).toHaveBeenCalledWith(16);
});
it('frees upload memory when the native LUT setter throws', () => {
    const free = vi.fn(), failure = Error('LUT rejected');
    const module = { _malloc: vi.fn(() => 16), _free: free, HEAPF32: new Float32Array(32),
        particle_set_size_lut: vi.fn(() => { throw failure; }) } as unknown as EngineApi;
    const api = new ParticleAPI(module, {} as CppRegistry);
    expect(() => api.setSizeLut(1 as Entity, new Float32Array([1, .5]))).toThrow(failure);
    expect(free).toHaveBeenCalledOnce();
});
it('preserves a LUT borrowed from the heap before allocation detaches its source', () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
    const lut = new Float32Array(memory.buffer, 0, 3); lut.set([1, .5, 0]);
    let uploaded: number[] = [];
    const fn = vi.fn((_entity: number, ptr: number, count: number) => {
        uploaded = Array.from(new Float32Array(memory.buffer, ptr, count));
    });
    const module = { _malloc: vi.fn(() => { memory.grow(1); return 16; }), _free: vi.fn(),
        get HEAPF32() { return new Float32Array(memory.buffer); }, particle_set_size_lut: fn } as unknown as EngineApi;
    new ParticleAPI(module, {} as CppRegistry).setSizeLut(1 as Entity, lut);
    expect(uploaded).toEqual([1, .5, 0]); expect(fn).toHaveBeenCalledWith(1, 16, 3);
});
