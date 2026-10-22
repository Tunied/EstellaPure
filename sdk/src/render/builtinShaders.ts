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
// What a surface has beyond a metal/rough pair. Every one is zero (or glTF's own default) for a surface that has none of it,
// and the lighting skips a layer whose strength is zero, so a plain material pays nothing for these.
#pragma param u_ior float default(1.5) range(1,3) ui(slider)
#pragma param u_specular float default(1) range(0,1) ui(slider)
#pragma param u_clearcoat float default(0) range(0,1) ui(slider)
#pragma param u_clearcoatRoughness float default(0.03) range(0,1) ui(slider)
#pragma param u_sheenColor color default(0,0,0,1)
#pragma param u_sheenRoughness float default(0.5) range(0,1) ui(slider)
#pragma param u_anisotropy float default(0) range(-1,1) ui(slider)
#pragma param u_anisotropyRotation float default(0) range(-3.1416,3.1416) ui(slider)
#pragma param u_translucency float default(0) range(0,1) ui(slider)
#pragma param u_translucencyColor color default(1,1,1,1)
#pragma param u_thickness float default(0) range(0,1) ui(slider)
#pragma param u_transmission float default(0) range(0,1) ui(slider)
#pragma param u_attenuationColor color default(1,1,1,1)
// Marks this surface as one light scatters through (skin, wax, a leaf): its pixels are drawn with alpha 0.996, which the
// Subsurface Scattering effect reads and blurs along the surface. Does nothing without that effect; the effect gives alpha back.
#pragma param u_subsurface float default(0) range(0,1) ui(slider)
// The picture of the opaque scene as it stood behind this surface, which the frame takes a copy of before it draws a material
// that holds a transmission above zero (and only then: a draw that reads it is made after the copy). The white it falls back
// to has alpha 1, and a real copy has 0.5 — which is how this tells whether it has one.
#pragma param u_sceneColor texture default(white)
#pragma param u_refractionStrength float default(1) range(0,4) ui(slider)
#pragma param u_iridescence float default(0) range(0,1) ui(slider)
#pragma param u_iridescenceIor float default(1.3) range(1,2.5) ui(slider)
#pragma param u_iridescenceThickness float default(400) range(0,1200) ui(slider)

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
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 N = perturbNormal(Ng, v_worldXYZ, v_texCoord,
                                 sampleNormal(u_normalMap, v_texCoord));
    // A double-sided surface is lit from the side it is seen from (glTF's rule).
    if (!gl_FrontFacing) { N = -N; Ng = -Ng; }
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
    SurfaceExt ext = surfaceExtNone(N);
    if (u_ior != 1.5) {
        float r = (u_ior - 1.0) / (u_ior + 1.0);
        ext.misc.x = r * r;
    }
#ifdef MESH_NORMALS
    // The coat's normal is the surface's own, not the bump map's: a coat is smooth over whatever it covers.
    if (u_clearcoat > 0.0) {
        ext.coat = vec4(u_clearcoat, max(u_clearcoatRoughness, 0.045), 0.0, 0.0);
        ext.coatN = vec4(Ng, 0.0);
    }
    if (u_anisotropy != 0.0) {
        // The direction the grooves run, from the UV frame turned by the rotation, then made to lie across N.
        highp vec3 T = perturbNormal(Ng, P, v_texCoord, vec3(cos(u_anisotropyRotation), sin(u_anisotropyRotation), 0.0));
        T -= N * dot(N, T);
        if (dot(T, T) < 1e-6) T = cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
        ext.aniso = vec4(normalize(T), clamp(u_anisotropy, -0.99, 0.99));
    }
