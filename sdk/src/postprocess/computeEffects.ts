// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  computeEffects.ts
 * @brief The effects that run as compute shaders — WGSL over the picture, for a device with a compute stage.
 *
 * @details See {@link ComputeEffectSource} for what a compute effect is handed. These leave the chain untouched on a device
 *          with none (WebGL2), which is the right answer for an effect that only refines a picture that is already whole.
 */

/**
 * Sharpening that cannot make a halo: each pixel is pushed away from the mean of its four neighbours, then held inside the range
 * those neighbours (and the pixel) span, widened by `limit`. A flat area has nothing to push against and an edge cannot overshoot
 * past what is on either side of it, which is what a plain unsharp mask gets wrong. Runs in the chain's own (HDR) values.
 */
export const SHARPEN_WGSL = /* wgsl */ `
struct Params { intensity : f32, limit : f32, pad0 : f32, pad1 : f32 };
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params : Params;

fn load(p : vec2i, size : vec2i) -> vec4f {
    return textureLoad(src, clamp(p, vec2i(0), size - vec2i(1)), 0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let size = vec2i(textureDimensions(src));
    let p = vec2i(id.xy);
    if (p.x >= size.x || p.y >= size.y) { return; }
    let c = load(p, size);
    let n = load(p + vec2i(0, -1), size).rgb;
    let s = load(p + vec2i(0, 1), size).rgb;
    let w = load(p + vec2i(-1, 0), size).rgb;
    let e = load(p + vec2i(1, 0), size).rgb;
    let lo = min(min(min(n, s), min(w, e)), c.rgb);
    let hi = max(max(max(n, s), max(w, e)), c.rgb);
    var sharp = c.rgb + params.intensity * (4.0 * c.rgb - n - s - w - e);
    let room = (hi - lo) * params.limit;
    sharp = clamp(sharp, lo - room, hi + room);
    textureStore(dst, p, vec4f(max(sharp, vec3f(0.0)), c.a));
}
`;
