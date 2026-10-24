// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  terrainShader.ts
 * @brief The Terrain built-in shader: four texture layers weighted by the Terrain component.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';


// Ground painted by four layers. The Terrain component writes how much of each layer a point of ground has into the vertex colour
// (red, green, blue, alpha: grass, dirt, snow, rock), and this shader draws them: each layer is a texture tiled by world position so
// it runs unbroken from one chunk to the next, and the rock is projected from three sides so a cliff is not a smear.
const TERRAIN = `#pragma shader "Terrain"
#pragma version 300 es
#pragma domain Lit
#pragma param u_layer0 texture default(white)
#pragma param u_layer1 texture default(white)
#pragma param u_layer2 texture default(white)
#pragma param u_layer3 texture default(white)
// Each layer's colour, which multiplies its texture, and how many world units one repeat of it covers.
#pragma param u_tint0 color default(0.28,0.46,0.2,1)
#pragma param u_tint1 color default(0.45,0.36,0.24,1)
#pragma param u_tint2 color default(0.93,0.95,0.98,1)
#pragma param u_tint3 color default(0.4,0.38,0.36,1)
#pragma param u_tile0 float default(24) range(1,800) ui(slider)
#pragma param u_tile1 float default(24) range(1,800) ui(slider)
#pragma param u_tile2 float default(24) range(1,800) ui(slider)
#pragma param u_tile3 float default(40) range(1,800) ui(slider)
// How much a layer with more weight takes over from the others at the seam: 1 is a plain blend, higher a harder edge.
#pragma param u_sharpness float default(1.6) range(1,8) ui(slider)
// How much the seams follow the layers' own relief (their brightness): rock shows through the gaps in the grass before the grass gives way,
// and sand fills the low places between stones. 0 is a plain blend of the weights.
#pragma param u_heightBlend float default(0.7) range(0,1) ui(slider)
// How much of each layer is read a second time, turned and on a wider tile, and blended in by slow noise, so no repeat of it is seen across a field.
#pragma param u_antiTile float default(0.6) range(0,1) ui(slider)
// The wide, slow variation in brightness laid over every layer so a big meadow is not one colour.
#pragma param u_macroVariation float default(0.35) range(0,1) ui(slider)
// How deep, in world units, the layers' relief is drawn into the light (their brightness taken as height); 0 leaves the ground smooth.
#pragma param u_relief float default(0.05) range(0,100000) ui(slider)
// Ground at the water: below u_wetLevel + u_wetBand (world heights) it darkens and shines, most at the waterline. A band of 0 draws none.
#pragma param u_wetLevel float default(0) range(-100000,100000) ui(slider)
#pragma param u_wetBand float default(0) range(0,100000) ui(slider)
#pragma param u_roughness float default(0.92) range(0,1) ui(slider)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

float tnHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float tnNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tnHash(i), tnHash(i + vec2(1.0, 0.0)), f.x), mix(tnHash(i + vec2(0.0, 1.0)), tnHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The second reading of a layer: turned, on a tile 1.37 times as wide, offset.
vec2 tnTurned(vec2 p, float tile) { return mat2(0.8, -0.6, 0.6, 0.8) * p / (tile * 1.37) + vec2(0.37, 0.71); }
float tnLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    // Every layer read twice and blended by slow noise of its own tile's scale, so neither repeat is seen.
    float t0 = smoothstep(0.3, 0.7, tnNoise(P.xz / (u_tile0 * 9.0))) * u_antiTile;
    float t1 = smoothstep(0.3, 0.7, tnNoise(P.xz / (u_tile1 * 9.0) + 17.0)) * u_antiTile;
    float t2 = smoothstep(0.3, 0.7, tnNoise(P.xz / (u_tile2 * 9.0) + 31.0)) * u_antiTile;
    float t3 = smoothstep(0.3, 0.7, tnNoise(P.xz / (u_tile3 * 9.0) + 47.0)) * u_antiTile;
    vec3 s0 = mix(texture(u_layer0, P.xz / u_tile0).rgb, texture(u_layer0, tnTurned(P.xz, u_tile0)).rgb, t0);
    vec3 s1 = mix(texture(u_layer1, P.xz / u_tile1).rgb, texture(u_layer1, tnTurned(P.xz, u_tile1)).rgb, t1);
    vec3 s2 = mix(texture(u_layer2, P.xz / u_tile2).rgb, texture(u_layer2, tnTurned(P.xz, u_tile2)).rgb, t2);
    // Rock is seen from three sides, in proportion to how the ground faces them, so a sheer face is not stretched.
    vec3 axis = pow(abs(N), vec3(4.0));
    axis /= dot(axis, vec3(1.0));
    vec3 rockTop = mix(texture(u_layer3, P.xz / u_tile3).rgb, texture(u_layer3, tnTurned(P.xz, u_tile3)).rgb, t3);
    vec3 s3 = texture(u_layer3, P.zy / u_tile3).rgb * axis.x + rockTop * axis.y + texture(u_layer3, P.xy / u_tile3).rgb * axis.z;

    vec4 w = max(v_color, vec4(0.0));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    // The strongest layer wins its seam more cleanly the higher the sharpness.
    w = pow(w, vec4(u_sharpness));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    // Then by relief: each layer stands as high as it is bright, and where two meet the higher one shows.
    vec4 heights = vec4(tnLuma(s0), tnLuma(s1), tnLuma(s2), tnLuma(s3));
    vec4 stand = heights + w * 1.5;
    float top = max(max(stand.x, stand.y), max(stand.z, stand.w)) - 0.35;
    vec4 hw = max(stand - top, vec4(0.0)) * step(vec4(1e-3), w);
    hw /= max(dot(hw, vec4(1.0)), 1e-4);
    w = mix(w, hw, u_heightBlend);

    vec3 albedo = s0 * u_tint0.rgb * w.x + s1 * u_tint1.rgb * w.y + s2 * u_tint2.rgb * w.z + s3 * u_tint3.rgb * w.w;
    float broad = tnNoise(P.xz / (u_tile0 * 7.3)) * 0.6 + tnNoise(P.xz / (u_tile0 * 29.0) + 5.0) * 0.4;
    albedo *= mix(1.0, 0.7 + 0.6 * broad, u_macroVariation);

    // The relief, as a bump from the screen-space change of its height, faded out before it is finer than a pixel.
    float relief = dot(heights, w) * u_relief;
    vec3 dpx = dFdx(P), dpy = dFdy(P);
    float dhx = dFdx(relief), dhy = dFdy(relief);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 surfGrad = sign(det) * (dhx * r1 + dhy * r2);
    float fine = 1.0 - smoothstep(0.02, 0.2, length(dpx) / max(u_tile0, 1e-4));
    vec3 Nb = normalize(abs(det) * N - surfGrad * fine);
    if (abs(det) > 1e-12 && u_relief > 0.0) N = Nb;

    // Wet at the water: darker, and smooth enough to shine.
    float wet = u_wetBand > 0.0 ? 1.0 - smoothstep(u_wetLevel, u_wetLevel + u_wetBand, P.y) : 0.0;
    albedo *= mix(1.0, 0.55, wet);
    float roughness = mix(u_roughness, 0.3, wet);

    SurfaceExt ext = surfaceExtNone(N);
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), roughness, 0.75);
#endif
}
#pragma end

#pragma fragment wgsl
fn tnHash(p0 : vec2f) -> f32 {
    var p = fract(p0 * vec2f(0.1031, 0.1030));
    p = p + dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
fn tnNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tnHash(i), tnHash(i + vec2f(1.0, 0.0)), f.x), mix(tnHash(i + vec2f(0.0, 1.0)), tnHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn tnTurned(p : vec2f, tile : f32) -> vec2f { return mat2x2f(0.8, -0.6, 0.6, 0.8) * p / (tile * 1.37) + vec2f(0.37, 0.71); }
fn tnLuma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
};

fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}

@fragment fn fs_main(v : VSOut) -> FragOut {
#else
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#endif
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
    let N = normalize(v.v_worldNormal);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 1.0, 0.0);
#endif
    // Every sample and every derivative is taken here, in uniform control flow.
    let t0 = smoothstep(0.3, 0.7, tnNoise(P.xz / (mc.u_tile0 * 9.0))) * mc.u_antiTile;
    let t1 = smoothstep(0.3, 0.7, tnNoise(P.xz / (mc.u_tile1 * 9.0) + 17.0)) * mc.u_antiTile;
    let t2 = smoothstep(0.3, 0.7, tnNoise(P.xz / (mc.u_tile2 * 9.0) + 31.0)) * mc.u_antiTile;
    let t3 = smoothstep(0.3, 0.7, tnNoise(P.xz / (mc.u_tile3 * 9.0) + 47.0)) * mc.u_antiTile;
    let s0 = mix(textureSample(u_layer0, u_layer0_s, P.xz / mc.u_tile0).rgb, textureSample(u_layer0, u_layer0_s, tnTurned(P.xz, mc.u_tile0)).rgb, vec3f(t0));
    let s1 = mix(textureSample(u_layer1, u_layer1_s, P.xz / mc.u_tile1).rgb, textureSample(u_layer1, u_layer1_s, tnTurned(P.xz, mc.u_tile1)).rgb, vec3f(t1));
    let s2 = mix(textureSample(u_layer2, u_layer2_s, P.xz / mc.u_tile2).rgb, textureSample(u_layer2, u_layer2_s, tnTurned(P.xz, mc.u_tile2)).rgb, vec3f(t2));
    let rockX = textureSample(u_layer3, u_layer3_s, P.zy / mc.u_tile3).rgb;
    let rockTop = mix(textureSample(u_layer3, u_layer3_s, P.xz / mc.u_tile3).rgb, textureSample(u_layer3, u_layer3_s, tnTurned(P.xz, mc.u_tile3)).rgb, vec3f(t3));
    let rockZ = textureSample(u_layer3, u_layer3_s, P.xy / mc.u_tile3).rgb;
    var axis = pow(abs(N), vec3f(4.0));
    axis = axis / dot(axis, vec3f(1.0));
    let s3 = rockX * axis.x + rockTop * axis.y + rockZ * axis.z;

    var w = max(v.v_color, vec4f(0.0));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    w = pow(w, vec4f(mc.u_sharpness));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    let heights = vec4f(tnLuma(s0), tnLuma(s1), tnLuma(s2), tnLuma(s3));
    let stand = heights + w * 1.5;
    let top = max(max(stand.x, stand.y), max(stand.z, stand.w)) - 0.35;
    var hw = max(stand - vec4f(top), vec4f(0.0)) * step(vec4f(1e-3), w);
    hw = hw / max(dot(hw, vec4f(1.0)), 1e-4);
    w = mix(w, hw, vec4f(mc.u_heightBlend));

    var albedo = s0 * mc.u_tint0.rgb * w.x + s1 * mc.u_tint1.rgb * w.y + s2 * mc.u_tint2.rgb * w.z + s3 * mc.u_tint3.rgb * w.w;
    let broad = tnNoise(P.xz / (mc.u_tile0 * 7.3)) * 0.6 + tnNoise(P.xz / (mc.u_tile0 * 29.0) + 5.0) * 0.4;
    albedo = albedo * mix(1.0, 0.7 + 0.6 * broad, mc.u_macroVariation);

    let relief = dot(heights, w) * mc.u_relief;
    let dpx = dpdx(P);
    let dpy = dpdy(P);
    let dhx = dpdx(relief);
    let dhy = dpdy(relief);
    let r1 = cross(dpy, N);
    let r2 = cross(N, dpx);
    let det = dot(dpx, r1);
    let surfGrad = sign(det) * (dhx * r1 + dhy * r2);
    let fine = 1.0 - smoothstep(0.02, 0.2, length(dpx) / max(mc.u_tile0, 1e-4));
    let Nb = normalize(abs(det) * N - surfGrad * fine);
    var Ns = N;
    if (abs(det) > 1e-12 && mc.u_relief > 0.0) { Ns = Nb; }

    var wet = 0.0;
    if (mc.u_wetBand > 0.0) { wet = 1.0 - smoothstep(mc.u_wetLevel, mc.u_wetLevel + mc.u_wetBand, P.y); }
    albedo = albedo * mix(1.0, 0.55, wet);
    let roughness = mix(mc.u_roughness, 0.3, wet);

    let ext = surfaceExtNone(Ns);
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(albedo, Ns, P, viewDir, 0.0, roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, 1.0);
    frag.surface = vec4f(packNormal(Ns), roughness, 0.75);
    return frag;
#else
    return vec4f(lit, 1.0);
#endif
}
#pragma end
`;

export const TERRAIN_SHADER_TEMPLATE = makeBuiltinShaderTemplate('terrain', 'Terrain',
    'Four texture layers (grass, dirt, snow, rock) weighted by the Terrain component, tiled by world position.', TERRAIN);
