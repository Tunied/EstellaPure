// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtinShaders.ts
 * @brief   Built-in .esshader templates — the engine's stock material starting points.
 * @details Each template carries a `#pragma fragment wgsl` twin so it compiles
 *          on the WebGPU backend. Twins run under the canonical fragment-only
 *          contract: `fs_main(v : VSOut)` with v.v_color / v.v_texCoord
 *          (+ v.v_worldPos on Lit), the batch textures as t0..t7 / s0..s7,
 *          params as mc.<name>, texture params as <name> + <name>_s, and the
 *          frame clock as tc.u_time / tc.u_viewport.
 */

import { paramDefaultValue, reflectEsshader } from './shaderReflect';

export interface BuiltinShaderTemplate {
    id: string;
    /** Menu / picker label, e.g. "Lit". */
    label: string;
    description: string;
    source: string;
    /** Initial .esmaterial `properties` for a material born from this template — DERIVED
     *  from `source`, never written down beside it (see {@link templateDefaults}). */
    defaults: Record<string, unknown>;
}

/**
 * The `properties` a new material of this template starts with: every declared non-texture
 * param at its shader default.
 *
 * Derived rather than listed, because a hand-kept copy is a second place to remember. Five
 * of the seven templates carried `defaults: {}` — their parameter vocabulary existed only
 * inside the shader string, so a material made from Dissolve came out with no `u_progress`
 * in it, and nothing anywhere named that word to whoever went looking for the slider.
 *
 * A texture param is skipped: its default is a name the engine resolves (`white`,
 * `flatnormal`), and storing that as a property would make it look like an asset ref.
 */
function templateDefaults(source: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const param of reflectEsshader(source).params) {
        if (param.type === 'texture') continue;
        out[param.name] = paramDefaultValue(param);
    }
    return out;
}

const template = (id: string, label: string, description: string, source: string): BuiltinShaderTemplate =>
    ({ id, label, description, source, defaults: templateDefaults(source) });

const SPRITE_UNLIT = `#pragma shader "Sprite Unlit"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_tint color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color * u_tint;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    return textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
}
#pragma end
`;

const SPRITE_LIT = `#pragma shader "Sprite Lit"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Unset u_normalMap = flat normal, so lighting works with no normal map assigned.
// Geometry that CARRIES normals is lit by them, and the map then perturbs that
// frame instead of replacing it with the flat one a sprite has.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
#ifdef MESH_NORMALS
    highp vec3 N = perturbNormal(normalize(v_worldNormal), v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
    // A double-sided surface is lit from the side it is seen from (glTF's rule).
    if (!gl_FrontFacing) N = -N;
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    fragColor = vec4(applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
#ifdef MESH_NORMALS
    var N = perturbNormal(normalize(v.v_worldNormal), v.v_worldXYZ, v.v_texCoord,
                          sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; }
#else
    let N = sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy);
#endif
    return vec4f(applyLighting2D(base.rgb, N, v.v_worldPos), base.a);
}
#pragma end
`;

const SPRITE_HIT_FLASH = `#pragma shader "Hit Flash"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_flash float default(0) range(0,1) ui(slider)
#pragma param u_flashColor color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Drive u_flash 1 → 0 from code (tween) for the classic damage blink.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    fragColor = vec4(mix(base.rgb, u_flashColor.rgb, u_flash), base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    return vec4f(mix(base.rgb, mc.u_flashColor.rgb, mc.u_flash), base.a);
}
#pragma end
`;

const SPRITE_OUTLINE = `#pragma shader "Outline"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_outlineColor color default(1,1,1,1)
#pragma param u_outlineWidth float default(1) range(0,8)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    highp vec2 texel = u_outlineWidth / vec2(textureSize(u_textures[0], 0));
    float edge = 0.0;
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, 0.0)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(0.0, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2( texel.x, -texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x,  texel.y)).a);
    edge = max(edge, texture(u_textures[0], v_texCoord + vec2(-texel.x, -texel.y)).a);
    fragColor = mix(vec4(u_outlineColor.rgb, edge * u_outlineColor.a), base, base.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    let texel = mc.u_outlineWidth / vec2f(textureDimensions(t0, 0));
    var edge = 0.0;
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x, 0.0), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x, 0.0), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(0.0,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(0.0, -texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f( texel.x, -texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x,  texel.y), duvx, duvy).a);
    edge = max(edge, textureSampleGrad(t0, s0, v.v_texCoord + vec2f(-texel.x, -texel.y), duvx, duvy).a);
    return mix(vec4f(mc.u_outlineColor.rgb, edge * mc.u_outlineColor.a), base, base.a);
}
#pragma end
`;

