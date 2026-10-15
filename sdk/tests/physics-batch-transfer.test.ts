// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { batchStaticPoses2D } from '../src/physics/batchStaticPoses2D';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import type { World } from '../src/ecs/world';

function heap() {
    let used = 32;
    const initial = new ArrayBuffer(64);
    const value = {
        HEAPU8: new Uint8Array(initial), HEAPU32: new Uint32Array(initial), HEAPF32: new Float32Array(initial),
        grow(bytes: number) {
            const buffer = new ArrayBuffer(bytes), u8 = new Uint8Array(buffer);
            u8.set(value.HEAPU8); value.HEAPU8 = u8; value.HEAPU32 = new Uint32Array(buffer); value.HEAPF32 = new Float32Array(buffer);
        },
        _malloc: vi.fn((bytes: number) => { const ptr = used; used += bytes; if (used > value.HEAPU8.length) value.grow(used * 2); return ptr; }),
        _free: vi.fn(),
    };
    return value;
}
function fixture(shared: boolean) {
    const core = Object.assign(heap(), {
        registry_readWorldPoses2D: vi.fn((_registry: unknown, input: number, count: number, output: number) => {
            const ids = core.HEAPU32.slice(input >>> 2, (input >>> 2) + count);
            for (let i = 0; i < count; i++) {
                const base = (output >>> 2) + i * 4; core.HEAPU32[base] = ids[i];
                core.HEAPF32[base + 1] = ids[i] * 10; core.HEAPF32[base + 2] = -ids[i] * 20; core.HEAPF32[base + 3] = .25;
            }
            return count;
        }),
    });
    const physics = Object.assign(shared ? core : heap(), { _physics_setBodyTransforms: vi.fn((_ptr: number, _count: number, _ppu: number) => 1) });
    const world = { getWasmModule: () => core, getCppRegistry: () => ({}) } as unknown as World;
    return { core, physics, world };
}

it.each([false, true])('passes only enabled ids and populated pose rows (shared heap=%s)', shared => {
    const { core, physics, world } = fixture(shared);
    expect(batchStaticPoses2D(world, physics as unknown as PhysicsWasmModule, [7, 8], 200, id => id === 7)).toBe(true);
    expect(core.registry_readWorldPoses2D).toHaveBeenCalledOnce();
    const [ptr, count, ppu] = physics._physics_setBodyTransforms.mock.calls[0];
    expect(count).toBe(1); expect(ppu).toBe(200);
    expect(physics.HEAPU32[ptr >>> 2]).toBe(7);
    expect([...physics.HEAPF32.subarray((ptr >>> 2) + 1, (ptr >>> 2) + 4)]).toEqual([70, -140, .25]);
    expect(core._malloc).toHaveBeenCalledTimes(1); expect(core._free).toHaveBeenCalledTimes(1);
    if (!shared) { expect(physics._malloc).toHaveBeenCalledOnce(); expect(physics._free).toHaveBeenCalledOnce(); }
});

it('reads fresh engine heap views after the physics allocation grows memory', () => {
    const { core, physics, world } = fixture(false), allocate = physics._malloc.getMockImplementation()!;
    physics._malloc.mockImplementation(bytes => { core.grow(core.HEAPU8.length * 2); return allocate(bytes); });
    expect(batchStaticPoses2D(world, physics as unknown as PhysicsWasmModule, [7], 100, () => true)).toBe(true);
    const ptr = physics._physics_setBodyTransforms.mock.calls[0][0];
    expect(physics.HEAPF32[(ptr >>> 2) + 1]).toBe(70);
});

it('rejects an invalid row count and releases the engine allocation', () => {
    const { core, physics, world } = fixture(false);
    core.registry_readWorldPoses2D.mockReturnValue(2);
    expect(() => batchStaticPoses2D(world, physics as unknown as PhysicsWasmModule, [7], 100, () => true)).toThrow('Invalid world pose batch length');
    expect(core._free).toHaveBeenCalledOnce(); expect(physics._malloc).not.toHaveBeenCalled();
});

it('falls back cleanly when the new entry point or a temporary allocation is unavailable', () => {
    const { core, physics, world } = fixture(false);
    physics._malloc.mockReturnValue(0);
    expect(batchStaticPoses2D(world, physics as unknown as PhysicsWasmModule, [7], 100, () => true)).toBe(false);
    expect(core._free).toHaveBeenCalledOnce();
    core.registry_readWorldPoses2D = undefined as never; core._malloc.mockClear();
    expect(batchStaticPoses2D(world, physics as unknown as PhysicsWasmModule, [7], 100, () => true)).toBe(false);
    expect(core._malloc).not.toHaveBeenCalled();
});
