// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ShaderHandle } from '../render/material';
import { postProcessEffects } from './postProcessEffects';

export interface EffectUniformDef {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    /**
     * The "effect does nothing" value a partial-weight volume blend fades toward.
     * 0 for additive/intensity params (default); 1 for MULTIPLICATIVE params
     * (contrast, saturation, zoom) — blending those from 0 crushes the image to
     * black / extreme distortion at a volume's soft edge.
     */
    neutralValue?: number;
}

/** A texture parameter (LUT, mask): the sampler uniform it binds to. */
export interface EffectTextureDef {
    name: string;
    label: string;
}

/** A colour parameter (fog colour): the vec4 uniform it feeds and its default. */
export interface EffectColorDef {
    name: string;
    label: string;
    defaultValue: { r: number; g: number; b: number; a: number };
}

export interface EffectSubPass {
    name: string;
    factory: () => ShaderHandle;
    /**
     * Fraction of the chain size this sub-pass draws at (default 1). The chain's
     * LAST pass always draws full size — it feeds the blit — so a fractional
     * effect ends on a pass that reads the small result and writes the big one.
     */
    scale?: number;
}

export interface EffectDef {
    type: string;
    label: string;
    factory: () => ShaderHandle;
    uniforms: EffectUniformDef[];
    /** Texture params, carried on the volume as serialized refs (`textures`). */
    textures?: EffectTextureDef[];
    /** Colour params, carried on the volume as `colors`. */
    colors?: EffectColorDef[];
    multiPass?: EffectSubPass[];
}

const effectRegistry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
    effectRegistry.set(def.type, def);
}

export function getEffectDef(type: string): EffectDef | undefined {
    return effectRegistry.get(type);
}

export function getEffectTypes(): string[] {
    return Array.from(effectRegistry.keys());
}

export function getAllEffectDefs(): EffectDef[] {
    return Array.from(effectRegistry.values());
}

registerEffect({
    type: 'blur',
    label: 'Blur',
    factory: () => postProcessEffects.createBlur(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 2 },
    ],
});

registerEffect({
    type: 'bloom',
    label: 'Bloom',
    factory: () => postProcessEffects.createBloomExtract(),
    uniforms: [
        // Threshold reaches past 1: under the linear pipeline's HDR intermediates
        // only over-range energy (bright lights) blooms, leaving LDR art crisp.
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 2, step: 0.01, defaultValue: 0.4 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 5, step: 0.1, defaultValue: 1.5 },
        { name: 'u_radius', label: 'Radius', min: 0.5, max: 5, step: 0.1, defaultValue: 1 },
    ],
    multiPass: [
        { name: 'bloom_extract', factory: () => postProcessEffects.createBloomExtract() },
        { name: 'bloom_kawase_0', factory: () => postProcessEffects.createBloomKawase(0) },
        { name: 'bloom_kawase_1', factory: () => postProcessEffects.createBloomKawase(1) },
        { name: 'bloom_kawase_2', factory: () => postProcessEffects.createBloomKawase(2) },
        { name: 'bloom_kawase_3', factory: () => postProcessEffects.createBloomKawase(3) },
        { name: 'bloom_kawase_4', factory: () => postProcessEffects.createBloomKawase(4) },
        { name: 'bloom_composite', factory: () => postProcessEffects.createBloomComposite() },
    ],
});

