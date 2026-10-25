// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The display LUT: a stage of the chain's last pass that rides a stack as its passes do, and is said to the engine with them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostProcessAPI, initPostProcessAPI, getEffectDef } from '../src/postprocess';
import { syncStackToWasm } from '../src/postprocess/PostProcessAPI';
import type { ESEngineModule } from '../src/wasm';

function mockModule() {
    return {
        postprocess_init: vi.fn().mockReturnValue(true),
        postprocess_clearPasses: vi.fn(),
        postprocess_addPass: vi.fn(),
        postprocess_setPassScale: vi.fn(),
        postprocess_setPassContinuesEffect: vi.fn(),
        postprocess_setUniformFloat: vi.fn(),
        postprocess_setUniformVec4: vi.fn(),
        postprocess_setPassTexture: vi.fn(),
        postprocess_setDisplayLut: vi.fn(),
        postprocess_setOutputTransform: vi.fn(),
    };
}

describe('the display LUT of a stack', () => {
    let mock: ReturnType<typeof mockModule>;
    let pp: PostProcessAPI;

    beforeEach(() => {
        mock = mockModule();
        initPostProcessAPI(mock as unknown as ESEngineModule);
        pp = new PostProcessAPI();
    });

    it('is an effect that is a stage of the last pass, with no shader of its own', () => {
        const def = getEffectDef('displayLut')!;
        expect(def.stage).toBe('output');
        expect(def.factory).toBeUndefined();
        expect(def.textures!.map((t) => t.name)).toEqual(['u_lut']);
    });

    it('is said to the engine with the stack, after the passes it clears, and not for a table with no amount', () => {
        const stack = pp.createStack();
        stack.setDisplayLut(7, 0.5);
        syncStackToWasm(stack, true);
        expect(mock.postprocess_clearPasses).toHaveBeenCalledOnce();
        expect(mock.postprocess_setDisplayLut).toHaveBeenCalledWith(7, 0.5);
        expect(mock.postprocess_clearPasses.mock.invocationCallOrder[0]!).toBeLessThan(mock.postprocess_setDisplayLut.mock.invocationCallOrder[0]!);

        mock.postprocess_setDisplayLut.mockClear();
        stack.setDisplayLut(7, 0);
        syncStackToWasm(stack, true);
        expect(mock.postprocess_setDisplayLut).not.toHaveBeenCalled();
    });

    it('makes the stack dirty only when it changes, holds the amount to 1, and is cleared with the passes', () => {
        const stack = pp.createStack();
        stack.clearDirty();
        stack.setDisplayLut(3, 2);
        expect(stack.isDirty).toBe(true);
        expect(stack.displayLut).toEqual({ texture: 3, amount: 1 });
        stack.clearDirty();
        stack.setDisplayLut(3, 1);
        expect(stack.isDirty).toBe(false);
        stack.clearPasses();
        expect(stack.displayLut).toEqual({ texture: 0, amount: 0 });
        expect(stack.isDirty).toBe(true);
    });

    it('is nothing without a texture, whatever the amount', () => {
        const stack = pp.createStack();
        stack.setDisplayLut(0, 1);
        expect(stack.displayLut).toEqual({ texture: 0, amount: 0 });
    });
});
