// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadContext } from '../src/asset/AssetLoader';

const state = vi.hoisted(() => ({ version: 1, urls: [] as string[], cache: new Map<string, number>() }));
class ImageFake {
    width = 0;
    height = 1;
    onload: (() => void) | null = null;
    onerror = null;
    crossOrigin = '';
    set src(url: string) {
        state.urls.push(url);
        if (!state.cache.has(url)) state.cache.set(url, state.version);
        this.width = state.cache.get(url)!;
        queueMicrotask(() => this.onload?.());
    }
}
vi.mock('../src/platform/base', () => ({ platformCreateImage: () => new ImageFake() }));
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({ registerTextureWithPath: vi.fn() }) }));
import { TextureLoader } from '../src/asset/loaders/TextureLoader';

function loader() {
    const result = new TextureLoader(null);
    const internal = result as unknown as { createTextureFromImage(image: ImageFake): { handle: number; width: number; height: number } };
    vi.spyOn(internal, 'createTextureFromImage').mockImplementation(image => ({ handle: 1, width: image.width, height: image.height }));
    return result;
}
const context = (url: string) => ({ backend: { resolveUrl: () => url }, catalog: { getBuildPath: (p: string) => p } }) as unknown as LoadContext;

describe('browser texture image revisions', () => {
    beforeEach(() => {
        state.version = 1; state.urls.length = 0; state.cache.clear();
        vi.stubGlobal('HTMLImageElement', ImageFake);
        vi.stubGlobal('createImageBitmap', undefined);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('preserves ordinary URL reuse but fetches changed pixels after invalidation', async () => {
        const textures = loader(), ctx = context('https://test/hero.png?format=raw#preview');
        expect((await textures.load('hero.png', ctx)).width).toBe(1);
        state.version = 2;
        expect((await textures.load('hero.png', ctx)).width).toBe(1);
        textures.invalidate('hero.png');
        expect((await textures.load('hero.png', ctx)).width).toBe(2);
        const revised = new URL(state.urls[2]);
        expect(revised.searchParams.get('format')).toBe('raw');
        expect(revised.searchParams.has('_esTextureRevision')).toBe(true);
        expect(revised.hash).toBe('#preview');
        await textures.loadRaw('hero.png', ctx);
        expect(state.urls[3]).toBe(state.urls[2]);
        textures.invalidate('hero.png');
        state.version = 3;
        expect((await textures.load('hero.png', ctx)).width).toBe(3);
    });

    it('does not alter native image paths or immutable data and blob URLs', async () => {
        const textures = loader();
        for (const url of ['data:image/png;base64,abc', 'blob:https://test/image']) {
            textures.invalidate('image'); await textures.load('image', context(url));
            expect(state.urls.at(-1)).toBe(url);
        }
        vi.stubGlobal('HTMLImageElement', undefined);
        textures.invalidate('local.png');
        await textures.load('local.png', context('/package/local.png'));
        expect(state.urls.at(-1)).toBe('/package/local.png');
    });
});
