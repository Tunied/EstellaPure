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
// The wide, slow variation laid over the first layer so a big meadow does not read as one repeated tile.
#pragma param u_macroVariation float default(0.35) range(0,1) ui(slider)
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

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    vec4 w = max(v_color, vec4(0.0));
    w /= max(dot(w, vec4(1.0)), 1e-4);
    // The strongest layer wins its seam more cleanly the higher the sharpness.
    w = pow(w, vec4(u_sharpness));
    w /= max(dot(w, vec4(1.0)), 1e-4);

    vec3 c0 = texture(u_layer0, P.xz / u_tile0).rgb * u_tint0.rgb;
    c0 *= mix(1.0, texture(u_layer0, P.xz / (u_tile0 * 7.3)).r * 1.8, u_macroVariation);
    vec3 c1 = texture(u_layer1, P.xz / u_tile1).rgb * u_tint1.rgb;
    vec3 c2 = texture(u_layer2, P.xz / u_tile2).rgb * u_tint2.rgb;
    // Rock is seen from three sides, in proportion to how the ground faces them, so a sheer face is not stretched.
    vec3 axis = pow(abs(N), vec3(4.0));
    axis /= dot(axis, vec3(1.0));
    vec3 c3 = (texture(u_layer3, P.zy / u_tile3).rgb * axis.x
             + texture(u_layer3, P.xz / u_tile3).rgb * axis.y
             + texture(u_layer3, P.xy / u_tile3).rgb * axis.z) * u_tint3.rgb;
    vec3 albedo = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;

    SurfaceExt ext = surfaceExtNone(N);
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, u_roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), u_roughness, 0.75);
#endif
}
#pragma end

#pragma fragment wgsl
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
    // Every sample is taken here, in uniform control flow, where a derivative is allowed.
    let layer0 = textureSample(u_layer0, u_layer0_s, P.xz / mc.u_tile0).rgb;
    let macro0 = textureSample(u_layer0, u_layer0_s, P.xz / (mc.u_tile0 * 7.3)).r;
    let layer1 = textureSample(u_layer1, u_layer1_s, P.xz / mc.u_tile1).rgb;
    let layer2 = textureSample(u_layer2, u_layer2_s, P.xz / mc.u_tile2).rgb;
    let rockX = textureSample(u_layer3, u_layer3_s, P.zy / mc.u_tile3).rgb;
    let rockY = textureSample(u_layer3, u_layer3_s, P.xz / mc.u_tile3).rgb;
    let rockZ = textureSample(u_layer3, u_layer3_s, P.xy / mc.u_tile3).rgb;

    var w = max(v.v_color, vec4f(0.0));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);
    w = pow(w, vec4f(mc.u_sharpness));
    w = w / max(dot(w, vec4f(1.0)), 1e-4);

    let c0 = layer0 * mc.u_tint0.rgb * mix(1.0, macro0 * 1.8, mc.u_macroVariation);
    let c1 = layer1 * mc.u_tint1.rgb;
    let c2 = layer2 * mc.u_tint2.rgb;
    var axis = pow(abs(N), vec3f(4.0));
    axis = axis / dot(axis, vec3f(1.0));
    let c3 = (rockX * axis.x + rockY * axis.y + rockZ * axis.z) * mc.u_tint3.rgb;
    let albedo = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;

    let ext = surfaceExtNone(N);
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, mc.u_roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, 1.0);
    frag.surface = vec4f(packNormal(N), mc.u_roughness, 0.75);
    return frag;
#else
    return vec4f(lit, 1.0);
#endif
}
#pragma end
`;

export const TERRAIN_SHADER_TEMPLATE = makeBuiltinShaderTemplate('terrain', 'Terrain',
    'Four texture layers (grass, dirt, snow, rock) weighted by the Terrain component, tiled by world position.', TERRAIN);
