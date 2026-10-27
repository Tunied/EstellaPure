// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import { MeshRenderer } from '../src/ecs/component';
import { MeshRenderers } from '../src/render/meshRenderer';
import { clearPath, setPath } from '../src/render/pathRenderer';

function fakeApp(hasMesh: boolean) {
    const api = { setGeometry: vi.fn(), clearGeometry: vi.fn() };
    const world = { has: vi.fn(() => hasMesh), insert: vi.fn() };
    const app = { world, getResource: vi.fn((res: unknown) => (res === MeshRenderers ? api : undefined)) } as unknown as App;
    return { app, api, world };
}

const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
const white = [1, 1, 1, 1] as const;

describe('setPath', () => {
    it('uploads the fill of the points to the entity\'s mesh', () => {
        const { app, api, world } = fakeApp(true);
        setPath(app, 7, triangle, { fill: { color: white } });
        expect(world.insert).not.toHaveBeenCalled();
        expect(api.setGeometry).toHaveBeenCalledTimes(1);
        const [entity, geometry] = api.setGeometry.mock.calls[0]!;
        expect(entity).toBe(7);
        expect(geometry.indices.length).toBe(3);
    });

    it('gives an entity without a MeshRenderer one', () => {
        const { app, world } = fakeApp(false);
        setPath(app, 3, triangle, { stroke: { color: white, width: 2 }, closed: true });
        expect(world.insert).toHaveBeenCalledWith(3, MeshRenderer, expect.objectContaining({ enabled: true }));
    });

    it('clears what was drawn when the path has nothing to draw', () => {
        const { app, api } = fakeApp(true);
        setPath(app, 1, [{ x: 0, y: 0 }], { stroke: { color: white, width: 2 } });
        expect(api.setGeometry).not.toHaveBeenCalled();
        expect(api.clearGeometry).toHaveBeenCalledWith(1);
        clearPath(app, 2);
        expect(api.clearGeometry).toHaveBeenCalledWith(2);
    });
});
