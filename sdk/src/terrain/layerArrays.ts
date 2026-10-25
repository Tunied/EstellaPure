// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layerArrays.ts
 * @brief   A ground's layer files (`.esterrainlayer`) read and packed into the texture arrays its shader samples.
 */
import type { App } from '../app/app';
import { Assets } from '../asset/AssetPlugin';
import { platformLoadImagePixels } from '../platform/base';
import { decodeImagePixels } from '../asset/imageDecode';
import { decodePngData } from '../asset/pngData';
import { isMiniGame } from '../platform';
import { createTextureArrayFromPixels } from '../runtime/runtimeAssets';
import { getResourceManager } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { log } from '../util/logger';
import { packLayers, type LayerImage, type LayerSource, type TerrainLayerDef } from './layers';

/** An image file's pixels exactly as stored (no premultiply, no colour conversion), by its project path or reference. */
export async function imagePixelsAt(app: App, path: string): Promise<{ width: number; height: number; pixels: Uint8Array; wide?: Uint16Array } | null> {
    if (!app.hasResource(Assets)) return null;
    const assets = app.getResource(Assets);
    try {
        // The bytes the asset layer would load, decoded unmodified (no premultiply, no colour conversion): a height is data.
        if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
            const bytes = new Uint8Array(await assets.fetchBinary(path));
            return await decodePngData(bytes) ?? await decodeImagePixels(new Blob([bytes]));
        }
        const image = await platformLoadImagePixels(assets.resolveLoadPath(path));
        return { width: image.width, height: image.height, pixels: image.pixels };
    } catch (e) {
        log.warn('terrain', `reading ${path} failed`, e);
        return null;
    }
}

/** What a ground's layers came to: the albedo and normal arrays (engine texture handles) and how many world units a repeat of each layer covers. */
export interface LayerArrays {
    albedo: number;
    normal: number;
    tiles: number[];
}

/** Reads the layer files `refs` and packs them; null if the engine refuses the arrays. At most `most` layers are packed. */
export async function loadLayerArrays(app: App, refs: readonly string[], most: number): Promise<LayerArrays | null> {
    const assets = app.getResource(Assets);
    if (refs.length > most) log.warn('terrain', `a ground draws ${most} layers at most; it names ${refs.length}`);
    const sources: LayerSource[] = [];
    for (const ref of refs.slice(0, most)) {
        const def = await assets.load<TerrainLayerDef>('terrain-layer', ref);
        const image = async (path: string | undefined): Promise<LayerImage | null> => {
            if (!path) return null;
            const got = await imagePixelsAt(app, path);
            if (!got) log.warn('terrain', `the texture ${path} of terrain layer ${ref} could not be read`);
            return got;
        };
        sources.push({ def, albedo: await image(def.albedo), normal: await image(def.normal), mask: await image(def.mask) });
    }
    // A minigame's memory holds the layers at half the size.
    const packed = packLayers(sources, isMiniGame() ? 512 : 1024);
    const made = (layers: Uint8Array[], srgb: boolean): number => createTextureArrayFromPixels(app.wasmModule,
        { width: packed.size, height: packed.size, layers }, TextureContent.Retained, { filterMode: 'linear', wrapMode: 'repeat', mipmaps: true, srgb });
    const albedo = made(packed.albedo, true), normal = made(packed.normal, false);
    if (!albedo || !normal) {
        releaseLayerArrays([albedo, normal]);
        return null;
    }
    return { albedo, normal, tiles: packed.tiles };
}

/** Gives the engine back arrays made by {@link loadLayerArrays}. */
export function releaseLayerArrays(handles: readonly number[]): void {
    const rm = getResourceManager();
    for (const handle of handles) if (handle) rm?.releaseTexture(handle);
}