const SPRITE_DISSOLVE = `#pragma shader "Dissolve"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_progress float default(0) range(0,1) ui(slider)
#pragma param u_edgeColor color default(1,0.5,0,1)
#pragma param u_edgeWidth float default(0.08) range(0,0.5)
#pragma param u_noiseScale float default(12) range(1,64)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2(0.0, 1.0)), hash2d(i + vec2(1.0, 1.0)), f.x), f.y);
}

// u_progress 0 = intact, 1 = fully dissolved; a glowing edge leads the cut.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color;
    float n = noise2d(v_texCoord * u_noiseScale);
    float cut = u_progress * (1.0 + u_edgeWidth);
    if (n < cut - u_edgeWidth) discard;
    vec3 rgb = (n < cut) ? u_edgeColor.rgb : base.rgb;
    fragColor = vec4(rgb, base.a);
}
#pragma end

#pragma fragment wgsl
fn hash2d(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn noise2d(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2f(1.0, 0.0)), f.x),
               mix(hash2d(i + vec2f(0.0, 1.0)), hash2d(i + vec2f(1.0, 1.0)), f.x), f.y);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color;
    let n = noise2d(v.v_texCoord * mc.u_noiseScale);
    let cut = mc.u_progress * (1.0 + mc.u_edgeWidth);
    if (n < cut - mc.u_edgeWidth) { discard; }
    let rgb = select(base.rgb, mc.u_edgeColor.rgb, n < cut);
    return vec4f(rgb, base.a);
}
#pragma end
`;

const SPRITE_PIXELATE = `#pragma shader "Pixelate"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_pixels float default(32) range(2,256)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec2 uv = (floor(v_texCoord * u_pixels) + 0.5) / u_pixels;
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = (floor(v.v_texCoord * mc.u_pixels) + 0.5) / mc.u_pixels;
    return textureSampleLevel(t0, s0, uv, 0.0) * v.v_color;
}
#pragma end
`;

const SPRITE_UV_SCROLL = `#pragma shader "UV Scroll"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_scrollSpeed vec2 default(0.1,0)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// u_time.x is the engine frame clock (seconds), injected into every shader.
void main() {
    vec2 uv = fract(v_texCoord + u_time.x * u_scrollSpeed);
    fragColor = texture(u_textures[0], uv) * v_color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    let uv = fract(v.v_texCoord + tc.u_time.x * mc.u_scrollSpeed);
    return textureSampleGrad(t0, s0, uv, duvx, duvy) * v.v_color;
}
#pragma end
`;

