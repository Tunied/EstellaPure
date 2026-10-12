// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { SkeletalPreview } from '../src/render/skeletalPreview';

describe('skeletal preview color source', () => {
    it.each([2, 3])('preserves PMA color for blend %s without guessing from blend', blendMode => {
        let next = 64;
        const legacy = vi.fn(() => 1);
        const submit = vi.fn(() => 1);
        const core = {
            HEAPU8: new Uint8Array(4096),
            _malloc: (size: number) => { const p = next; next += size; return p; },
            _free: vi.fn(),
            renderer_createSkeletalPreview: () => 9,
            renderer_submitSkeletalPreviewBatch: legacy,
            renderer_submitSkeletalPreviewBatchEx: submit,
        };
        const preview = SkeletalPreview.create(core, 128, 128)!;
        expect(preview.submit({ vertices: new Uint8Array(96), indices: new Uint8Array(6),
            vertexCount: 3, indexCount: 3, textureId: 7, blendMode,
            transform: new Float32Array(16), premultipliedColor: true })).toBe(true);
        expect(submit).toHaveBeenCalledOnce();
        expect(submit.mock.calls[0].at(-1)).toBe(true);
        expect(legacy).not.toHaveBeenCalled();
    });
});