#endif
    if (dot(u_sheenColor.rgb, vec3(1.0)) > 0.0) ext.sheen = vec4(u_sheenColor.rgb, max(u_sheenRoughness, 0.07));
    if (u_translucency > 0.0) {
        ext.scatter = vec4(u_translucencyColor.rgb * base.rgb, u_translucency * 0.5);
        ext.trans = vec4(u_translucency, u_thickness, 0.0, 0.0);
    }
    if (u_iridescence > 0.0) ext.film = vec4(u_iridescence, max(u_iridescenceIor, 1.0), u_iridescenceThickness, 0.0);
    vec3 viewDir = viewDirection(P);
    // Light that passes through: what stands behind the surface, bent by the glass and tinted by it, and less of it where the
    // surface reflects instead. The frame took a copy of the opaque scene for this draw; the ray is refracted through the
    // surface's thickness, and the copy is read where it lands, blurred by the roughness.
    vec3 seen = vec3(0.0);
    float refracted = 0.0;
    if (u_transmission > 0.0) {
        float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
        float fresnel = ext.misc.x + (1.0 - ext.misc.x) * pow(1.0 - cosV, 5.0);
        if (texture(u_sceneColor, vec2(0.5)).a < 0.75) {
            vec3 bent = refract(-viewDir, N, 1.0 / max(u_ior, 1.0));
            float depth = max(u_thickness, 0.15) * 60.0 * u_refractionStrength;
            vec4 landed = u_projection * vec4(P + bent * depth, 1.0);
            vec2 uv = landed.xy / max(landed.w, 1e-4) * 0.5 + 0.5;
            float spread = roughness * roughness * 0.04;
            vec3 behind = texture(u_sceneColor, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
            for (int i = 0; i < 8; ++i) {
                float a = float(i) * 2.39996;
                vec2 o = vec2(cos(a), sin(a)) * (spread * sqrt((float(i) + 0.5) / 8.0));
                behind += texture(u_sceneColor, clamp(uv + o, vec2(0.001), vec2(0.999))).rgb;
            }
            seen = behind / 9.0 * u_attenuationColor.rgb * (1.0 - fresnel) * u_transmission;
            refracted = 1.0;
        } else {
            // No picture to refract (the scene is not a texture here): the surface lets that much of the scene show instead,
            // by its own coverage, which dims what it reflects with it.
            alpha *= 1.0 - u_transmission * (1.0 - fresnel);
            base.rgb = mix(base.rgb, base.rgb * u_attenuationColor.rgb, u_transmission);
        }
    }
    vec3 lit = applyLightingSurface(base.rgb * (1.0 - u_transmission * refracted), N, P, viewDir,
                                    u_metallic * mr.b, roughness, u_specular, ao, ext);
    if (u_subsurface > 0.0 && u_alphaCutoff <= 0.0) alpha = min(alpha, 0.996);
    fragColor = vec4(lit + seen + u_emissive.rgb * texture(u_emissiveMap, v_texCoord).rgb, alpha);
#ifdef ES_GBUFFER
    // Alpha says something was drawn here (0 is "nothing wrote"), and carries the metalness above 0.75: a pixel that
    // multisampling averaged with an unwritten one falls below it, and an effect can tell such an edge from a surface.
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.75 + 0.25 * clamp(u_metallic * mr.b, 0.0, 1.0));
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
    var base = textureSampleGrad(t0, s0, v.v_texCoord, duvx, duvy) * v.v_color * mc.u_tint;
    // Before any discard: a derivative needs every fragment of its quad.
    let edge = max(fwidth(base.a), 1e-4);
    var alpha = base.a;
    if (mc.u_alphaCutoff > 0.0) {
        alpha = (base.a - mc.u_alphaCutoff) / edge + 0.5;
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    var N = perturbNormal(Ng, v.v_worldXYZ, v.v_texCoord,
                          sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; Ng = -Ng; }
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
    var ext = surfaceExtNone(N);
    if (mc.u_ior != 1.5) {
        let r = (mc.u_ior - 1.0) / (mc.u_ior + 1.0);
        ext.misc.x = r * r;
    }
#ifdef MESH_NORMALS
    // See the GLSL twin: the coat's normal is the surface's own, not the bump map's.
    if (mc.u_clearcoat > 0.0) {
        ext.coat = vec4f(mc.u_clearcoat, max(mc.u_clearcoatRoughness, 0.045), 0.0, 0.0);
        ext.coatN = vec4f(Ng, 0.0);
    }
    if (mc.u_anisotropy != 0.0) {
        var T = perturbNormal(Ng, P, v.v_texCoord, vec3f(cos(mc.u_anisotropyRotation), sin(mc.u_anisotropyRotation), 0.0));
        T -= N * dot(N, T);
        if (dot(T, T) < 1e-6) {
            var seed = vec3f(1.0, 0.0, 0.0);
            if (abs(N.y) < 0.99) { seed = vec3f(0.0, 1.0, 0.0); }
            T = cross(N, seed);
        }
        ext.aniso = vec4f(normalize(T), clamp(mc.u_anisotropy, -0.99, 0.99));
    }
#endif
    if (dot(mc.u_sheenColor.rgb, vec3f(1.0)) > 0.0) { ext.sheen = vec4f(mc.u_sheenColor.rgb, max(mc.u_sheenRoughness, 0.07)); }
    if (mc.u_translucency > 0.0) {
        ext.scatter = vec4f(mc.u_translucencyColor.rgb * base.rgb, mc.u_translucency * 0.5);
        ext.trans = vec4f(mc.u_translucency, mc.u_thickness, 0.0, 0.0);
    }
    if (mc.u_iridescence > 0.0) { ext.film = vec4f(mc.u_iridescence, max(mc.u_iridescenceIor, 1.0), mc.u_iridescenceThickness, 0.0); }
    let viewDir = viewDirection(P);
    var seen = vec3f(0.0);
    var refracted = 0.0;
    if (mc.u_transmission > 0.0) {
        let cosV = clamp(dot(N, viewDir), 0.0, 1.0);
        let fresnel = ext.misc.x + (1.0 - ext.misc.x) * pow(1.0 - cosV, 5.0);
        if (textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75) {
            let bent = refract(-viewDir, N, 1.0 / max(mc.u_ior, 1.0));
            let depth = max(mc.u_thickness, 0.15) * 60.0 * mc.u_refractionStrength;
            let landed = frame.projection * vec4f(P + bent * depth, 1.0);
            let w = max(landed.w, 1e-4);
            // This device's rows run down the texture, so clip y is flipped on the way to a uv.
            let uv = vec2f(landed.x / w * 0.5 + 0.5, 0.5 - landed.y / w * 0.5);
            let spread = roughness * roughness * 0.04;
            var behind = textureSampleLevel(u_sceneColor, u_sceneColor_s, clamp(uv, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
            for (var i : i32 = 0; i < 8; i = i + 1) {
                let a = f32(i) * 2.39996;
                let o = vec2f(cos(a), sin(a)) * (spread * sqrt((f32(i) + 0.5) / 8.0));
                behind = behind + textureSampleLevel(u_sceneColor, u_sceneColor_s, clamp(uv + o, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
            }
            seen = behind / 9.0 * mc.u_attenuationColor.rgb * (1.0 - fresnel) * mc.u_transmission;
            refracted = 1.0;
        } else {
            alpha *= 1.0 - mc.u_transmission * (1.0 - fresnel);
            base = vec4f(mix(base.rgb, base.rgb * mc.u_attenuationColor.rgb, vec3f(mc.u_transmission)), base.a);
        }
    }
    let lit = applyLightingSurface(base.rgb * (1.0 - mc.u_transmission * refracted), N, P, viewDir,
                                   mc.u_metallic * mr.b, roughness, mc.u_specular, ao, ext);
    if (mc.u_subsurface > 0.0 && mc.u_alphaCutoff <= 0.0) { alpha = min(alpha, 0.996); }
    let emit = mc.u_emissive.rgb
             * textureSampleGrad(u_emissiveMap, u_emissiveMap_s, v.v_texCoord, duvx, duvy).rgb;
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit + seen + emit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.75 + 0.25 * clamp(mc.u_metallic * mr.b, 0.0, 1.0));
    return frag;
#else
    return vec4f(lit + seen + emit, alpha);
#endif
}
#pragma end
`;

// A horizontal body of water: waves that travel, the scene seen through it bent and tinted by how much water lies in front of it, the sky
// and the lights reflected off it, and foam where it meets what it lies on and on the crests. It reads the picture of the opaque scene
// behind it and how far each pixel of that is from the eye, which the frame takes before it draws a material that declares them, so
// the depth of the water at a pixel is what is measured, not a number the author guessed. Where the device cannot hold the distances
// (no float target) it falls back to `u_fallbackDepth` as the depth everywhere.
const WATER = `#pragma shader "Water"
#pragma version 300 es
#pragma domain Lit
// The colour the water scatters back: lighter where it is shallow, darker where it is deep.
#pragma param u_shallowColor color default(0.10,0.42,0.46,1)
#pragma param u_deepColor color default(0.01,0.08,0.15,1)
// How fast each colour is absorbed along the way through the water (red goes first), and how thick the water is, per world unit.
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_density float default(0.12) range(0,4) ui(slider)
// The waves: height, length of the longest, how sharp their crests are drawn, how fast they travel and which way (degrees).
#pragma param u_waveHeight float default(0.3) range(0,8) ui(slider)
#pragma param u_waveLength float default(14) range(0.5,300) ui(slider)
#pragma param u_waveSpeed float default(1) range(0,4) ui(slider)
#pragma param u_waveDirection float default(30) range(0,360) ui(slider)
// The small ripples the long waves carry: how steep and how long each is.
#pragma param u_rippleStrength float default(0.3) range(0,1) ui(slider)
#pragma param u_rippleLength float default(2.5) range(0.1,40) ui(slider)
#pragma param u_roughness float default(0.04) range(0,1) ui(slider)
// How far what is seen through the water is shifted by its waves, and the depth of water at which that stops growing.
#pragma param u_refractionStrength float default(1) range(0,4) ui(slider)
#pragma param u_distortionRange float default(12) range(0.1,200) ui(slider)
// Foam: its colour, how deep the water is where it begins at the shore (world units), and how much of the wave crests carry it.
#pragma param u_foamColor color default(0.95,0.97,1,1)
#pragma param u_foamWidth float default(1.2) range(0,20) ui(slider)
#pragma param u_foamCrest float default(0.5) range(0,1) ui(slider)
// The depth taken where the device could not measure one.
#pragma param u_fallbackDepth float default(4) range(0,200) ui(slider)
#pragma param u_sceneColor texture default(white)
#pragma param u_sceneDepthMap texture default(white) texel(data)

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

float waterHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
               mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/// The ripples' height at p: two layers of noise drifting in different directions.
float ripples(vec2 p, float time) {
    return waterNoise(p / u_rippleLength + vec2(0.31, 0.12) * time) * 0.6
         + waterNoise(p / (u_rippleLength * 0.43) - vec2(0.17, 0.4) * time) * 0.4;
}

/// The slope of the water's surface at p (d height / d x, d height / d z) and how near the waves are to a crest, 0 to 1.
/// Four waves a few directions apart, each a peaked sine (exp(sin - 1)) whose crests are narrower than its troughs.
vec2 waveSlope(vec2 p, float time, float dist, out float crest) {
    const vec4 SET[4] = vec4[4](vec4(0.0, 1.0, 1.0, 1.0), vec4(28.0, 0.62, 0.55, 1.1), vec4(-37.0, 0.37, 0.3, 1.2), vec4(71.0, 0.21, 0.15, 1.35));
    vec2 slope = vec2(0.0);
    float crestSum = 0.0;
    float weightSum = 0.0;
    float base = radians(u_waveDirection);
    for (int i = 0; i < 4; ++i) {
        float length_ = u_waveLength * SET[i].y;
        float k = 6.2831853 / length_;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float omega = sqrt(9.8 * k) * u_waveSpeed * SET[i].w;
        float theta = k * dot(d, p) - omega * time;
        float e = exp(sin(theta) - 1.0);
        // A wave much shorter than a pixel is noise, not a wave: it fades out with distance.
        float seen = clamp(1.0 - dist / (length_ * 220.0), 0.0, 1.0);
        slope += d * (u_waveHeight * SET[i].z * e * cos(theta) * k * seen);
        crestSum += e * SET[i].z;
        weightSum += SET[i].z;
    }
    crest = crestSum / weightSum;
    return slope;
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
#endif
    float time = u_time.x;
    vec3 viewDir = viewDirection(P);
    float waterDist = u_camera.w > 0.5 ? length(P - u_camera.xyz) : -dot(P, u_camera.xyz);

    // The surface: the long waves, then the ripples they carry, flattened with distance so the far water is calm rather than aliased.
    float crest;
    vec2 slope = waveSlope(P.xz, time, waterDist, crest);
    float rippleFade = clamp(1.0 - waterDist / (u_rippleLength * 180.0), 0.0, 1.0);
    float e = u_rippleLength * 0.1;
    vec2 ripple = vec2(ripples(P.xz + vec2(e, 0.0), time) - ripples(P.xz - vec2(e, 0.0), time),
                       ripples(P.xz + vec2(0.0, e), time) - ripples(P.xz - vec2(0.0, e), time)) / (2.0 * e);
    slope += ripple * (u_rippleStrength * u_rippleLength * rippleFade);
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 Ngeo = vec3(0.0, 1.0, 0.0);
    // Seen from below, the surface turns over.
    if (viewDir.y < 0.0) { N = -N; Ngeo = -Ngeo; }

    // What is behind the water: the picture and the distance, where the frame took them.
    bool haveColor = texture(u_sceneColor, vec2(0.5)).a < 0.75;
    bool haveDepth = haveColor && texture(u_sceneDepthMap, vec2(0.5)).a < 0.75;
    vec4 clip0 = u_projection * vec4(P, 1.0);
    vec2 uv0 = clip0.xy / max(clip0.w, 1e-4) * 0.5 + 0.5;
    float behindDist = haveDepth ? texture(u_sceneDepthMap, clamp(uv0, vec2(0.001), vec2(0.999))).r : waterDist + u_fallbackDepth;
    float column0 = max(behindDist - waterDist, 0.0);

    // Bent by the waves: the ray through the tilted surface against the ray through a flat one, over as much water as there is.
    const float RATIO = 1.0 / 1.333;
    vec3 bentWave = refract(-viewDir, N, RATIO);
    vec3 bentFlat = refract(-viewDir, Ngeo, RATIO);
    float reach = min(column0, u_distortionRange) * u_refractionStrength;
    vec4 clip1 = u_projection * vec4(P + (bentWave - bentFlat) * reach, 1.0);
    vec2 uv1 = clip1.xy / max(clip1.w, 1e-4) * 0.5 + 0.5;
    vec3 behind = vec3(0.0);
    float column = column0;
    if (haveColor) {
        uv1 = clamp(uv1, vec2(0.001), vec2(0.999));
        float dist1 = haveDepth ? texture(u_sceneDepthMap, uv1).r : behindDist;
        // Something standing in front of the water cannot be what is seen through it: keep the straight-through lookup.
        if (dist1 < waterDist) { uv1 = clamp(uv0, vec2(0.001), vec2(0.999)); dist1 = behindDist; }
        behind = texture(u_sceneColor, uv1).rgb;
        column = max(dist1 - waterDist, 0.0);
    }

    // The water in between takes the light out of it, red first, and gives back its own colour: more of it the deeper it goes.
    vec3 transmit = exp(-u_absorption.rgb * (u_density * column));
    float murk = 1.0 - dot(transmit, vec3(1.0 / 3.0));
    vec3 scatterColor = mix(u_shallowColor.rgb, u_deepColor.rgb, 1.0 - exp(-column * u_density * 0.5));

    // Foam: along the shore, where the water is shallow, broken by noise that moves; and on the crests of the waves.
    float vertical = column * max(abs(viewDir.y), 0.15);
    float foamScale = 1.0 / (u_rippleLength * 1.2);
    float breakup = waterNoise(P.xz * foamScale + vec2(time * 0.07, time * 0.05)) * 0.6 + waterNoise(P.xz * foamScale * 3.0 - vec2(time * 0.13, 0.0)) * 0.4;
    float pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    float shore = haveDepth && u_foamWidth > 0.0 ? clamp((1.0 - vertical / (u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0) : 0.0;
    float onCrest = u_foamCrest > 0.0 ? smoothstep(1.0 - 0.3 * u_foamCrest, 1.0, crest) * smoothstep(0.35, 0.75, breakup) : 0.0;
    float foam = clamp(max(shore, onCrest * u_foamCrest), 0.0, 1.0);

    SurfaceExt ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    vec3 albedo = mix(scatterColor * murk, u_foamColor.rgb, foam);
    float roughness = mix(u_roughness, 0.7, foam);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    float fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    vec3 seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    fragColor = vec4(lit + seen, haveColor ? 1.0 : 0.85);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.75);
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
#endif

fn waterHash(p0 : vec2f) -> f32 {
    var p = fract(p0 * vec2f(0.1031, 0.1030));
    p = p + dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
fn waterNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2f(1.0, 0.0)), f.x),
               mix(waterHash(i + vec2f(0.0, 1.0)), waterHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn ripples(p : vec2f, time : f32) -> f32 {
    return waterNoise(p / mc.u_rippleLength + vec2f(0.31, 0.12) * time) * 0.6
         + waterNoise(p / (mc.u_rippleLength * 0.43) - vec2f(0.17, 0.4) * time) * 0.4;
}

struct Waves { slope : vec2f, crest : f32 };

fn waveSlope(p : vec2f, time : f32, dist : f32) -> Waves {
    var wave = array<vec4f, 4>(vec4f(0.0, 1.0, 1.0, 1.0), vec4f(28.0, 0.62, 0.55, 1.1), vec4f(-37.0, 0.37, 0.3, 1.2), vec4f(71.0, 0.21, 0.15, 1.35));
    var slope = vec2f(0.0);
    var crestSum = 0.0;
    var weightSum = 0.0;
    let base = radians(mc.u_waveDirection);
    for (var i : i32 = 0; i < 4; i = i + 1) {
        let spec = wave[i];
        let span = mc.u_waveLength * spec.y;
        let k = 6.2831853 / span;
        let a = base + radians(spec.x);
        let d = vec2f(sin(a), cos(a));
        let omega = sqrt(9.8 * k) * mc.u_waveSpeed * spec.w;
        let theta = k * dot(d, p) - omega * time;
        let e = exp(sin(theta) - 1.0);
        let seen = clamp(1.0 - dist / (span * 220.0), 0.0, 1.0);
        slope = slope + d * (mc.u_waveHeight * spec.z * e * cos(theta) * k * seen);
        crestSum = crestSum + e * spec.z;
        weightSum = weightSum + spec.z;
    }
    var out : Waves;
    out.slope = slope;
    out.crest = crestSum / weightSum;
    return out;
}

#ifdef ES_GBUFFER
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
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
#endif
    let time = tc.u_time.x;
    let viewDir = viewDirection(P);
    var waterDist = -dot(P, frame.camera.xyz);
    if (frame.camera.w > 0.5) { waterDist = length(P - frame.camera.xyz); }

    let waves = waveSlope(P.xz, time, waterDist);
    var slope = waves.slope;
    let rippleFade = clamp(1.0 - waterDist / (mc.u_rippleLength * 180.0), 0.0, 1.0);
    let eps = mc.u_rippleLength * 0.1;
    let ripple = vec2f(ripples(P.xz + vec2f(eps, 0.0), time) - ripples(P.xz - vec2f(eps, 0.0), time),
                       ripples(P.xz + vec2f(0.0, eps), time) - ripples(P.xz - vec2f(0.0, eps), time)) / (2.0 * eps);
    slope = slope + ripple * (mc.u_rippleStrength * mc.u_rippleLength * rippleFade);
    var N = normalize(vec3f(-slope.x, 1.0, -slope.y));
    var Ngeo = vec3f(0.0, 1.0, 0.0);
    if (viewDir.y < 0.0) { N = -N; Ngeo = -Ngeo; }

    let haveColor = textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75;
    let haveDepth = haveColor && textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, vec2f(0.5), 0.0).a < 0.75;
    let clip0 = frame.projection * vec4f(P, 1.0);
    let w0 = max(clip0.w, 1e-4);
    // This device's rows run down the texture, so clip y is flipped on the way to a uv.
    let uv0 = vec2f(clip0.x / w0 * 0.5 + 0.5, 0.5 - clip0.y / w0 * 0.5);
    var behindDist = waterDist + mc.u_fallbackDepth;
    if (haveDepth) { behindDist = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, clamp(uv0, vec2f(0.001), vec2f(0.999)), 0.0).r; }
    let column0 = max(behindDist - waterDist, 0.0);

    let ratio = 1.0 / 1.333;
    let bentWave = refract(-viewDir, N, ratio);
    let bentFlat = refract(-viewDir, Ngeo, ratio);
    let reach = min(column0, mc.u_distortionRange) * mc.u_refractionStrength;
    let clip1 = frame.projection * vec4f(P + (bentWave - bentFlat) * reach, 1.0);
    let w1 = max(clip1.w, 1e-4);
    var uv1 = vec2f(clip1.x / w1 * 0.5 + 0.5, 0.5 - clip1.y / w1 * 0.5);
    var behind = vec3f(0.0);
    var column = column0;
    if (haveColor) {
        uv1 = clamp(uv1, vec2f(0.001), vec2f(0.999));
        var dist1 = behindDist;
        if (haveDepth) { dist1 = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, uv1, 0.0).r; }
        if (dist1 < waterDist) { uv1 = clamp(uv0, vec2f(0.001), vec2f(0.999)); dist1 = behindDist; }
        behind = textureSampleLevel(u_sceneColor, u_sceneColor_s, uv1, 0.0).rgb;
        column = max(dist1 - waterDist, 0.0);
    }

    let transmit = exp(-mc.u_absorption.rgb * (mc.u_density * column));
    let murk = 1.0 - dot(transmit, vec3f(1.0 / 3.0));
    let scatterColor = mix(mc.u_shallowColor.rgb, mc.u_deepColor.rgb, vec3f(1.0 - exp(-column * mc.u_density * 0.5)));

    let vertical = column * max(abs(viewDir.y), 0.15);
    let foamScale = 1.0 / (mc.u_rippleLength * 1.2);
    let breakup = waterNoise(P.xz * foamScale + vec2f(time * 0.07, time * 0.05)) * 0.6 + waterNoise(P.xz * foamScale * 3.0 - vec2f(time * 0.13, 0.0)) * 0.4;
    let pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    var shore = 0.0;
    if (haveDepth && mc.u_foamWidth > 0.0) { shore = clamp((1.0 - vertical / (mc.u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0); }
    var onCrest = 0.0;
    if (mc.u_foamCrest > 0.0) { onCrest = smoothstep(1.0 - 0.3 * mc.u_foamCrest, 1.0, waves.crest) * smoothstep(0.35, 0.75, breakup); }
    let foam = clamp(max(shore, onCrest * mc.u_foamCrest), 0.0, 1.0);

    var ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    let albedo = mix(scatterColor * murk, mc.u_foamColor.rgb, vec3f(foam));
    let roughness = mix(mc.u_roughness, 0.7, foam);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    let cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    let fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    let seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    var alpha = 0.85;
    if (haveColor) { alpha = 1.0; }
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit + seen, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.75);
    return frag;
#else
    return vec4f(lit + seen, alpha);
#endif
}
#pragma end
`;

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

// Plants that sway: the vertex hook bends by the weights the Foliage component paints in the vertex colour (red the height up the plant,
// green its own phase, blue how much light reaches it), with a travelling gust and a flutter. Two-sided and translucent.
const FOLIAGE = `#pragma shader "Foliage"
#pragma version 300 es
#pragma domain Lit
#pragma param u_baseColor color default(0.14,0.30,0.08,1)
#pragma param u_tipColor color default(0.55,0.72,0.25,1)
// A texture over the plant (leaves, bark), and whether it is used at all: grass is drawn from the two colours and wants none.
#pragma param u_albedo texture default(white)
#pragma param u_useTexture float default(0) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0.5) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
#pragma param u_roughness float default(0.8) range(0,1) ui(slider)
// Light that comes through a leaf from behind, and how thick the leaf is.
#pragma param u_translucency float default(0.5) range(0,1) ui(slider)
#pragma param u_thickness float default(0.3) range(0,1) ui(slider)
// The wind: how hard it blows, how fast it moves, where it comes from (degrees), how long a gust is (the lower, the longer), and how much flutter rides on it.
#pragma param u_windStrength float default(2) range(0,20) ui(slider)
#pragma param u_windSpeed float default(1.2) range(0,6) ui(slider)
#pragma param u_windDirection float default(40) range(0,360) ui(slider)
#pragma param u_gustScale float default(0.02) range(0.001,0.5) ui(slider)
#pragma param u_flutter float default(0.4) range(0,4) ui(slider)
#pragma vertexbounds 30
#pragma vertexoffset
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    float weight = es_vertexColor.r;
    float phase = es_vertexColor.g * 6.2831853;
    vec3 anchor = (esInstanceModel() * vec4(local, 1.0)).xyz;
    float angle = radians(u_windDirection);
    vec2 dir = vec2(sin(angle), cos(angle));
    float t = u_time.x * u_windSpeed;
    float gust = sin(dot(anchor.xz, dir) * u_gustScale - t * 1.3) * 0.5 + 0.5;
    float flutter = sin(t * 3.1 + phase + anchor.x * 0.7) * u_flutter;
    float sway = (gust + 0.25 * sin(t + phase)) * u_windStrength + flutter * weight;
    float bend = weight * weight * sway;
    local.xz += dir * bend;
    // The length is kept: what the sideways bend takes from the height it gives back by lowering the tip.
    local.y -= abs(bend) * 0.35 * weight;
}
#pragma end

#pragma vertexoffset wgsl
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    let weight = es_vertexColor.r;
    let phase = es_vertexColor.g * 6.2831853;
    let anchor = (esInstanceModel() * vec4f(*local, 1.0)).xyz;
    let angle = radians(mc.u_windDirection);
    let dir = vec2f(sin(angle), cos(angle));
    let t = tc.u_time.x * mc.u_windSpeed;
    let gust = sin(dot(anchor.xz, dir) * mc.u_gustScale - t * 1.3) * 0.5 + 0.5;
    let flutter = sin(t * 3.1 + phase + anchor.x * 0.7) * mc.u_flutter;
    let sway = (gust + 0.25 * sin(t + phase)) * mc.u_windStrength + flutter * weight;
    let bend = weight * weight * sway;
    (*local).x = (*local).x + dir.x * bend;
    (*local).z = (*local).z + dir.y * bend;
    (*local).y = (*local).y - abs(bend) * 0.35 * weight;
}
#pragma end

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
    if (!gl_FrontFacing) N = -N;
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
#endif
    float height = clamp(v_color.r, 0.0, 1.0);
    float light = v_color.b;
    vec4 tex = texture(u_albedo, v_texCoord);
    vec3 albedo = mix(u_baseColor.rgb, u_tipColor.rgb, height);
    float alpha = 1.0;
    if (u_useTexture > 0.5) {
        albedo *= tex.rgb;
        alpha = tex.a;
        alpha = (alpha - u_alphaCutoff) / max(fwidth(alpha), 1e-4) + 0.5;
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
    albedo *= light;
    SurfaceExt ext = surfaceExtNone(N);
    if (u_translucency > 0.0) {
        ext.scatter = vec4(albedo * 1.3, u_translucency * 0.5);
        ext.trans = vec4(u_translucency, u_thickness, 0.0, 0.0);
    }
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, u_roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, alpha);
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