// The shading a glTF material says beyond its base colour. Those channels are
// per-material constants and per-material samplers, which is what a material has
// and a component does not — a MeshRenderer's per-object attributes are full.
const MODEL = `#pragma shader "Model"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_emissive color default(0,0,0,1)
#pragma param u_emissiveMap texture default(white)
#pragma param u_occlusionMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
#pragma param u_metallic float default(0) range(0,1) ui(slider)
#pragma param u_roughness float default(1) range(0,1) ui(slider)
#pragma param u_metallicRoughnessMap texture default(white) texel(data)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

// One, not the batch stream's eight: a sampler array counts whole against the
// sixteen units a stage may use, and this stage also takes four maps, four the
// engine injects and a bake.
uniform sampler2D u_textures[1];

#ifdef ES_GBUFFER
// The frame draws a second attachment beside the colour: what this surface IS, for the post effects
// that need to know (reflections: how rough, how metal, which way it faces). Only a pass that has the
// attachment asks for this variant.
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;

// Octahedral normal: a unit vector in two channels, which is what an 8-bit target can hold.
vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

// Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019, as Filament spells it).
// Where the vertex normal turns quickly across a pixel — a bevel, a curved rail, a
// bolt-head — the highlight is the sum of many normals the pixel cannot resolve, and
// shading it with ONE normal makes it sparkle from frame to frame. The turn rate is the
// screen-space derivative of the normal; it widens the lobe by that variance, so the
// sparkle becomes a steady, slightly rougher highlight. Taken from the vertex normal, not
// the perturbed one: a normal map's detail is the texture filter's to average.
float specularAA(highp vec3 dndx, highp vec3 dndy, float roughness) {
    float variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    float kernel = min(2.0 * variance, 0.18);
    float alpha = roughness * roughness;
    return sqrt(sqrt(clamp(alpha * alpha + kernel, 0.0, 1.0)));
}

// Base colour rides the draw itself (slot 0 x vertex colour) — glTF's baseColor
// is what a MeshRenderer already carries. Emission is added AFTER lighting (it is light
// this surface makes) and occlusion scales only the ambient term.
// Metal-roughness packing is glTF's: roughness in green, metal in blue.
void main() {
#ifdef MESH_NORMALS
    // Before any branch: a derivative needs every fragment of its quad.
    highp vec3 dndx = dFdx(v_worldNormal);
    highp vec3 dndy = dFdy(v_worldNormal);
#endif
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    // A cutout's alpha becomes coverage: sharpened to about a texel around the
    // cutoff, so alpha-to-coverage feathers the edge instead of stair-stepping it.
    float alpha = base.a;
    if (u_alphaCutoff > 0.0) {
        alpha = (base.a - u_alphaCutoff) / max(fwidth(base.a), 1e-4) + 0.5;
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    highp vec3 N = perturbNormal(normalize(v_worldNormal), v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
    // A double-sided surface is lit from the side it is seen from (glTF's rule).
    if (!gl_FrontFacing) N = -N;
#else
    vec3 N = sampleNormal(u_normalMap, v_texCoord);
#endif
    float ao = mix(1.0, texture(u_occlusionMap, v_texCoord).r, u_occlusionStrength);
    vec3 mr = texture(u_metallicRoughnessMap, v_texCoord).rgb;
#ifdef MESH_NORMALS
    // The surface's OWN place, which a point light, a probe volume and a
    // reflection's box projection all measure against; z = 0 is a plane's answer.
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
#endif
    // specular 1: a glTF material reflects unless KHR_materials_specular says less.
    float roughness = u_roughness * mr.g;
#ifdef MESH_NORMALS
    roughness = specularAA(dndx, dndy, roughness);
#endif
    vec3 lit = applyLightingPBR(base.rgb, N, P, viewDirection(P),
                                u_metallic * mr.b, roughness, 1.0, ao);
    fragColor = vec4(lit + u_emissive.rgb * texture(u_emissiveMap, v_texCoord).rgb, alpha);
#ifdef ES_GBUFFER
    // Alpha says something was drawn here (0 is "nothing wrote"), and carries the metalness above a floor.
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.25 + 0.75 * clamp(u_metallic * mr.b, 0.0, 1.0));
#endif
}
#pragma end

#pragma fragment wgsl
// The GLSL twin's geometric specular anti-aliasing, spelled the same.
fn specularAA(dndx : vec3f, dndy : vec3f, roughness : f32) -> f32 {
    let variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
    let kernel = min(2.0 * variance, 0.18);
    let alpha = roughness * roughness;
    return sqrt(sqrt(clamp(alpha * alpha + kernel, 0.0, 1.0)));
}

#ifdef ES_GBUFFER
// What the frame's second attachment takes, beside the colour (see the GLSL twin).
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

@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> FragOut {
#else
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
#endif
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
#ifdef MESH_NORMALS
    let dndx = dpdx(v.v_worldNormal);
    let dndy = dpdy(v.v_worldNormal);
#endif
    // WGSL has no module varying: the entry point hands the injected header the
    // run its GLSL twin reads straight off one. Without this every material-shaded
    // draw read instance 0's indirect light — one probe volume for the lot.
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
    let base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
    // Before any discard: a derivative needs every fragment of its quad.
    let edge = max(fwidth(base.a), 1e-4);
    var alpha = base.a;
    if (mc.u_alphaCutoff > 0.0) {
        alpha = (base.a - mc.u_alphaCutoff) / edge + 0.5;
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    var N = perturbNormal(normalize(v.v_worldNormal), v.v_worldXYZ, v.v_texCoord,
                          sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; }
#else
    let N = sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy);
#endif
    let occl = textureSampleGrad(u_occlusionMap, u_occlusionMap_s, v.v_texCoord, duvx, duvy).r;
    let ao = mix(1.0, occl, mc.u_occlusionStrength);
    let mr = textureSampleGrad(u_metallicRoughnessMap, u_metallicRoughnessMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
#else
    let P = vec3f(v.v_worldPos, 0.0);
#endif
    var roughness = mc.u_roughness * mr.g;
#ifdef MESH_NORMALS
    roughness = specularAA(dndx, dndy, roughness);
#endif
    let lit = applyLightingPBR(base.rgb, N, P, viewDirection(P),
                               mc.u_metallic * mr.b, roughness, 1.0, ao);
    let emit = mc.u_emissive.rgb
             * textureSampleGrad(u_emissiveMap, u_emissiveMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit + emit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.25 + 0.75 * clamp(mc.u_metallic * mr.b, 0.0, 1.0));
    return frag;
#else
    return vec4f(lit + emit, alpha);
#endif
}
#pragma end
`;

export const BUILTIN_SHADER_TEMPLATES: readonly BuiltinShaderTemplate[] = [
    template('sprite-unlit', 'Unlit', 'Texture × vertex color × tint, no lighting.', SPRITE_UNLIT),
    template('sprite-lit', 'Lit', 'Lit by the scene\'s 2D lights; optional normal map.', SPRITE_LIT),
    template('sprite-hit-flash', 'Hit Flash',
        'Blend toward a flash color; drive u_flash from code for damage blinks.', SPRITE_HIT_FLASH),
    template('sprite-outline', 'Outline',
        'Colored silhouette outline around the sprite\'s opaque pixels.', SPRITE_OUTLINE),
    template('sprite-dissolve', 'Dissolve',
        'Noise-driven burn-away with a glowing edge (u_progress 0→1).', SPRITE_DISSOLVE),
    template('sprite-pixelate', 'Pixelate', 'Quantizes UVs to a coarse pixel grid.', SPRITE_PIXELATE),
    template('sprite-uv-scroll', 'UV Scroll',
        'Scrolls the texture over time (conveyors, water, clouds).', SPRITE_UV_SCROLL),
    template('model', 'Model',
        'What an imported model\'s material says: normal map, emission, occlusion, alpha cutoff.',
        MODEL),
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
