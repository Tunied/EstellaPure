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
import { CAUSTICS_GLSL, CAUSTICS_WGSL } from './waterCaustics';

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
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
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
// Where the waves are measured. 0 is the world's xz plane, which is what a flat plane of water wants. 1 is the body's own space: the mesh's uv is its
// local x and z (plus u_origin, which a body that follows the camera moves so the waves stay put), and the waves then lift the geometry and follow the
// body's tilt, which is what the WaterBody component builds.
#pragma param u_waveSpace float default(0) range(0,1) ui(slider)
#pragma param u_origin vec2 default(0,0)
// The cell size of the mesh's finest ring, for a body the WaterBody component built: a vertex in a coarser ring (its colour's red says which) fades the
// waves it cannot draw, those shorter than six of its cells. 0 draws every wave at every vertex.
#pragma param u_cellSize float default(0) range(0,100) ui(slider)
// A lake's shore, baked by the WaterBody component over its box: red the signed distance to its outline (0.5 at the edge), green how deep the water is,
// blue the share of the waves kept, all over u_shoreRange. The pixels outside the outline are cut, the waves die toward the shore, and it foams there.
#pragma param u_shoreOn float default(0) range(0,1) ui(slider)
#pragma param u_shoreMap texture default(white) texel(data)
#pragma param u_shoreOrigin vec2 default(0,0)
#pragma param u_shoreSize vec2 default(1,1)
#pragma param u_shoreRange float default(16) range(0.01,10000) ui(slider)
// A river's current: how fast it runs (world units a second, 0 for still water) along the direction the mesh's vertex colour gives (red and green) at the speed
// its blue says (half is the nominal), and how long, in seconds, each of the two copies of the surface the shader carries downstream lives before the other takes over.
#pragma param u_flowSpeed float default(0) range(0,50) ui(slider)
#pragma param u_flowCycle float default(2) range(0.2,20) ui(slider)
// How much of the waves lifts the geometry: 1 for a lake or an ocean, 0 for a river, whose surface is drawn flat and moved only in the shading.
#pragma param u_geoWaves float default(1) range(0,1) ui(slider)
// The net of light the waves throw on what is under the water: how strong it is, how large one cell of it is (world units), and how fast it swims. The Underwater
// effect draws the same one from below, with these numbers, so the two halves of the picture agree.
#pragma param u_causticStrength float default(0.6) range(0,3) ui(slider)
#pragma param u_causticScale float default(2) range(0.05,2000) ui(slider)
#pragma param u_causticSpeed float default(0.35) range(0,4) ui(slider)
// What the quality level allows (the WaterBody component writes these): how many of the four waves are summed, whether the surface seen from below mirrors the world under it,
// and whether the sun's web of light is drawn on what lies under the water.
#pragma param u_waveCount float default(4) range(1,4) ui(slider)
#pragma param u_mirror float default(1) range(0,1) ui(slider)
#pragma param u_causticOn float default(1) range(0,1) ui(slider)
// The disturbance the water keeps (WaterBody ripples): a window of the body's xz plane, red the height of the ripples (0.5 at rest, u_rippleRange above or below at 1 and 0)
// and green the foam they left, as the CPU stepped them. u_rippleSize is the window's side, u_rippleTexel one texel of it.
#pragma param u_rippleOn float default(0) range(0,1) ui(slider)
#pragma param u_rippleMap texture default(white) texel(data)
#pragma param u_rippleOrigin vec2 default(0,0)
#pragma param u_rippleSize float default(64) range(0.01,100000) ui(slider)
#pragma param u_rippleTexel float default(0.0156) range(0,1) ui(slider)
#pragma param u_rippleRange float default(1) range(0.0001,1000) ui(slider)
#pragma param u_sceneColor texture default(white)
#pragma param u_sceneDepthMap texture default(white) texel(data)

#pragma vertexbounds 16
#pragma vertexoffset
// The height of the waves at p: the same four peaked sines the fragment takes its slope from, so the surface that is lit is the one that is drawn.
float waterWaveHeight(vec2 p, float time, float cell) {
    const vec4 SET[4] = vec4[4](vec4(0.0, 1.0, 1.0, 1.0), vec4(28.0, 0.62, 0.55, 1.1), vec4(-37.0, 0.37, 0.3, 1.2), vec4(71.0, 0.21, 0.15, 1.35));
    float height = 0.0;
    float base = radians(u_waveDirection);
    for (int i = 0; i < 4; ++i) {
        if (float(i) >= u_waveCount) break;
        float length_ = u_waveLength * SET[i].y;
        float k = 6.2831853 / length_;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float omega = sqrt(9.8 * k) * u_waveSpeed * SET[i].w;
        float fade = cell > 0.0 ? clamp((length_ / cell - 3.0) / 3.0, 0.0, 1.0) : 1.0;
        height += u_waveHeight * SET[i].z * exp(sin(k * dot(d, p) - omega * time) - 1.0) * fade;
    }
    return height;
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    if (u_waveSpace < 0.5) return;
    float cell = u_cellSize > 0.0 ? u_cellSize * exp2(es_vertexColor.r * 7.0) : 0.0;
    float damp = u_shoreOn > 0.5 ? es_vertexColor.g : 1.0;
    local.y += waterWaveHeight(uv + u_origin, u_time.x, cell) * damp * u_geoWaves;
}
#pragma end

#pragma vertexoffset wgsl
fn waterWaveHeight(p : vec2f, time : f32, cell : f32) -> f32 {
    var wave = array<vec4f, 4>(vec4f(0.0, 1.0, 1.0, 1.0), vec4f(28.0, 0.62, 0.55, 1.1), vec4f(-37.0, 0.37, 0.3, 1.2), vec4f(71.0, 0.21, 0.15, 1.35));
    var height = 0.0;
    let base = radians(mc.u_waveDirection);
    for (var i : i32 = 0; i < 4; i = i + 1) {
        if (f32(i) >= mc.u_waveCount) { break; }
        let spec = wave[i];
        let span = mc.u_waveLength * spec.y;
        let k = 6.2831853 / span;
        let a = base + radians(spec.x);
        let d = vec2f(sin(a), cos(a));
        let omega = sqrt(9.8 * k) * mc.u_waveSpeed * spec.w;
        var fade = 1.0;
        if (cell > 0.0) { fade = clamp((span / cell - 3.0) / 3.0, 0.0, 1.0); }
        height = height + mc.u_waveHeight * spec.z * exp(sin(k * dot(d, p) - omega * time) - 1.0) * fade;
    }
    return height;
}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    if (mc.u_waveSpace < 0.5) { return; }
    var cell = 0.0;
    if (mc.u_cellSize > 0.0) { cell = mc.u_cellSize * exp2(es_vertexColor.r * 7.0); }
    var damp = 1.0;
    if (mc.u_shoreOn > 0.5) { damp = es_vertexColor.g; }
    (*local).y = (*local).y + waterWaveHeight(uv + mc.u_origin, tc.u_time.x, cell) * damp * mc.u_geoWaves;
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
        if (float(i) >= u_waveCount) break;
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