registerEffect({
    type: 'vignette',
    label: 'Vignette',
    factory: () => postProcessEffects.createVignette(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
        { name: 'u_softness', label: 'Softness', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
});

registerEffect({
    type: 'grayscale',
    label: 'Grayscale',
    factory: () => postProcessEffects.createGrayscale(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'colorGrade',
    label: 'Color Grade',
    factory: () => postProcessEffects.createColorGrade(),
    uniforms: [
        { name: 'u_exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, defaultValue: 0 },
        { name: 'u_contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
        { name: 'u_saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
        { name: 'u_temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, defaultValue: 0 },
        { name: 'u_tint', label: 'Tint', min: -1, max: 1, step: 0.01, defaultValue: 0 },
    ],
});

registerEffect({
    type: 'chromaticAberration',
    label: 'Chromatic Aberration',
    factory: () => postProcessEffects.createChromaticAberration(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 3 },
    ],
});

registerEffect({
    type: 'tonemap',
    label: 'Tonemap (ACES)',
    factory: () => postProcessEffects.createTonemap(),
    uniforms: [
        { name: 'u_exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, defaultValue: 0 },
    ],
});

registerEffect({
    type: 'fxaa',
    label: 'FXAA',
    factory: () => postProcessEffects.createFxaa(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'lensDistortion',
    label: 'Lens Distortion',
    factory: () => postProcessEffects.createLensDistortion(),
    uniforms: [
        { name: 'u_strength', label: 'Strength', min: -1, max: 1, step: 0.01, defaultValue: 0 },
        { name: 'u_zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
    ],
});

registerEffect({
    type: 'pixelate',
    label: 'Pixelate',
    factory: () => postProcessEffects.createPixelate(),
    uniforms: [
        { name: 'u_pixelSize', label: 'Pixel Size', min: 1, max: 64, step: 1, defaultValue: 4 },
    ],
});

registerEffect({
    type: 'outline',
    label: 'Outline',
    factory: () => postProcessEffects.createOutline(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
        { name: 'u_thickness', label: 'Thickness', min: 0.5, max: 4, step: 0.5, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'depthOutline',
    label: 'Depth Outline',
    factory: () => postProcessEffects.createDepthOutline(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        { name: 'u_threshold', label: 'Threshold', min: 0.0005, max: 0.2, step: 0.0005, defaultValue: 0.01 },
        { name: 'u_thickness', label: 'Thickness', min: 1, max: 4, step: 1, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'distanceFog',
    label: 'Distance Fog',
    factory: () => postProcessEffects.createDistanceFog(),
    uniforms: [
        { name: 'u_fogNear', label: 'Near', min: 0, max: 500, step: 0.5, defaultValue: 10 },
        { name: 'u_fogFar', label: 'Far', min: 0, max: 500, step: 0.5, defaultValue: 60 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
    // The default is the shader's own `#pragma param u_fogColor` default, so a
    // volume that never names the colour fogs exactly as it always did.
    colors: [
        { name: 'u_fogColor', label: 'Colour', defaultValue: { r: 0.6, g: 0.68, b: 0.78, a: 1 } },
    ],
});

registerEffect({
    type: 'heightFog',
    label: 'Height Fog',
    factory: () => postProcessEffects.createHeightFog(),
    uniforms: [
        // Per WORLD unit at the base height: the share of light a unit of fog takes out.
        { name: 'u_density', label: 'Density', min: 0, max: 0.05, step: 0.0001, defaultValue: 0.0015, neutralValue: 0 },
        // How fast the fog thins with height; 0 is a fog of one density at every height.
        { name: 'u_heightFalloff', label: 'Height Falloff', min: 0, max: 0.1, step: 0.0005, defaultValue: 0.003 },
        { name: 'u_baseHeight', label: 'Base Height', min: -1000, max: 5000, step: 10, defaultValue: 0 },
        { name: 'u_startDistance', label: 'Start Distance', min: 0, max: 3000, step: 10, defaultValue: 0 },
        { name: 'u_maxOpacity', label: 'Max Opacity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        // Where the sun is, to colour the haze toward it: degrees from +Z toward +X, and above the horizon.
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -10, max: 90, step: 1, defaultValue: 25 },
        { name: 'u_inscatter', label: 'Sun Glow', min: 0, max: 2, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
        { name: 'u_sunExponent', label: 'Glow Sharpness', min: 1, max: 64, step: 1, defaultValue: 8 },
        // How much of the sky takes the horizon haze; 0 leaves the sky untouched.
        { name: 'u_skyFog', label: 'Sky Haze', min: 0, max: 1, step: 0.01, defaultValue: 0.8, neutralValue: 0 },
    ],
    colors: [
        { name: 'u_fogColor', label: 'Colour', defaultValue: { r: 0.62, g: 0.7, b: 0.8, a: 1 } },
        { name: 'u_sunColor', label: 'Sun Colour', defaultValue: { r: 1, g: 0.82, b: 0.55, a: 1 } },
    ],
});

registerEffect({
    type: 'lightShafts',
    label: 'Light Shafts',
    factory: () => postProcessEffects.createLightShafts(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -10, max: 90, step: 1, defaultValue: 25 },
        // Per step of the march: lower fades the shafts sooner along their length.
        { name: 'u_decay', label: 'Decay', min: 0.8, max: 1, step: 0.005, defaultValue: 0.96 },
        // How much of the way to the sun each pixel looks: shorter shafts at lower values.
        { name: 'u_reach', label: 'Reach', min: 0.1, max: 1, step: 0.01, defaultValue: 0.6 },
    ],
    colors: [
        { name: 'u_sunColor', label: 'Sun Colour', defaultValue: { r: 1, g: 0.85, b: 0.6, a: 1 } },
    ],
});

registerEffect({
    type: 'ssao',
    label: 'Ambient Occlusion',
    factory: () => postProcessEffects.createSsaoAo(),
    // Four knobs, each a term in the estimator. Sample count, spiral turns and
    // the blur's slope limit stay constants in the shader: a number nobody can
    // set right is not a setting, it is a way to break the effect.
    uniforms: [
        // A WORLD length: positions come back in world space, so this is "how far
        // around a point counts as its neighbourhood", not a pixel count.
        { name: 'u_radius', label: 'Radius', min: 1, max: 400, step: 1, defaultValue: 60 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        // How far above the tangent plane a sample must sit to count. This is
        // what keeps a flat floor from occluding itself into grey.
        { name: 'u_bias', label: 'Bias', min: 0, max: 0.6, step: 0.005, defaultValue: 0.12 },
        // Contrast on the finished term; neutral at 1, so a blend toward "no
        // effect" has to fade toward 1 and not 0.
        { name: 'u_power', label: 'Power', min: 0.5, max: 4, step: 0.05, defaultValue: 1.6, neutralValue: 1 },
    ],
    // Half resolution for the three passes that carry the term, full for the one
    // that applies it — the chain's last pass feeds the blit and is full size
    // regardless, so the composite is where the upsample has to happen.
    multiPass: [
        { name: 'ssao_ao', factory: () => postProcessEffects.createSsaoAo(), scale: 0.5 },
        { name: 'ssao_blur_x', factory: () => postProcessEffects.createSsaoBlur(0), scale: 0.5 },
        { name: 'ssao_blur_y', factory: () => postProcessEffects.createSsaoBlur(1), scale: 0.5 },
        { name: 'ssao_composite', factory: () => postProcessEffects.createSsaoComposite() },
    ],
});

registerEffect({
    type: 'ssr',
    label: 'Screen Space Reflections',
    factory: () => postProcessEffects.createSsr(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // A WORLD length, like SSAO's radius: how far a reflected ray may travel before the
        // search gives up. Step count is a constant, so a longer reach is a coarser step.
        { name: 'u_maxDistance', label: 'Max Distance', min: 10, max: 3000, step: 10, defaultValue: 400 },
        // How far behind a visible surface a ray may pass and still count as having hit it.
        { name: 'u_thickness', label: 'Thickness', min: 1, max: 200, step: 1, defaultValue: 12 },
        // 1 = only surfaces that face up reflect (wet ground, polished floors); 0 = every surface
        // reflects by its Fresnel term alone.
        { name: 'u_floorBias', label: 'Floor Bias', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'taa',
    label: 'Temporal Anti-Aliasing',
    factory: () => postProcessEffects.createTaa(),
    // One knob: how much of each frame is the new one. The camera shift, the history
    // and last frame's camera are the engine's, not the effect's — they are not settings.
    uniforms: [
        // Lower is smoother and slower to follow a change; 1 is no accumulation at all,
        // which is what a blend toward "no effect" fades to.
        { name: 'u_blend', label: 'Blend', min: 0.02, max: 1, step: 0.01, defaultValue: 0.1, neutralValue: 1 },
    ],
});

registerEffect({
    type: 'lutGrade',
    label: 'LUT Grade',
    factory: () => postProcessEffects.createLutGrade(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
    textures: [
        { name: 'u_lut', label: 'LUT (1024x32, 32 slices)' },
    ],
});
