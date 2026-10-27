// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { BlobShadow, blobAlpha, buildBlobMesh } from '../src/render/blobShadow';
import { MeshChannel } from '../src/asset/meshFormat';

function positionOf(mesh: ReturnType<typeof buildBlobMesh>, vertex: number): [number, number, number] {
    const at = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!.offset;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const base = vertex * mesh.vertexStride + at;
    return [view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)];
}

describe('blob shadow disc', () => {
    it('lies in the ground plane, inside the unit circle, with indices that name its vertices', () => {
        const mesh = buildBlobMesh(0.6);
        expect(mesh.indices.length % 3).toBe(0);
        for (const i of mesh.indices) expect(i).toBeLessThan(mesh.vertexCount);
        for (let v = 0; v < mesh.vertexCount; v++) {
            const [x, y, z] = positionOf(mesh, v);
            expect(y).toBe(0);
            expect(Math.hypot(x, z)).toBeLessThanOrEqual(1 + 1e-6);
        }
    });

    it('winds counter-clockwise seen from above, so a ground-facing cull keeps it', () => {
        const mesh = buildBlobMesh(0.5);
        for (let t = 0; t < mesh.indices.length; t += 3) {
            const [a, b, c] = [positionOf(mesh, mesh.indices[t]!), positionOf(mesh, mesh.indices[t + 1]!), positionOf(mesh, mesh.indices[t + 2]!)];
            // The y of (b - a) x (c - a): positive is facing up.
            const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            expect(up).toBeGreaterThan(-1e-9);
        }
    });

    it('is opaque at the centre and gone at the rim, softer or harder as asked', () => {
        const soft = buildBlobMesh(1);
        const hard = buildBlobMesh(0);
        expect(blobAlpha(soft, 0)).toBe(1);
        expect(blobAlpha(soft, soft.vertexCount - 1)).toBe(0);
        expect(blobAlpha(hard, hard.vertexCount - 1)).toBe(0);
        // Half way out: the soft disc has already faded, the hard one has not begun.
        const half = 1 + 3 * 28;
        expect(blobAlpha(soft, half)).toBeLessThan(blobAlpha(hard, half));
        expect(blobAlpha(hard, half)).toBe(1);
    });

    it('is a component with defaults a scene can start from', () => {
        expect(BlobShadow._name).toBe('BlobShadow');
        expect(BlobShadow._default).toMatchObject({ enabled: true, radius: 50, opacity: 0.5 });
    });
});
