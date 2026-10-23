// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { Schedule } from '../ecs/system';
import { Assets } from '../asset/AssetPlugin';
import { PostProcess, PostProcessAPI } from './PostProcessAPI';
import { postProcessVolumeSystem, cleanupVolumeSystem, setVolumeTextureResolver, setBuiltinTextureMaker, PostProcessVolumeConfigResource } from './volumeSystem';
import { createTextureFromPixels } from '../runtime/runtimeAssets';
import { TextureContent } from '../wasm';
import { weatherSystem, resetWeatherSystem } from './weatherSystem';

export class PostProcessPlugin implements Plugin {
    name = 'postProcess';
    readonly profileDomain = 'render';

    build(app: App): void {
        // Per-App post-process API, injected into the render pipeline as an
        // optional stage (the pipeline has no hard dependency on it).
        const api = new PostProcessAPI();
        app.insertResource(PostProcess, api);
        app.pipeline?.setPostProcess(api);

        app.insertResource(PostProcessVolumeConfigResource, { enabled: true });
        // Effect texture params (LUTs, masks) resolve through this App's Assets;
        // PostProcessVolume's discoverAssets preloads the refs, so this is a
        // cache lookup by the time a volume applies.
        setVolumeTextureResolver((ref) =>
            app.hasResource(Assets) ? (app.getResource(Assets).getTexture(ref)?.handle ?? 0) : 0);
        // Textures an effect brings itself (AgX's table): uploaded as data, linear, clamped, with this App's module.
        setBuiltinTextureMaker((pixels) => createTextureFromPixels(app.wasmModule, pixels, TextureContent.Retained, false,
            { srgb: false, filterMode: 'linear', wrapMode: 'clamp' }));
        // The weather first: the volumes read what it has decided.
        app.addSystemToSchedule(Schedule.PostUpdate, weatherSystem);
        app.addSystemToSchedule(Schedule.PostUpdate, postProcessVolumeSystem);
    }

    cleanup(app?: App): void {
        resetWeatherSystem();
        if (app?.hasResource(PostProcess)) {
            cleanupVolumeSystem(app.getResource(PostProcess));
        }
    }
}

export const postProcessPlugin = new PostProcessPlugin();