@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> FragOut {
#else
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
#endif
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
    let tex = textureSampleGrad(u_albedo, u_albedo_s, v.v_texCoord, duvx, duvy);
    let edge = max(fwidth(tex.a), 1e-4);
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
    var N = normalize(v.v_worldNormal);
    if (!front) { N = -N; }
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
#endif
    let height = clamp(v.v_color.r, 0.0, 1.0);
    let light = v.v_color.b;
    var albedo = mix(mc.u_baseColor.rgb, mc.u_tipColor.rgb, vec3f(height));
    var alpha = 1.0;
    if (mc.u_useTexture > 0.5) {
        albedo = albedo * tex.rgb;
        alpha = (tex.a - mc.u_alphaCutoff) / edge + 0.5;
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
    albedo = albedo * light;
    var ext = surfaceExtNone(N);
    if (mc.u_translucency > 0.0) {
        ext.scatter = vec4f(albedo * 1.3, mc.u_translucency * 0.5);
        ext.trans = vec4f(mc.u_translucency, mc.u_thickness, 0.0, 0.0);
    }
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, mc.u_roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, alpha);
    frag.surface = vec4f(packNormal(N), mc.u_roughness, 0.75);
    return frag;
#else
    return vec4f(lit, alpha);
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
    template('water', 'Water',
        'Waves, refraction, reflection, depth absorption and foam for a horizontal body of water.', WATER),
    template('terrain', 'Terrain',
        'Four texture layers (grass, dirt, snow, rock) weighted by the Terrain component, tiled by world position.', TERRAIN),
    template('foliage', 'Foliage',
        'Plants that sway in the wind: a vertex bend by painted weights, two-sided and translucent, with an optional cutout texture.', FOLIAGE),
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