${CAUSTICS_GLSL}
/// The first directional light that shines: xyz is where it stands in the sky, w 1 if there is one, color its colour and strength, tiles its place in the shadow atlas.
void waterSun(out vec4 dir, out vec4 color, out ivec2 tiles) {
    dir = vec4(0.0);
    color = vec4(0.0);
    tiles = ivec2(0);
    for (int i = 0; i < 16; ++i) {
        Light l = u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            dir = vec4(-normalize(vec3(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            color = l.color;
            tiles = ivec2(int(l.shadowMap.x), int(l.shadowMap.y));
            return;
        }
    }
}

/// Whether the sun reaches a point: one tap of the shadow map, 1 where there is none.
float waterSunVisibility(vec3 worldPos, int first, int count) {
#ifdef ES_RECEIVE_SHADOW
    if (u_shadowParams.x < 0.5 || count <= 0) return 1.0;
    for (int k = 0; k < 16; ++k) {
        if (k >= count) break;
        int t = first + k;
        vec4 c = u_shadowMatrix[t] * vec4(worldPos, 1.0);
        if (c.w <= 0.0) continue;
        vec3 proj = c.xyz / c.w;
        vec2 uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) continue;
        vec4 rect = u_shadowTile[t];
        vec2 at = rect.xy + uv * rect.z;
        vec2 lo = rect.xy + u_shadowParams.y * 0.5;
        vec2 hi = rect.xy + rect.z - u_shadowParams.y * 0.5;
        float d = unpackDepth(textureLod(u_shadowMap, clamp(at, lo, hi), 0.0).rgb);
        return d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025 ? 0.0 : 1.0;
    }
#endif
    return 1.0;
}

/// What a ray from p along r meets in the picture of the scene the frame copied, as a colour with alpha 1, or alpha 0 where it meets nothing on screen.
vec4 waterReflect(vec3 p, vec3 r, float eyeDist) {
    float stride = max(0.5, eyeDist * 0.03);
    float travelled = stride;
    for (int i = 0; i < 20; ++i) {
        vec3 q = p + r * travelled;
        vec4 clip = u_projection * vec4(q, 1.0);
        if (clip.w <= 1e-4) break;
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float qDist = u_camera.w > 0.5 ? length(q - u_camera.xyz) : -dot(q, u_camera.xyz);
        float sceneDist = textureLod(u_sceneDepthMap, uv, 0.0).r;
        // The ray has gone behind something the picture holds: that is what it met, if it did not skip clean through a thin one.
        if (sceneDist < qDist && qDist - sceneDist < stride * 2.0 + 1.0) return vec4(textureLod(u_sceneColor, uv, 0.0).rgb, 1.0);
        stride *= 1.25;
        travelled += stride;
    }
    return vec4(0.0);
}

/// The slope of the surface at p and how near it is to a crest: the waves, and the ripples they carry, flattened with distance.
vec2 waterSurface(vec2 p, float time, float dist, out float crest) {
    vec2 slope = waveSlope(p, time, dist, crest);
    float rippleFade = clamp(1.0 - dist / (u_rippleLength * 180.0), 0.0, 1.0);
    float e = u_rippleLength * 0.1;
    vec2 ripple = vec2(ripples(p + vec2(e, 0.0), time) - ripples(p - vec2(e, 0.0), time),
                       ripples(p + vec2(0.0, e), time) - ripples(p - vec2(0.0, e), time)) / (2.0 * e);
    return slope + ripple * (u_rippleStrength * u_rippleLength * rippleFade);
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
    vec2 wp = u_waveSpace > 0.5 ? v_texCoord + u_origin : P.xz;
    // The lake's shore at this pixel (a texture read, taken before any branch).
    vec4 shoreTex = texture(u_shoreMap, clamp((v_texCoord - u_shoreOrigin) / max(u_shoreSize, vec2(1e-4)), vec2(0.0), vec2(1.0)));
    float shoreDist = (shoreTex.r - 0.5) * 2.0 * u_shoreRange;
    float shoreDepth = shoreTex.g * u_shoreRange;
    float damp = u_shoreOn > 0.5 ? shoreTex.b : 1.0;
    // The ripples at this pixel: their height on four sides gives the slope they add, and the foam is what they left (reads taken before any branch).
    vec2 ripUv = (wp - u_rippleOrigin) / max(u_rippleSize, 1e-4);
    vec4 ripC = texture(u_rippleMap, ripUv);
    vec2 ripStep = vec2(u_rippleTexel);
    float ripCell = max(u_rippleSize * u_rippleTexel, 1e-5);
    float ripL = texture(u_rippleMap, ripUv - vec2(ripStep.x, 0.0)).r, ripR = texture(u_rippleMap, ripUv + vec2(ripStep.x, 0.0)).r;
    float ripD = texture(u_rippleMap, ripUv - vec2(0.0, ripStep.y)).r, ripU = texture(u_rippleMap, ripUv + vec2(0.0, ripStep.y)).r;
    bool ripIn = u_rippleOn > 0.5 && u_waveSpace > 0.5 && all(greaterThanEqual(ripUv, vec2(0.0))) && all(lessThanEqual(ripUv, vec2(1.0)));
    vec2 ripSlope = ripIn ? vec2(ripR - ripL, ripU - ripD) * u_rippleRange / ripCell : vec2(0.0);
    float ripFoam = ripIn ? ripC.g : 0.0;
    float crest;
    vec2 slope;
    if (u_flowSpeed > 0.0) {
        // A river: the surface rides the current. Two copies of it are carried downstream a cycle at a time, each fading in as the other fades
        // out, so the moment one is put back at its start is hidden by the other.
        vec2 flow = (v_color.rg * 2.0 - 1.0) * (v_color.b * 2.0) * u_flowSpeed;
        float cycle = max(u_flowCycle, 0.1);
        float ph0 = fract(time / cycle);
        float ph1 = fract(time / cycle + 0.5);
        float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
        float crest0, crest1;
        vec2 s0 = waterSurface(wp - flow * (ph0 * cycle), time, waterDist, crest0);
        vec2 s1 = waterSurface(wp - flow * (ph1 * cycle), time, waterDist, crest1);
        slope = mix(s1, s0, w0);
        crest = mix(crest1, crest0, w0);
    } else {
        slope = waterSurface(wp, time, waterDist, crest);
    }
    slope *= damp;
    crest *= damp;
    slope += ripSlope;
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 Ngeo = vec3(0.0, 1.0, 0.0);
#ifdef MESH_NORMALS
    if (u_waveSpace > 0.5) {
        // The body's own frame: the mesh's normal is its up (the hook lifts the vertices and leaves it alone), and the slope leans along
        // its uv axes, which are its local x and z.
        Ngeo = normalize(v_worldNormal);
        N = perturbNormal(Ngeo, P, v_texCoord, normalize(vec3(-slope.x, -slope.y, 1.0)));
    }
#endif
    // Seen from below, the surface turns over, and light goes the other way through it: out of the water, into the air.
    bool below = dot(viewDir, Ngeo) < 0.0;
    if (below) { N = -N; Ngeo = -Ngeo; }

    // What is behind the water: the picture and the distance, where the frame took them.
    bool haveColor = texture(u_sceneColor, vec2(0.5)).a < 0.75;
    bool haveDepth = haveColor && texture(u_sceneDepthMap, vec2(0.5)).a < 0.75;
    vec4 clip0 = u_projection * vec4(P, 1.0);
    vec2 uv0 = clip0.xy / max(clip0.w, 1e-4) * 0.5 + 0.5;
    float behindDist = haveDepth ? texture(u_sceneDepthMap, clamp(uv0, vec2(0.001), vec2(0.999))).r : waterDist + u_fallbackDepth;
    float column0 = max(behindDist - waterDist, 0.0);

    // Bent by the waves: the ray through the tilted surface against the ray through a flat one, over as much water as there is.
    float RATIO = below ? 1.333 : 1.0 / 1.333;
    vec3 bentWave = refract(-viewDir, N, RATIO);
    vec3 bentFlat = refract(-viewDir, Ngeo, RATIO);
    // Past the critical angle (about 49 degrees) nothing gets out of the water: refract gives nothing, and the surface is a mirror.
    if (below && (dot(bentWave, bentWave) < 0.5 || dot(bentFlat, bentFlat) < 0.5)) { bentWave = bentFlat = vec3(0.0); }
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
        // The sun through the waves lights what is under them in a web of bright threads, where the sun reaches it and as much as the water between lets through.
        if (!below && haveDepth && u_causticStrength > 0.0 && u_causticOn > 0.5) {
            vec4 sunDir, sunColor;
            ivec2 sunTiles;
            waterSun(sunDir, sunColor, sunTiles);
            float cosUp = dot(sunDir.xyz, Ngeo);
            if (sunDir.w > 0.5 && cosUp > 0.05) {
                vec3 seabed = P + bentWave * column;
                float depthBelow = max(dot(P - seabed, Ngeo), 0.0);
                vec3 onSurface = seabed + sunDir.xyz * (depthBelow / max(cosUp, 0.15));
                float c = causticPattern(onSurface.xz / u_causticScale, time * u_causticSpeed);
                float reachSun = exp(-dot(u_absorption.rgb, vec3(1.0 / 3.0)) * u_density * depthBelow / max(cosUp, 0.15));
                behind *= 1.0 + u_causticStrength * c * cosUp * waterSunVisibility(seabed, sunTiles.x, sunTiles.y) * reachSun * min(sunColor.a, 2.0) * 0.5;
            }
        }
    }

    // The water in between takes the light out of it, red first, and gives back its own colour: more of it the deeper it goes.
    vec3 transmit = exp(-u_absorption.rgb * (u_density * column));
    // From below the water between the eye and the surface is the camera's own medium (the underwater effect fogs it), not a column behind the surface.
    if (below) transmit = vec3(1.0);
    float murk = 1.0 - dot(transmit, vec3(1.0 / 3.0));
    vec3 scatterColor = mix(u_shallowColor.rgb, u_deepColor.rgb, 1.0 - exp(-column * u_density * 0.5));

    // Foam: along the shore, where the water is shallow, broken by noise that moves; and on the crests of the waves.
    float vertical = column * max(abs(viewDir.y), 0.15);
    float foamScale = 1.0 / (u_rippleLength * 1.2);
    float breakup = waterNoise(wp * foamScale + vec2(time * 0.07, time * 0.05)) * 0.6 + waterNoise(wp * foamScale * 3.0 - vec2(time * 0.13, 0.0)) * 0.4;
    float pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    float shore = haveDepth && u_foamWidth > 0.0 ? clamp((1.0 - vertical / (u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0) : 0.0;
    // The baked shore foams too, where the depth buffer cannot say (no chain, no float targets) and along the lake's outline.
    if (u_shoreOn > 0.5 && u_foamWidth > 0.0) {
        shore = max(shore, clamp((1.0 - min(shoreDist, shoreDepth) / (u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0));
    }
    float onCrest = u_foamCrest > 0.0 ? smoothstep(1.0 - 0.3 * u_foamCrest, 1.0, crest) * smoothstep(0.35, 0.75, breakup) : 0.0;
    float foam = clamp(max(max(shore, onCrest * u_foamCrest), ripFoam * (0.55 + 0.45 * breakup)), 0.0, 1.0);

    SurfaceExt ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    vec3 albedo = mix(scatterColor * murk, u_foamColor.rgb, foam);
    float roughness = mix(u_roughness, 0.7, foam);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    float fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    if (below) {
        // Out of the water the glancing rays are reflected whole: Snell's window, a cone of sky overhead in a mirror of the water below it.
        float sinT = 1.333 * sqrt(max(1.0 - cosV * cosV, 0.0));
        float cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
        fresnel = sinT >= 1.0 ? 1.0 : 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosT, 5.0);
    }
    vec3 seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    // From below the water is a mirror past the critical angle, and what it mirrors is the world under it: the picture, followed along the reflected ray.
    vec3 mirror = vec3(0.0);
    if (below && fresnel > 0.02 && haveColor && haveDepth && u_mirror > 0.5) {
        vec4 met = waterReflect(P, reflect(-viewDir, N), waterDist);
        mirror = met.a > 0.5 ? met.rgb : mix(u_shallowColor.rgb, u_deepColor.rgb, 0.5) * 0.25;
    }
    seen += mirror * fresnel * (1.0 - foam);
    // Outside the lake's outline there is no water.
    if (u_shoreOn > 0.5 && shoreDist < 0.0) discard;
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
        if (f32(i) >= mc.u_waveCount) { break; }
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

${CAUSTICS_WGSL}
struct WaterSun { dir : vec4f, color : vec4f, tiles : vec2i };
/// The first directional light that shines: dir.xyz is where it stands in the sky, dir.w 1 if there is one.
fn waterSun() -> WaterSun {
    var s : WaterSun;
    s.dir = vec4f(0.0);
    s.color = vec4f(0.0);
    s.tiles = vec2i(0, 0);
    for (var i = 0; i < 16; i++) {
        let l = lc.u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            s.dir = vec4f(-normalize(vec3f(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            s.color = l.color;
            s.tiles = vec2i(i32(l.shadowMap.x), i32(l.shadowMap.y));
            return s;
        }
    }
    return s;
}

fn waterSunVisibility(worldPos : vec3f, first : i32, count : i32) -> f32 {
    if (lc.u_shadowParams.x < 0.5 || count <= 0) { return 1.0; }
    for (var k = 0; k < 16; k++) {
        if (k >= count) { break; }
        let t = first + k;
        let c = lc.u_shadowMatrix[t] * vec4f(worldPos, 1.0);
        if (c.w <= 0.0) { continue; }
        let proj = c.xyz / c.w;
        let uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) { continue; }
        let rect = lc.u_shadowTile[t];
        let base = vec2f(rect.x, 1.0 - rect.y - rect.z);
        let at = base + vec2f(uv.x, 1.0 - uv.y) * rect.z;
        let lo = base + lc.u_shadowParams.y * 0.5;
        let hi = base + rect.z - lc.u_shadowParams.y * 0.5;
        let d = unpackDepth(textureSampleLevel(t2, s2, clamp(at, lo, hi), 0.0).rgb);
        return select(1.0, 0.0, d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025);
    }
    return 1.0;
}

/// What a ray from p along r meets in the picture of the scene the frame copied: the colour (xyz) and 1 (w), or w 0 where it meets nothing on screen.
fn waterReflect(p : vec3f, r : vec3f, eyeDist : f32) -> vec4f {
    var stride = max(0.5, eyeDist * 0.03);
    var travelled = stride;
    for (var i = 0; i < 20; i++) {
        let q = p + r * travelled;
        let clip = frame.projection * vec4f(q, 1.0);
        if (clip.w <= 1e-4) { break; }
        let uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
        var qDist = -dot(q, frame.camera.xyz);
        if (frame.camera.w > 0.5) { qDist = length(q - frame.camera.xyz); }
        let sceneDist = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, uv, 0.0).r;
        if (sceneDist < qDist && qDist - sceneDist < stride * 2.0 + 1.0) { return vec4f(textureSampleLevel(u_sceneColor, u_sceneColor_s, uv, 0.0).rgb, 1.0); }
        stride = stride * 1.25;
        travelled = travelled + stride;
    }
    return vec4f(0.0);
}

/// The slope of the surface at p (x, y) and how near it is to a crest (z): the waves, and the ripples they carry, flattened with distance.
fn waterSurface(p : vec2f, time : f32, dist : f32) -> vec3f {
    let waves = waveSlope(p, time, dist);
    let rippleFade = clamp(1.0 - dist / (mc.u_rippleLength * 180.0), 0.0, 1.0);
    let eps = mc.u_rippleLength * 0.1;
    let ripple = vec2f(ripples(p + vec2f(eps, 0.0), time) - ripples(p - vec2f(eps, 0.0), time),
                       ripples(p + vec2f(0.0, eps), time) - ripples(p - vec2f(0.0, eps), time)) / (2.0 * eps);
    return vec3f(waves.slope + ripple * (mc.u_rippleStrength * mc.u_rippleLength * rippleFade), waves.crest);
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

    var wp = P.xz;
    if (mc.u_waveSpace > 0.5) { wp = v.v_texCoord + mc.u_origin; }
    let shoreTex = textureSample(u_shoreMap, u_shoreMap_s, clamp((v.v_texCoord - mc.u_shoreOrigin) / max(mc.u_shoreSize, vec2f(1e-4)), vec2f(0.0), vec2f(1.0)));
    let shoreDist = (shoreTex.r - 0.5) * 2.0 * mc.u_shoreRange;
    let shoreDepth = shoreTex.g * mc.u_shoreRange;
    var damp = 1.0;
    if (mc.u_shoreOn > 0.5) { damp = shoreTex.b; }
    // The ripples at this pixel: their height on four sides gives the slope they add, and the foam is what they left (taken in uniform control flow).
    let ripUv = (wp - mc.u_rippleOrigin) / max(mc.u_rippleSize, 1e-4);
    let ripC = textureSample(u_rippleMap, u_rippleMap_s, ripUv);
    let ripCell = max(mc.u_rippleSize * mc.u_rippleTexel, 1e-5);
    let ripL = textureSample(u_rippleMap, u_rippleMap_s, ripUv - vec2f(mc.u_rippleTexel, 0.0)).r;
    let ripR = textureSample(u_rippleMap, u_rippleMap_s, ripUv + vec2f(mc.u_rippleTexel, 0.0)).r;
    let ripD = textureSample(u_rippleMap, u_rippleMap_s, ripUv - vec2f(0.0, mc.u_rippleTexel)).r;
    let ripU = textureSample(u_rippleMap, u_rippleMap_s, ripUv + vec2f(0.0, mc.u_rippleTexel)).r;
    let ripIn = mc.u_rippleOn > 0.5 && mc.u_waveSpace > 0.5 && all(ripUv >= vec2f(0.0)) && all(ripUv <= vec2f(1.0));
    var ripSlope = vec2f(0.0);
    var ripFoam = 0.0;
    if (ripIn) { ripSlope = vec2f(ripR - ripL, ripU - ripD) * mc.u_rippleRange / ripCell; ripFoam = ripC.g; }
    var surface = vec3f(0.0);
    if (mc.u_flowSpeed > 0.0) {
        // A river: two copies of the surface carried downstream a cycle at a time, each fading in as the other fades out.
        let flow = (v.v_color.rg * 2.0 - vec2f(1.0)) * (v.v_color.b * 2.0) * mc.u_flowSpeed;
        let cycle = max(mc.u_flowCycle, 0.1);
        let ph0 = fract(time / cycle);
        let ph1 = fract(time / cycle + 0.5);
        let w0 = 1.0 - abs(2.0 * ph0 - 1.0);
        let s0 = waterSurface(wp - flow * (ph0 * cycle), time, waterDist);
        let s1 = waterSurface(wp - flow * (ph1 * cycle), time, waterDist);
        surface = mix(s1, s0, w0);
    } else {
        surface = waterSurface(wp, time, waterDist);
    }
    var waves : Waves;
    waves.crest = surface.z * damp;
    var slope = surface.xy * damp + ripSlope;
    var N = normalize(vec3f(-slope.x, 1.0, -slope.y));
    var Ngeo = vec3f(0.0, 1.0, 0.0);
#ifdef MESH_NORMALS
    if (mc.u_waveSpace > 0.5) {
        Ngeo = normalize(v.v_worldNormal);
        N = perturbNormal(Ngeo, P, v.v_texCoord, normalize(vec3f(-slope.x, -slope.y, 1.0)));
    }
#endif
    let below = dot(viewDir, Ngeo) < 0.0;
    if (below) { N = -N; Ngeo = -Ngeo; }

    let haveColor = textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75;
    let haveDepth = haveColor && textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, vec2f(0.5), 0.0).a < 0.75;
    let clip0 = frame.projection * vec4f(P, 1.0);
    let w0 = max(clip0.w, 1e-4);
    // This device's rows run down the texture, so clip y is flipped on the way to a uv.
    let uv0 = vec2f(clip0.x / w0 * 0.5 + 0.5, 0.5 - clip0.y / w0 * 0.5);
    var behindDist = waterDist + mc.u_fallbackDepth;
    if (haveDepth) { behindDist = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, clamp(uv0, vec2f(0.001), vec2f(0.999)), 0.0).r; }
    let column0 = max(behindDist - waterDist, 0.0);

    var ratio = 1.0 / 1.333;
    if (below) { ratio = 1.333; }
    var bentWave = refract(-viewDir, N, ratio);
    var bentFlat = refract(-viewDir, Ngeo, ratio);
    if (below && (dot(bentWave, bentWave) < 0.5 || dot(bentFlat, bentFlat) < 0.5)) { bentWave = vec3f(0.0); bentFlat = vec3f(0.0); }
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
        if (!below && haveDepth && mc.u_causticStrength > 0.0 && mc.u_causticOn > 0.5) {
            let sun = waterSun();
            let cosUp = dot(sun.dir.xyz, Ngeo);
            if (sun.dir.w > 0.5 && cosUp > 0.05) {
                let seabed = P + bentWave * column;
                let depthBelow = max(dot(P - seabed, Ngeo), 0.0);
                let onSurface = seabed + sun.dir.xyz * (depthBelow / max(cosUp, 0.15));
                let c = causticPattern(onSurface.xz / mc.u_causticScale, time * mc.u_causticSpeed);
                let reachSun = exp(-dot(mc.u_absorption.rgb, vec3f(1.0 / 3.0)) * mc.u_density * depthBelow / max(cosUp, 0.15));
                behind = behind * (1.0 + mc.u_causticStrength * c * cosUp * waterSunVisibility(seabed, sun.tiles.x, sun.tiles.y) * reachSun * min(sun.color.a, 2.0) * 0.5);
            }
        }
    }

    var transmit = exp(-mc.u_absorption.rgb * (mc.u_density * column));
    if (below) { transmit = vec3f(1.0); }
    let murk = 1.0 - dot(transmit, vec3f(1.0 / 3.0));
    let scatterColor = mix(mc.u_shallowColor.rgb, mc.u_deepColor.rgb, vec3f(1.0 - exp(-column * mc.u_density * 0.5)));

    let vertical = column * max(abs(viewDir.y), 0.15);
    let foamScale = 1.0 / (mc.u_rippleLength * 1.2);
    let breakup = waterNoise(wp * foamScale + vec2f(time * 0.07, time * 0.05)) * 0.6 + waterNoise(wp * foamScale * 3.0 - vec2f(time * 0.13, 0.0)) * 0.4;
    let pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    var shore = 0.0;
    if (haveDepth && mc.u_foamWidth > 0.0) { shore = clamp((1.0 - vertical / (mc.u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0); }
    if (mc.u_shoreOn > 0.5 && mc.u_foamWidth > 0.0) {
        shore = max(shore, clamp((1.0 - min(shoreDist, shoreDepth) / (mc.u_foamWidth * pulse)) * 1.5 - breakup * 0.8, 0.0, 1.0));
    }
    var onCrest = 0.0;
    if (mc.u_foamCrest > 0.0) { onCrest = smoothstep(1.0 - 0.3 * mc.u_foamCrest, 1.0, waves.crest) * smoothstep(0.35, 0.75, breakup); }
    let foam = clamp(max(max(shore, onCrest * mc.u_foamCrest), ripFoam * (0.55 + 0.45 * breakup)), 0.0, 1.0);

    var ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    let albedo = mix(scatterColor * murk, mc.u_foamColor.rgb, vec3f(foam));
    let roughness = mix(mc.u_roughness, 0.7, foam);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    let cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    var fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    if (below) {
        let sinT = 1.333 * sqrt(max(1.0 - cosV * cosV, 0.0));
        let cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
        if (sinT >= 1.0) { fresnel = 1.0; } else { fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosT, 5.0); }
    }
    var seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    var mirror = vec3f(0.0);
    if (below && fresnel > 0.02 && haveColor && haveDepth && mc.u_mirror > 0.5) {
        let met = waterReflect(P, reflect(-viewDir, N), waterDist);
        if (met.w > 0.5) { mirror = met.xyz; } else { mirror = mix(mc.u_shallowColor.rgb, mc.u_deepColor.rgb, vec3f(0.5)) * 0.25; }
    }
    seen = seen + mirror * fresnel * (1.0 - foam);
    var alpha = 0.85;
    if (haveColor) { alpha = 1.0; }
    if (mc.u_shoreOn > 0.5 && shoreDist < 0.0) { discard; }
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

// Hair: lit as strands. The flow map gives the strand direction; the lighting does Kajiya-Kay diffuse and two shifted highlights along it
// (misc.y above zero is the switch). Two-sided and translucent; the base colour is the mesh's own texture, as in the Model shader.
const HAIR = `#pragma shader "Hair"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_ormMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
// Which way each strand runs: red and green are a direction across the texture, the way an authored flow map writes it.
#pragma param u_flowMap texture default(white) texel(data)
// A texture that shifts the highlight along the strand from one place to the next, and how far, and how often it repeats.
#pragma param u_shiftMap texture default(white) texel(data)
#pragma param u_shiftAmount float default(0.35) range(0,1) ui(slider)
#pragma param u_shiftTile float default(6) range(0.1,64) ui(slider)
// How tightly each highlight is drawn (roughness: lower is a narrower line), how strong they are, and how far each rides off the strand's
// centre line. The second is the coloured one, tinted by u_secondaryTint.
#pragma param u_roughness float default(0.3) range(0.05,1) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_shiftPrimary float default(-0.1) range(-1,1) ui(slider)
#pragma param u_shiftSecondary float default(0.2) range(-1,1) ui(slider)
#pragma param u_secondaryTint color default(0.75,0.45,0.25,1)
// Light that comes through the strands from behind.
#pragma param u_translucency float default(0.4) range(0,1) ui(slider)
// A negative bias on the colour's mip level keeps the fine strands a hair card is covered in from washing out at a slant, which they do at once.
#pragma param u_sharpen float default(-0.8) range(-3,1) ui(slider)
// How much darker the roots are than the tips: the occlusion map's red, pushed.
#pragma param u_rootDark float default(0.5) range(0,1) ui(slider)
// A card's alpha cut at this level, and sharpened to about a texel so alpha-to-coverage feathers the edge of every strand instead of stair-stepping it; 0 keeps the card opaque.
#pragma param u_alphaCutoff float default(0) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
// The soft outer band of a card: where its alpha falls from the cutoff down by this much, a second, blended pass draws the strand's tip fading out
// (the opaque pass keeps what is above the cutoff, feathered by coverage). Sorted with the other blended draws; 0 leaves it out.
#pragma param u_tipSoftness float default(0) range(0,0.5) ui(slider)
#pragma tips u_tipSoftness

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

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
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    highp vec3 N = perturbNormal(Ng, P, v_texCoord, sampleNormal(u_normalMap, v_texCoord));
    if (!gl_FrontFacing) { N = -N; Ng = -Ng; }
    // The strand: the flow map's direction across the texture, put onto the surface and made to lie across the normal.
    vec2 flow = texture(u_flowMap, v_texCoord).rg * 2.0 - 1.0;
    highp vec3 T = perturbNormal(Ng, P, v_texCoord, vec3(flow, 0.0));
    T -= N * dot(N, T);
    if (dot(T, T) < 1e-6) T = cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    T = normalize(T);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 T = vec3(0.0, 1.0, 0.0);
#endif
    vec4 base = texture(u_textures[0], v_texCoord, u_sharpen) * v_color * u_tint;
    // Before any discard: a derivative needs every fragment of its quad.
    float alpha = 1.0;
#ifdef ES_TIP_PASS
    // The band below the cutoff, fading in toward it, and a texel past it so it meets the opaque card without a gap.
    alpha = (base.a - (u_alphaCutoff - u_tipSoftness)) / max(u_tipSoftness, 1e-4);
    if (base.a >= u_alphaCutoff + fwidth(base.a) || alpha <= 0.0) discard;
    alpha = min(alpha, 1.0);
#else
    if (u_alphaCutoff > 0.0) {
        alpha = (base.a - u_alphaCutoff) / max(fwidth(base.a), 1e-4) + 0.5;
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#endif
    float root = texture(u_ormMap, v_texCoord).r;
    float ao = mix(1.0, root, u_occlusionStrength);
    base.rgb *= mix(1.0, 0.35 + 0.65 * root, u_rootDark);
    float noise = (texture(u_shiftMap, v_texCoord * u_shiftTile).r - 0.5) * u_shiftAmount;
    SurfaceExt ext = surfaceExtNone(N);
    ext.aniso = vec4(T, 0.0);
    ext.misc = vec4(0.046, 1.0, u_shiftPrimary + noise, u_shiftSecondary + noise);
    ext.scatter = vec4(base.rgb * u_secondaryTint.rgb * 1.6, 0.35);
    ext.trans = vec4(u_translucency, 0.25, 0.0, 0.0);
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(base.rgb, N, P, viewDir, 0.0, u_roughness, u_specular, ao, ext);
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), u_roughness, 0.75);
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
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    var base = textureSampleBias(t0, s0, v.v_texCoord, mc.u_sharpen) * v.v_color * mc.u_tint;
    let edge = max(abs(dpdx(base.a)) + abs(dpdy(base.a)), 1e-4);
    let flowTex = textureSampleGrad(u_flowMap, u_flowMap_s, v.v_texCoord, duvx, duvy).rg * 2.0 - vec2f(1.0);
    let orm = textureSampleGrad(u_ormMap, u_ormMap_s, v.v_texCoord, duvx, duvy);
    let shiftTex = textureSampleGrad(u_shiftMap, u_shiftMap_s, v.v_texCoord * mc.u_shiftTile, duvx * mc.u_shiftTile, duvy * mc.u_shiftTile).r;
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    var N = perturbNormal(Ng, P, v.v_texCoord, sampleNormalGrad(u_normalMap, u_normalMap_s, v.v_texCoord, duvx, duvy));
    if (!front) { N = -N; Ng = -Ng; }
    var T = perturbNormal(Ng, P, v.v_texCoord, vec3f(flowTex, 0.0));
    T = T - N * dot(N, T);
    if (dot(T, T) < 1e-6) {
        var seed = vec3f(1.0, 0.0, 0.0);
        if (abs(N.y) < 0.99) { seed = vec3f(0.0, 1.0, 0.0); }
        T = cross(N, seed);
    }
    T = normalize(T);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
    let T = vec3f(0.0, 1.0, 0.0);
#endif
    var alpha = 1.0;
#ifdef ES_TIP_PASS
    alpha = (base.a - (mc.u_alphaCutoff - mc.u_tipSoftness)) / max(mc.u_tipSoftness, 1e-4);
    if (base.a >= mc.u_alphaCutoff + edge || alpha <= 0.0) { discard; }
    alpha = min(alpha, 1.0);
#else
    if (mc.u_alphaCutoff > 0.0) {
        alpha = (base.a - mc.u_alphaCutoff) / edge + 0.5;
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#endif
    let ao = mix(1.0, orm.r, mc.u_occlusionStrength);
    base = vec4f(base.rgb * mix(1.0, 0.35 + 0.65 * orm.r, mc.u_rootDark), base.a);
    let noise = (shiftTex - 0.5) * mc.u_shiftAmount;
    var ext = surfaceExtNone(N);
    ext.aniso = vec4f(T, 0.0);
    ext.misc = vec4f(0.046, 1.0, mc.u_shiftPrimary + noise, mc.u_shiftSecondary + noise);
    ext.scatter = vec4f(base.rgb * mc.u_secondaryTint.rgb * 1.6, 0.35);
    ext.trans = vec4f(mc.u_translucency, 0.25, 0.0, 0.0);
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(base.rgb, N, P, viewDir, 0.0, mc.u_roughness, mc.u_specular, ao, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), mc.u_roughness, 0.75);
    return frag;
#else
    return vec4f(lit, alpha);
#endif
}
#pragma end
`;

// Skin: scattering without blurring the picture. Diffuse light comes from a softer normal than the surface's own (softest for red), the
// terminator is warmed, thin curved places let light through, and the shine is two lobes and a fuzz. Base colour is the mesh's texture.
const SKIN = `#pragma shader "Skin"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal) texel(data)
#pragma param u_ormMap texture default(white) texel(data)
#pragma param u_occlusionStrength float default(1) range(0,1) ui(slider)
// A second, fine normal map tiled over the surface (pores, creases) laid on the sharp normal the shine reads: how strongly, and how many times it repeats.
// The soft diffuse normals do not carry it, as they do not carry the baked pores either. Import it with sRGB off and wrap repeat; 0 leaves it out.
#pragma param u_detailMap texture default(flatnormal) texel(data)
#pragma param u_detailStrength float default(0) range(0,2) ui(slider)
#pragma param u_detailTile float default(16) range(1,128) ui(slider)
// How rough the surface is (a scale on the map's own roughness), how much it shines, and the second, tighter lobe.
#pragma param u_roughness float default(1) range(0,2) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_lobe2 float default(0.18) range(0,1) ui(slider)
#pragma param u_lobe2Roughness float default(0.4) range(0.05,1) ui(slider)
// How much softer than the surface's own normal the diffuse light's normal is: for red, then for green and blue (mip levels of the normal map).
#pragma param u_blurRed float default(3.2) range(0,8) ui(slider)
#pragma param u_blurGreen float default(1.6) range(0,8) ui(slider)
// The colour the terminator takes and how far light wraps past it.
#pragma param u_sssColor color default(0.95,0.4,0.3,1)
#pragma param u_sssWrap float default(0.45) range(0,1) ui(slider)
// Light through thin places: how much, and how much of a surface's curvature counts as thin.
#pragma param u_translucency float default(0.5) range(0,1) ui(slider)
#pragma param u_thinness float default(0.5) range(0,1) ui(slider)
// Pre-integrated scattering: the wrap past the terminator is taken per colour (red furthest) and widens where the surface turns sharply, which
// is what makes a nose or an ear glow at its edge while a flat cheek stays crisp. u_curvature is how fast a turn counts as sharp, per world unit.
#pragma param u_preIntegrate float default(0) range(0,1) ui(slider)
#pragma param u_curvature float default(8) range(0,64) ui(slider)
// The fine fuzz that lights a rim.
#pragma param u_fuzz float default(0.1) range(0,1) ui(slider)
// Marks the surface for the Subsurface Scattering effect, which spreads what is left of the light on a larger scale. Off by default.
#pragma param u_subsurface float default(0) range(0,1) ui(slider)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

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

vec3 skinNormalAt(float bias) {
    return normalize(texture(u_normalMap, v_texCoord, bias).xyz * 2.0 - 1.0);
}

// The baked normal with the detail's slope added to it, in the tangent frame both are read in.
vec3 skinDetail(vec3 baked, vec2 detail) {
    return normalize(vec3(baked.xy + detail * u_detailStrength, baked.z));
}

void main() {
    // Taken before any branch: a derivative needs every fragment of its quad.
    vec2 detail = texture(u_detailMap, v_texCoord * u_detailTile).xy * 2.0 - 1.0;
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    if (!gl_FrontFacing) Ng = -Ng;
    highp vec3 N = perturbNormal(Ng, P, v_texCoord, skinDetail(skinNormalAt(0.0), detail));
    highp vec3 Nmid = perturbNormal(Ng, P, v_texCoord, skinNormalAt(u_blurGreen));
    highp vec3 Nsoft = perturbNormal(Ng, P, v_texCoord, skinNormalAt(u_blurRed));
    // How fast the surface turns across a pixel, against how big a pixel is: the thin, strongly curved places.
    float turn = (length(dFdx(Ng)) + length(dFdy(Ng))) / max(length(dFdx(P)) + length(dFdy(P)), 1e-5);
    float thick = 1.0 - clamp(turn * 12.0 * u_thinness, 0.0, 1.0);
    float curv = clamp(turn * u_curvature, 0.0, 1.0);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
    highp vec3 Nmid = N;
    highp vec3 Nsoft = N;
    float thick = 1.0;
    float curv = 0.0;
#endif
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec4 orm = texture(u_ormMap, v_texCoord);
    float ao = mix(1.0, orm.r, u_occlusionStrength);
    float rough = clamp(orm.g * u_roughness, 0.05, 1.0);
    vec3 viewDir = viewDirection(P);

    // The diffuse light, from two softnesses of normal, with the terminator warmed and light let through a thin place.
    SurfaceExt wrapped = surfaceExtNone(Nsoft);
    wrapped.scatter = vec4(u_sssColor.rgb * base.rgb * 1.4, u_sssWrap);
    wrapped.trans = vec4(u_translucency, thick, curv, u_preIntegrate);
    vec3 soft = applyLightingSurface(base.rgb, Nsoft, P, viewDir, 0.0, 1.0, 0.0, ao, wrapped);
    SurfaceExt wrappedMid = surfaceExtNone(Nmid);
    wrappedMid.scatter = wrapped.scatter;
    wrappedMid.trans = wrapped.trans;
    vec3 mid = applyLightingSurface(base.rgb, Nmid, P, viewDir, 0.0, 1.0, 0.0, ao, wrappedMid);
    vec3 diffuse = vec3(soft.r, mid.g, mid.b);

    // The shine: two lobes and a fuzz, on the surface's own normal, with no diffuse under it.
    SurfaceExt shine = surfaceExtNone(N);
    shine.coat = vec4(u_lobe2, u_lobe2Roughness, 0.0, 0.0);
    shine.coatN = vec4(N, 0.0);
    shine.sheen = vec4(vec3(u_fuzz), 0.5);
    vec3 spec = applyLightingSurface(vec3(0.0), N, P, viewDir, 0.0, rough, u_specular, ao, shine);

    float alpha = u_subsurface > 0.0 ? 0.996 : 1.0;
    fragColor = vec4(diffuse + spec, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(N)), rough, 0.75);
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
    // Every sample is taken here, before any branch.
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    let base = textureSample(t0, s0, v.v_texCoord) * v.v_color * mc.u_tint;
    let orm = textureSample(u_ormMap, u_ormMap_s, v.v_texCoord);
    let detail = textureSample(u_detailMap, u_detailMap_s, v.v_texCoord * mc.u_detailTile).xy * 2.0 - vec2f(1.0);
    let bakedSharp = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, 0.0).xyz * 2.0 - vec3f(1.0));
    let tangentSharp = normalize(vec3f(bakedSharp.xy + detail * mc.u_detailStrength, bakedSharp.z));
    let tangentMid = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, mc.u_blurGreen).xyz * 2.0 - vec3f(1.0));
    let tangentSoft = normalize(textureSampleBias(u_normalMap, u_normalMap_s, v.v_texCoord, mc.u_blurRed).xyz * 2.0 - vec3f(1.0));
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    if (!front) { Ng = -Ng; }
    let N = perturbNormal(Ng, P, v.v_texCoord, tangentSharp);
    let Nmid = perturbNormal(Ng, P, v.v_texCoord, tangentMid);
    let Nsoft = perturbNormal(Ng, P, v.v_texCoord, tangentSoft);
    let turn = (length(dpdx(Ng)) + length(dpdy(Ng))) / max(length(dpdx(P)) + length(dpdy(P)), 1e-5);
    let thick = 1.0 - clamp(turn * 12.0 * mc.u_thinness, 0.0, 1.0);
    let curv = clamp(turn * mc.u_curvature, 0.0, 1.0);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
    let Nmid = N;
    let Nsoft = N;
    let thick = 1.0;
    let curv = 0.0;
#endif
    let ao = mix(1.0, orm.r, mc.u_occlusionStrength);
    let rough = clamp(orm.g * mc.u_roughness, 0.05, 1.0);
    let viewDir = viewDirection(P);

    var wrapped = surfaceExtNone(Nsoft);
    wrapped.scatter = vec4f(mc.u_sssColor.rgb * base.rgb * 1.4, mc.u_sssWrap);
    wrapped.trans = vec4f(mc.u_translucency, thick, curv, mc.u_preIntegrate);
    let soft = applyLightingSurface(base.rgb, Nsoft, P, viewDir, 0.0, 1.0, 0.0, ao, wrapped);
    var wrappedMid = surfaceExtNone(Nmid);
    wrappedMid.scatter = wrapped.scatter;
    wrappedMid.trans = wrapped.trans;
    let mid = applyLightingSurface(base.rgb, Nmid, P, viewDir, 0.0, 1.0, 0.0, ao, wrappedMid);
    let diffuse = vec3f(soft.r, mid.g, mid.b);

    var shine = surfaceExtNone(N);
    shine.coat = vec4f(mc.u_lobe2, mc.u_lobe2Roughness, 0.0, 0.0);
    shine.coatN = vec4f(N, 0.0);
    shine.sheen = vec4f(vec3f(mc.u_fuzz), 0.5);
    let spec = applyLightingSurface(vec3f(0.0), N, P, viewDir, 0.0, rough, mc.u_specular, ao, shine);

    var alpha = 1.0;
    if (mc.u_subsurface > 0.0) { alpha = 0.996; }
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(diffuse + spec, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), rough, 0.75);
    return frag;
#else
    return vec4f(diffuse + spec, alpha);
#endif
}
#pragma end
`;

const EYE = `#pragma shader "Eye"
#pragma version 300 es
#pragma domain Lit
#pragma param u_tint color default(1,1,1,1)
// The iris is built from two maps and the numbers below: a mask that is white over the iris and the dome of the cornea
// (u_depthMap), and that dome's normals (u_irisNormalMap). A painted eye texture on the mesh multiplies the result.
#pragma param u_depthMap texture default(black) texel(data)
#pragma param u_irisNormalMap texture default(flatnormal) texel(data)
#pragma param u_scleraColor color default(0.92,0.9,0.87,1)
// The iris from the pupil's edge out to the limbus, and how dark its rim is.
#pragma param u_irisColor color default(0.22,0.4,0.52,1)
#pragma param u_irisColor2 color default(0.08,0.17,0.22,1)
#pragma param u_irisSize float default(0.42) range(0.1,0.6) ui(slider)
#pragma param u_pupilSize float default(0.3) range(0,0.8) ui(slider)
#pragma param u_limbal float default(0.7) range(0,1) ui(slider)
// How far behind the cornea the iris lies (in uv), and the cornea's index of refraction, which bend what is seen of it.
#pragma param u_irisDepth float default(0.06) range(0,0.2) ui(slider)
#pragma param u_ior float default(1.336) range(1,1.6) ui(slider)
// The wet cornea is nearly a mirror; the white of the eye is a duller sheen with light that wraps past the terminator.
#pragma param u_corneaRoughness float default(0.04) range(0.01,0.3) ui(slider)
#pragma param u_scleraRoughness float default(0.45) range(0.1,1) ui(slider)
#pragma param u_specular float default(1) range(0,2) ui(slider)
#pragma param u_scleraWrap float default(0.35) range(0,1) ui(slider)
// The lids shade the eye they sit on. u_lidMap is an authored occlusion map (white where the eye is open); u_lidShadow also darkens, and fades the
// cornea's reflections, where the surface faces up from u_lidStart (a dot with the world's up) to straight up: the upper lid, for an upright head.
#pragma param u_lidMap texture default(white) texel(data)
#pragma param u_lidShadow float default(0.5) range(0,1) ui(slider)
#pragma param u_lidStart float default(0.2) range(-1,1) ui(slider)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif
uniform sampler2D u_textures[1];

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
    vec2 uv = v_texCoord;
    // Every sample that takes part in a derivative is taken here, before any branch.
    float h = texture(u_depthMap, uv).r;
    float lid = texture(u_lidMap, uv).r;
    vec3 dome = normalize(texture(u_irisNormalMap, uv).xyz * 2.0 - 1.0);
#ifdef MESH_NORMALS
    highp vec3 Ng = normalize(v_worldNormal);
    highp vec3 P = v_worldXYZ;
    if (!gl_FrontFacing) Ng = -Ng;
    highp vec3 T = perturbNormal(Ng, P, uv, vec3(1.0, 0.0, 0.0));
    highp vec3 B = perturbNormal(Ng, P, uv, vec3(0.0, 1.0, 0.0));
    highp vec3 Ndome = perturbNormal(Ng, P, uv, dome);
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 Ng = vec3(0.0, 0.0, 1.0);
    highp vec3 T = vec3(1.0, 0.0, 0.0);
    highp vec3 B = vec3(0.0, 1.0, 0.0);
    highp vec3 Ndome = Ng;
#endif
    vec3 viewDir = viewDirection(P);
    // The ray from the eye, in the surface's own frame, bent into the cornea and carried down to the iris: that is where on
    // the iris this pixel looks, which moves as the eye turns.
    vec3 vt = normalize(vec3(dot(viewDir, T), dot(viewDir, B), max(dot(viewDir, Ng), 0.05)));
    vec3 R = refract(-vt, dome, 1.0 / u_ior);
    vec2 uvI = uv + R.xy * (u_irisDepth * h / max(-R.z, 0.2));
    float m = texture(u_depthMap, uvI).r;
    float irisMask = smoothstep(0.15, 0.85, m);
    float surfaceMask = smoothstep(0.15, 0.85, h);

    vec2 c = uvI - vec2(0.5);
    float rr = length(c) / max(u_irisSize, 1e-3);
    float ang = atan(c.y, c.x);
    float fibers = 0.82 + 0.18 * sin(ang * 70.0 + sin(ang * 13.0 + rr * 9.0) * 2.0);
    vec3 iris = mix(u_irisColor.rgb, u_irisColor2.rgb, smoothstep(0.2, 0.95, rr)) * fibers;
    iris *= 1.0 - u_limbal * smoothstep(0.78, 1.0, rr);
    iris *= smoothstep(u_pupilSize - 0.05, u_pupilSize + 0.03, rr);
    vec4 painted = texture(u_textures[0], uv) * v_color * u_tint;
    vec3 albedo = mix(u_scleraColor.rgb, iris, irisMask) * painted.rgb;

    float ao = 1.0;
    float lidShade = lid * (1.0 - u_lidShadow * smoothstep(u_lidStart, 1.0, Ng.y));
    vec3 Nd = normalize(mix(Ng, Ndome, 0.5 * surfaceMask));
    SurfaceExt body = surfaceExtNone(Nd);
    body.scatter = vec4(vec3(0.9, 0.5, 0.4) * albedo, u_scleraWrap * (1.0 - surfaceMask));
    vec3 diffuse = applyLightingSurface(albedo, Nd, P, viewDir, 0.0, 1.0, 0.0, ao, body);

    // The cornea: a clear dome, so its normal is the dome's, and it shows every light and the sky as a small bright shape.
    vec3 Nc = normalize(mix(Ng, Ndome, surfaceMask));
    SurfaceExt shine = surfaceExtNone(Nc);
    shine.coat = vec4(0.25 * (1.0 - surfaceMask), u_scleraRoughness, 0.0, 0.0);
    shine.coatN = vec4(Ng, 0.0);
    vec3 spec = applyLightingSurface(vec3(0.0), Nc, P, viewDir, 0.0, u_corneaRoughness, u_specular, ao, shine);

    fragColor = vec4((diffuse + spec) * lidShade, 1.0);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(normalize(Nc)), u_corneaRoughness, 0.75);
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
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_TANGENTS
    g_worldTangent = v.v_worldTangent;
#endif
    let uv = v.v_texCoord;
    // Every sample is taken here, before any branch.
    let h = textureSample(u_depthMap, u_depthMap_s, uv).r;
    let lid = textureSample(u_lidMap, u_lidMap_s, uv).r;
    let dome = normalize(textureSample(u_irisNormalMap, u_irisNormalMap_s, uv).xyz * 2.0 - vec3f(1.0));
#ifdef MESH_NORMALS
    var Ng = normalize(v.v_worldNormal);
    let P = v.v_worldXYZ;
    if (!front) { Ng = -Ng; }
    let T = perturbNormal(Ng, P, uv, vec3f(1.0, 0.0, 0.0));
    let B = perturbNormal(Ng, P, uv, vec3f(0.0, 1.0, 0.0));
    let Ndome = perturbNormal(Ng, P, uv, dome);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let Ng = vec3f(0.0, 0.0, 1.0);
    let T = vec3f(1.0, 0.0, 0.0);
    let B = vec3f(0.0, 1.0, 0.0);
    let Ndome = Ng;
#endif
    let viewDir = viewDirection(P);
    let vt = normalize(vec3f(dot(viewDir, T), dot(viewDir, B), max(dot(viewDir, Ng), 0.05)));
    let R = refract(-vt, dome, 1.0 / mc.u_ior);
    let uvI = uv + R.xy * (mc.u_irisDepth * h / max(-R.z, 0.2));
    let m = textureSample(u_depthMap, u_depthMap_s, uvI).r;
    let irisMask = smoothstep(0.15, 0.85, m);
    let surfaceMask = smoothstep(0.15, 0.85, h);

    let c = uvI - vec2f(0.5);
    let rr = length(c) / max(mc.u_irisSize, 1e-3);
    let ang = atan2(c.y, c.x);
    let fibers = 0.82 + 0.18 * sin(ang * 70.0 + sin(ang * 13.0 + rr * 9.0) * 2.0);
    var iris = mix(mc.u_irisColor.rgb, mc.u_irisColor2.rgb, smoothstep(0.2, 0.95, rr)) * fibers;
    iris = iris * (1.0 - mc.u_limbal * smoothstep(0.78, 1.0, rr));
    iris = iris * smoothstep(mc.u_pupilSize - 0.05, mc.u_pupilSize + 0.03, rr);
    let painted = textureSample(t0, s0, uv) * v.v_color * mc.u_tint;
    let albedo = mix(mc.u_scleraColor.rgb, iris, irisMask) * painted.rgb;

    let ao = 1.0;
    let lidShade = lid * (1.0 - mc.u_lidShadow * smoothstep(mc.u_lidStart, 1.0, Ng.y));
    let Nd = normalize(mix(Ng, Ndome, 0.5 * surfaceMask));
    var body = surfaceExtNone(Nd);
    body.scatter = vec4f(vec3f(0.9, 0.5, 0.4) * albedo, mc.u_scleraWrap * (1.0 - surfaceMask));
    let diffuse = applyLightingSurface(albedo, Nd, P, viewDir, 0.0, 1.0, 0.0, ao, body);

    let Nc = normalize(mix(Ng, Ndome, surfaceMask));
    var shine = surfaceExtNone(Nc);
    shine.coat = vec4f(0.25 * (1.0 - surfaceMask), mc.u_scleraRoughness, 0.0, 0.0);
    shine.coatN = vec4f(Ng, 0.0);
    let spec = applyLightingSurface(vec3f(0.0), Nc, P, viewDir, 0.0, mc.u_corneaRoughness, mc.u_specular, ao, shine);

#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f((diffuse + spec) * lidShade, 1.0);
    frag.surface = vec4f(packNormal(normalize(Nc)), mc.u_corneaRoughness, 0.75);
    return frag;
#else
    return vec4f((diffuse + spec) * lidShade, 1.0);
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
    template('hair', 'Hair',
        'Strand lighting: Kajiya-Kay diffuse, two shifted highlights along a flow map, and light through the strands.', HAIR),
    template('skin', 'Skin',
        'Soft diffuse by colour, a warm terminator, light through thin places, two shine lobes and a fuzz — without blurring the picture.', SKIN),
    template('eye', 'Eye',
        'A wet cornea over an iris that moves as the eye turns: refracted depth, a pupil, a dark limbal ring, and catchlights of every light.', EYE),
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
