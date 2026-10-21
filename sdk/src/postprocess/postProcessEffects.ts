// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    postProcessEffects.ts
 * @brief   Stateless post-process shader factories.
 * @details Fragment-only `.esshader` sources on the reflected `#pragma param`
 *          seam (domain PostProcess: the engine injects the canonical
 *          fullscreen vertex stage), each with a `#pragma fragment wgsl` twin
 *          so every effect compiles on the WebGPU backend. Conventions: the
 *          pass input is the loose `u_texture` sampler (unit 0; t0/s0 in the
 *          twin), the untouched scene `u_sceneTexture` (unit 1; t1/s1), LUT
 *          textures are texture params at their reflected material units, and
 *          resolution comes from the injected `u_viewport` (xy = pixels,
 *          zw = 1/pixels) instead of a per-pass upload.
 */
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';

/**
 * Depth-reading helpers the three SSAO passes share, in both languages. One
 * definition each: a fix that reached only the first of three copies compiled
 * fine and drew a black screen.
 */
const SSAO_GLSL = `/// A texel of the pass's uv, which runs in the device's own row order: up the
/// screen here, down it on WebGPU. Its inverse round-trips through that uv.
ivec2 screenTexel(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec2 uvOfTexel(ivec2 t, ivec2 size) {
    return (vec2(t) + 0.5) / vec2(size);
}
/// The one place the row order matters: GL numbers rows from the BOTTOM, so a
/// screen texel is already the row.
float depthAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return texelFetch(u_sceneDepth, q, 0).r;
}
vec3 worldAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return worldFromDepth(uvOfTexel(q, size), depthAt(q, size));
}
/// World distance along the view ray per unit of window depth, at THIS pixel.
/// One derivative here replaces an un-projection per tap. Measured rather than
/// assumed, so it holds for both projections.
float worldPerDepth(vec2 uv, float d, vec3 P) {
    float e = max((1.0 - d) * 0.01, 1e-5);
    // Signed so the probe stays inside the depth range at the far plane.
    float de = d + e > 1.0 ? -e : e;
    return length(worldFromDepth(uv, d + de) - P) / abs(de);
}`;

const SSAO_WGSL = `fn screenTexel(uv : vec2f, size : vec2i) -> vec2i {
    return clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
}
fn uvOfTexel(t : vec2i, size : vec2i) -> vec2f {
    return (vec2f(t) + 0.5) / vec2f(size);
}
// A fullscreen pass's uv already runs down the rows here, so a texel is its row.
fn depthAt(t : vec2i, size : vec2i) -> f32 {
    let q = clamp(t, vec2i(0), size - vec2i(1));
    return textureLoad(t7, q, 0);
}
fn worldAt(t : vec2i, size : vec2i) -> vec3f {
    let q = clamp(t, vec2i(0), size - vec2i(1));
    return worldFromDepth(uvOfTexel(q, size), depthAt(q, size));
}
fn worldPerDepth(uv : vec2f, d : f32, P : vec3f) -> f32 {
    let e = max((1.0 - d) * 0.01, 1e-5);
    var e2 = e;
    if (d + e > 1.0) { e2 = -e; }
    return length(worldFromDepth(uv, d + e2) - P) / abs(e2);
}`;

/**
 * Where puddles lie, in both languages: a value-noise field over the ground's world xz, cut at a level the
 * coverage sets. A function of the WORLD position alone, so the rain effect (which darkens a puddle and
 * rings it) and the reflections effect (which makes it a mirror) draw the same puddles by being given the
 * same two numbers, and neither has to tell the other where they are.
 */
const PUDDLE_GLSL = `
float puddleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float puddleNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(puddleHash(i), puddleHash(i + vec2(1.0, 0.0)), f.x),
               mix(puddleHash(i + vec2(0.0, 1.0)), puddleHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float puddleMask(vec2 xz, float coverage, float scale) {
    if (coverage <= 0.0) return 0.0;
    vec2 p = xz / max(scale, 1.0);
    float n = 0.55 * puddleNoise(p) + 0.3 * puddleNoise(p * 2.3 + 17.0) + 0.15 * puddleNoise(p * 5.1 + 41.0);
    float t = 0.78 - coverage * 0.42;
    return smoothstep(t - 0.03, t + 0.03, n);
}`;

const PUDDLE_WGSL = `
fn puddleHash(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn puddleNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(puddleHash(i), puddleHash(i + vec2f(1.0, 0.0)), f.x),
               mix(puddleHash(i + vec2f(0.0, 1.0)), puddleHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn puddleMask(xz : vec2f, coverage : f32, scale : f32) -> f32 {
    if (coverage <= 0.0) { return 0.0; }
    let p = xz / max(scale, 1.0);
    let n = 0.55 * puddleNoise(p) + 0.3 * puddleNoise(p * 2.3 + 17.0) + 0.15 * puddleNoise(p * 5.1 + 41.0);
    let t = 0.78 - coverage * 0.42;
    return smoothstep(t - 0.03, t + 0.03, n);
}`;

/**
 * Where water gathers. Standing water collects in the low places of a surface and is gone from its crowns, so the
 * coverage the author asked for is not the same everywhere: it is measured against the ground around, three rings of eight
 * depth taps whose reach is the size of a pool. A point lower than what surrounds it (by up to a rim's height) holds
 * more of the water, one that stands above it holds less, and flat ground keeps the coverage it was given — where the
 * noise alone decides which patch becomes a pool. Needs the depth helpers above it.
 */
const BASIN_GLSL = `
float basinCoverage(ivec2 c, ivec2 size, vec3 P, float coverage, float scale) {
    if (coverage <= 0.0) return 0.0;
    // How big a pixel is in the world here, which says how many of them a pool's reach is.
    float pixel = length(worldAt(c + ivec2(1, 0), size) - P);
    float reach = scale * 1.2;
    float r = clamp(reach / max(pixel, 1e-3), 3.0, 80.0);
    // A rise this high is a rim: more than that is a wall or a prop, which is not what water gathers against.
    float rim = reach * 0.12;
    float sum = 0.0;
    // Three rings, so a rise of any width between here and the edge of the reach has taps on it.
    for (int k = 1; k <= 3; ++k) {
        float rk = r * float(k) / 3.0;
        for (int i = 0; i < 8; ++i) {
            float a = (float(i) + 0.5 * float(k)) * 0.7853982;
            ivec2 t = c + ivec2(floor(vec2(cos(a), sin(a)) * rk + 0.5));
            if (depthAt(t, size) >= 1.0) continue;
            float rise = worldAt(t, size).y - P.y;
            sum += clamp(rise, -rim, rim) * step(abs(rise), reach);
        }
    }
    float basin = clamp(sum / (24.0 * rim) * 3.0, -1.0, 1.0);
    return clamp(coverage * (1.0 + 2.2 * basin), 0.0, 1.0);
}`;

const BASIN_WGSL = `
fn basinCoverage(c : vec2i, size : vec2i, P : vec3f, coverage : f32, scale : f32) -> f32 {
    if (coverage <= 0.0) { return 0.0; }
    let pixel = length(worldAt(c + vec2i(1, 0), size) - P);
    let reach = scale * 1.2;
    let r = clamp(reach / max(pixel, 1e-3), 3.0, 80.0);
    let rim = reach * 0.12;
    var sum = 0.0;
    for (var k : i32 = 1; k <= 3; k = k + 1) {
        let rk = r * f32(k) / 3.0;
        for (var i : i32 = 0; i < 8; i = i + 1) {
            let a = (f32(i) + 0.5 * f32(k)) * 0.7853982;
            let t = c + vec2i(floor(vec2f(cos(a), sin(a)) * rk + 0.5));
            if (depthAt(t, size) >= 1.0) { continue; }
            let rise = worldAt(t, size).y - P.y;
            sum = sum + clamp(rise, -rim, rim) * select(0.0, 1.0, abs(rise) <= reach);
        }
    }
    let basin = clamp(sum / (24.0 * rim) * 3.0, -1.0, 1.0);
    return clamp(coverage * (1.0 + 2.2 * basin), 0.0, 1.0);
}`;

/**
 * Reading the scene's surface record, in both languages: what each pixel IS, as the scene's own shaders
 * wrote it beside the colour — octahedral normal in rg, roughness in b, metalness in a (a is 0 where nothing
 * wrote, and 0.75 + 0.25 * metalness where something did, so that an edge multisampling averaged with an
 * unwritten pixel — at most 0.5 — is told from a surface). An effect that wants it says `#pragma gbuffer`,
 * which is what makes the frame draw one, and finds it at `u_gbuffer`.
 */
const GBUFFER_GLSL = `
struct Surface { vec3 normal; float roughness; float metallic; bool known; };
Surface readSurface(ivec2 t) {
    vec4 g = texelFetch(u_gbuffer, t, 0);
    Surface s;
    s.known = g.a > 0.7;
    vec2 f = g.rg * 2.0 - 1.0;
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float k = clamp(-n.z, 0.0, 1.0);
    n.xy += vec2(n.x >= 0.0 ? -k : k, n.y >= 0.0 ? -k : k);
    s.normal = normalize(n);
    s.roughness = g.b;
    s.metallic = clamp((g.a - 0.75) / 0.25, 0.0, 1.0);
    return s;
}`;

const GBUFFER_WGSL = `
struct Surface { normal : vec3f, roughness : f32, metallic : f32, known : bool };
fn readSurface(t : vec2i) -> Surface {
    let g = textureLoad(t6, t, 0);
    var f = g.rg * 2.0 - 1.0;
    var n = vec3f(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    let k = clamp(-n.z, 0.0, 1.0);
    n = vec3f(n.x + select(k, -k, n.x >= 0.0), n.y + select(k, -k, n.y >= 0.0), n.z);
    var s : Surface;
    s.known = g.a > 0.7;
    s.normal = normalize(n);
    s.roughness = g.b;
    s.metallic = clamp((g.a - 0.75) / 0.25, 0.0, 1.0);
    return s;
}`;

/**
 * The frame's environment, sampled from an effect, in both languages: the same prefiltered octahedral atlas the
 * meshes reflect, read at the sky's own column. This is the engine's `envSampleMip` and `envDirection` as
 * the mesh shaders spell them (ShaderParser.cpp) — the atlas layout is the one fact they share, so a change
 * to it is a change here too. The numbers it needs come in as params the pipeline fills from the frame's light
 * block each frame (\`u_envParams\`: x = has a map, y = range, z = highest mip, w = face size; \`u_envTint\`:
 * the sky's turn in alpha; \`u_reflParams\`: x = columns in the atlas).
 */
const ENV_GLSL = `
vec3 envDirection(vec3 d) {
    float a = -u_envTint.a;
    float s = sin(a);
    float c = cos(a);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}
vec2 envOctahedral(vec3 d) {
    vec2 p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);
    if (d.y < 0.0) {
        p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
    }
    return p * 0.5 + 0.5;
}
vec3 envSkyMip(vec3 R, float mip) {
    float face = u_envParams.w;
    float size = face * exp2(-mip);
    float yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;
    float col = face + 2.0;
    float atlasW = col * u_reflParams.x;
    float atlasH = 2.0 * face * (1.0 - exp2(-(u_envParams.z + 1.0))) + 2.0 * (u_envParams.z + 1.0);
    vec2 uv = envOctahedral(envDirection(R));
    vec2 lo = vec2(0.5, yOff + 0.5);
    vec2 hi = vec2(size + 1.5, yOff + size + 1.5);
    vec2 px = clamp(vec2(1.0 + uv.x * size, yOff + 1.0 + uv.y * size), lo, hi);
    vec4 t = textureLod(u_environment, px / vec2(atlasW, atlasH), 0.0);
    return t.rgb * t.rgb * (t.a * t.a * u_envParams.y);
}
/// The sky's reflection along a direction at a roughness: two mips of the atlas blended, and tinted by the ambient
/// light that owns the environment — what the mesh shaders add to the flat ambient term for a reflection.
vec3 envSky(vec3 R, float roughness) {
    float lod = clamp(roughness, 0.0, 1.0) * u_envParams.z;
    float lo = floor(lod);
    vec3 a = envSkyMip(R, lo);
    vec3 b = envSkyMip(R, min(lo + 1.0, u_envParams.z));
    return mix(a, b, lod - lo) * u_envTint.rgb;
}`;

const ENV_WGSL = `
fn envDirection(d : vec3f) -> vec3f {
    let a = -mc.u_envTint.a;
    let s = sin(a);
    let c = cos(a);
    return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}
fn envOctahedral(d : vec3f) -> vec2f {
    var p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);
    if (d.y < 0.0) {
        p = (1.0 - abs(vec2f(p.y, p.x))) * vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
    }
    return p * 0.5 + 0.5;
}
fn envSkyMip(R : vec3f, mip : f32) -> vec3f {
    let face = mc.u_envParams.w;
    let size = face * exp2(-mip);
    let yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;
    let col = face + 2.0;
    let atlasW = col * mc.u_reflParams.x;
    let atlasH = 2.0 * face * (1.0 - exp2(-(mc.u_envParams.z + 1.0))) + 2.0 * (mc.u_envParams.z + 1.0);
    let uv = envOctahedral(envDirection(R));
    let lo = vec2f(0.5, yOff + 0.5);
    let hi = vec2f(size + 1.5, yOff + size + 1.5);
    let px = clamp(vec2f(1.0 + uv.x * size, yOff + 1.0 + uv.y * size), lo, hi);
    let t = textureSampleLevel(u_environment, u_environment_s, px / vec2f(atlasW, atlasH), 0.0);
    return t.rgb * t.rgb * (t.a * t.a * mc.u_envParams.y);
}
fn envSky(R : vec3f, roughness : f32) -> vec3f {
    let lod = clamp(roughness, 0.0, 1.0) * mc.u_envParams.z;
    let lo = floor(lod);
    let a = envSkyMip(R, lo);
    let b = envSkyMip(R, min(lo + 1.0, mc.u_envParams.z));
    return mix(a, b, lod - lo) * mc.u_envTint.rgb;
}`;

export const postProcessEffects = {
    createLutGrade(): ShaderHandle {
        // True LUT color grading: a 2D-packed 32^3 LUT (1024x32 — 32 slices of
        // 32x32 laid out along X; slice index = blue). Sampled twice around the
        // blue coordinate and mixed, giving trilinear-quality grading from a
        // plain PNG. The LUT texture binds via the pass's texture params
        // (PostProcessVolume `textures: { u_lut: <ref> }`).
        const source = `#pragma shader "PP LUT Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_lut texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

vec3 sampleLut(vec3 c) {
    const float size = 32.0;
    float b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    float slice0 = floor(b);
    float slice1 = min(slice0 + 1.0, size - 1.0);
    float u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    float v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    vec3 a = texture(u_lut, vec2(u + slice0 / size, v)).rgb;
    vec3 d = texture(u_lut, vec2(u + slice1 / size, v)).rgb;
    return mix(a, d, b - slice0);
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    fragColor = vec4(mix(color.rgb, sampleLut(color.rgb), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
fn sampleLut(c : vec3f) -> vec3f {
    let size = 32.0;
    let b = clamp(c.b, 0.0, 1.0) * (size - 1.0);
    let slice0 = floor(b);
    let slice1 = min(slice0 + 1.0, size - 1.0);
    let u = (clamp(c.r, 0.0, 1.0) * (size - 1.0) + 0.5) / (size * size);
    let v = (clamp(c.g, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
    let a = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice0 / size, v), 0.0).rgb;
    let d = textureSampleLevel(u_lut, u_lut_s, vec2f(u + slice1 / size, v), 0.0).rgb;
    return mix(a, d, b - slice0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    return vec4f(mix(color.rgb, sampleLut(color.rgb), mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Temporal anti-aliasing. The engine shifts the picture by a sub-pixel amount each
     * frame and keeps this pass's last output as `u_history`; this blends the two.
     *
     * Where last frame's point was comes from the depth buffer: un-project the pixel to
     * the world, project it with last frame's camera. That is exact for everything the
     * camera moves past and wrong for an object that moved by itself. Those objects are
     * drawn again in a pass of their own that writes how far each pixel moved
     * (`u_velocity`), and where that pass is what the scene shows, the pixel follows its
     * own displacement instead. What neither explains — a skinned surface, a thing the
     * motion pass did not draw — is clipped into the colours the neighbourhood holds,
     * which hides the mismatch instead of smearing it. The blend is done in a space where
     * a bright pixel weighs less, or one firefly outlives the frame it appeared in.
     */
    createTaa(): ShaderHandle {
        const GLSL = `
vec3 toYCoCg(vec3 c) {
    return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 fromYCoCg(vec3 c) {
    return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
/// Weighs a pixel by 1 / (1 + peak): an HDR highlight cannot dominate the average.
vec3 compress(vec3 c) { return c / (1.0 + max(max(c.r, c.g), c.b)); }
vec3 expand(vec3 c) { return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-4); }`;
        const WGSL = `
fn toYCoCg(c : vec3f) -> vec3f {
    return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn fromYCoCg(c : vec3f) -> vec3f {
    return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
fn compress(c : vec3f) -> vec3f { return c / (1.0 + max(max(c.r, c.g), c.b)); }
fn expand(c : vec3f) -> vec3f { return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-4); }`;
        const source = `#pragma shader "PP TAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blend float default(0.1) range(0.02,1)
#pragma param u_objectMotion float default(1) range(0,1)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_prevViewProjection0 color default(1,0,0,0)
#pragma param u_prevViewProjection1 color default(0,1,0,0)
#pragma param u_prevViewProjection2 color default(0,0,1,0)
#pragma param u_prevViewProjection3 color default(0,0,0,1)
#pragma param u_history texture default(black)
#pragma param u_velocity texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}
${GLSL}

void main() {
    ivec2 size = textureSize(u_texture, 0);
    vec2 texel = 1.0 / vec2(size);
    vec4 cur = texture(u_texture, v_texCoord);

    // The neighbourhood the history has to look like: its mean and spread, in a
    // space where colour and brightness are apart.
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            vec3 s = toYCoCg(compress(texture(u_texture, v_texCoord + vec2(float(x), float(y)) * texel).rgb));
            m1 += s;
            m2 += s * s;
        }
    }
    vec3 mean = m1 / 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 curY = toYCoCg(compress(cur.rgb));

    ivec2 dsize = textureSize(u_sceneDepth, 0);
    float d = depthAt(screenTexel(v_texCoord, dsize), dsize);
    vec3 world = worldFromDepth(v_texCoord, d);
    vec4 prev = mat4(u_prevViewProjection0, u_prevViewProjection1,
                     u_prevViewProjection2, u_prevViewProjection3) * vec4(world, 1.0);
    vec2 puv = prev.xy / max(prev.w, 1e-6) * 0.5 + 0.5;
    bool inFront = prev.w > 1e-6;
    // A surface that moved by itself: the frame drew its displacement in a pass of its own, and where what it
    // drew is the surface the scene shows here (its depth agrees), that displacement says where this pixel was
    // — the camera's does not know about it. Anywhere else the camera's answer stands.
    ivec2 vsize = textureSize(u_velocity, 0);
    vec4 vel = texelFetch(u_velocity, screenTexel(v_texCoord, vsize), 0);
    if (u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) {
        puv = v_texCoord + vel.xy;
        inFront = true;
    }
    bool seen = u_historyValid > 0.5 && inFront
             && puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0;
    if (!seen) { fragColor = cur; return; }

    vec3 hist = toYCoCg(compress(texture(u_history, puv).rgb));
    // Pulled toward the neighbourhood's mean until it sits inside the box the
    // current frame spans: what it clips is what no longer matches.
    vec3 lo = mean - sigma * 1.25;
    vec3 hi = mean + sigma * 1.25;
    vec3 dir = hist - mean;
    vec3 over = max(abs(dir) / max((hi - lo) * 0.5, vec3(1e-5)), vec3(1.0));
    hist = mean + dir / max(max(over.x, over.y), over.z);

    // A fast-moving pixel trusts the new frame more: its history is thin.
    float speed = length((puv - v_texCoord) / texel);
    float blend = mix(u_blend, min(u_blend * 4.0, 1.0), clamp(speed, 0.0, 1.0));
    vec3 outY = mix(hist, curY, blend);
    fragColor = vec4(expand(fromYCoCg(outY)), cur.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t0, 0));
    let texel = 1.0 / vec2f(size);
    let cur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);

    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    for (var y : i32 = -1; y <= 1; y = y + 1) {
        for (var x : i32 = -1; x <= 1; x = x + 1) {
            let s = toYCoCg(compress(textureSampleLevel(t0, s0, v.v_texCoord + vec2f(f32(x), f32(y)) * texel, 0.0).rgb));
            m1 = m1 + s;
            m2 = m2 + s * s;
        }
    }
    let mean = m1 / 9.0;
    let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
    let curY = toYCoCg(compress(cur.rgb));

    let dsize = vec2i(textureDimensions(t7, 0));
    let d = depthAt(screenTexel(v.v_texCoord, dsize), dsize);
    let world = worldFromDepth(v.v_texCoord, d);
    let vp = mat4x4f(mc.u_prevViewProjection0, mc.u_prevViewProjection1,
                     mc.u_prevViewProjection2, mc.u_prevViewProjection3);
    let prev = vp * vec4f(world, 1.0);
    // This device's uv runs down the rows, so clip y is flipped on the way back.
    let pw = max(prev.w, 1e-6);
    var puv = vec2f(prev.x / pw * 0.5 + 0.5, 0.5 - prev.y / pw * 0.5);
    var inFront = prev.w > 1e-6;
    // See the GLSL twin: a surface that moved by itself, from the frame's motion pass. This device's uv
    // runs down the rows, so the displacement's y is flipped on the way in.
    let vsize = vec2i(textureDimensions(u_velocity, 0));
    let vel = textureLoad(u_velocity, screenTexel(v.v_texCoord, vsize), 0);
    if (mc.u_objectMotion > 0.5 && vel.a > 0.5 && abs(vel.b - d) <= 2e-5 + (1.0 - d) * 0.02) {
        puv = v.v_texCoord + vec2f(vel.x, -vel.y);
        inFront = true;
    }
    let seen = mc.u_historyValid > 0.5 && inFront
            && puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0;
    if (!seen) { return cur; }

    var hist = toYCoCg(compress(textureSampleLevel(u_history, u_history_s, puv, 0.0).rgb));
    let lo = mean - sigma * 1.25;
    let hi = mean + sigma * 1.25;
    let dir = hist - mean;
    let over = max(abs(dir) / max((hi - lo) * 0.5, vec3f(1e-5)), vec3f(1.0));
    hist = mean + dir / max(max(over.x, over.y), over.z);

    let speed = length((puv - v.v_texCoord) / texel);
    let blend = mix(mc.u_blend, min(mc.u_blend * 4.0, 1.0), clamp(speed, 0.0, 1.0));
    let outY = mix(hist, curY, blend);
    return vec4f(expand(fromYCoCg(outY)), cur.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Screen-space reflections. No G-buffer: the surface normal is rebuilt from depth the way
     * SSAO does, the reflected ray is marched in the world and projected back to the screen at
     * every step, and a step that lands behind what the depth buffer shows by less than
     * `u_thickness` is a hit. What the ray found is blended over the pixel by a Schlick
     * Fresnel term — weak face-on, strong at a grazing angle — so a wet floor shines toward the
     * horizon and a wall facing the camera does not.
     *
     * Nothing here knows a surface's roughness, which is why `u_floorBias` exists: with it up,
     * only surfaces that face up reflect, which is what a wet street or a polished floor wants
     * and what a brick wall does not.
     */
    createSsr(): ShaderHandle {
        const GLSL = `
const int STEPS = 48;
const int REFINE = 6;

/// Interleaved gradient noise: a different start offset per pixel, so the stepping
/// bands dissolve into noise that a temporal pass then averages away.
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// The screen uv a world point lands on, and whether it is in front of the camera.
vec3 project(vec3 P) {
    vec4 c = u_projection * vec4(P, 1.0);
    return vec3(c.xy / max(c.w, 1e-6) * 0.5 + 0.5, c.w);
}`;
        const WGSL = `
const STEPS : i32 = 48;
const REFINE : i32 = 6;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn project(P : vec3f) -> vec3f {
    let c = frame.projection * vec4f(P, 1.0);
    let w = max(c.w, 1e-6);
    return vec3f(c.x / w * 0.5 + 0.5, 0.5 - c.y / w * 0.5, c.w);
}`;
        const source = `#pragma shader "PP SSR"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_maxDistance float default(400) range(10,3000)
#pragma param u_thickness float default(12) range(1,200)
#pragma param u_floorBias float default(0) range(0,1)
#pragma param u_puddles float default(0) range(0,1)
#pragma param u_puddleScale float default(350) range(40,2000)
#pragma param u_maxRoughness float default(0.75) range(0.05,1)
#pragma param u_wetness float default(0) range(0,1)
#pragma param u_skyReflection float default(1) range(0,1)
#pragma param u_envParams color default(0,0,0,0)
#pragma param u_envTint color default(0,0,0,0)
#pragma param u_reflParams color default(1,0,0,0)
#pragma param u_environment texture default(black)
#pragma gbuffer

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
uniform highp sampler2D u_gbuffer;
out vec4 fragColor;

${SSAO_GLSL}
${PUDDLE_GLSL}
${BASIN_GLSL}
${GBUFFER_GLSL}
${ENV_GLSL}
${GLSL}

void main() {
    vec4 scene = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    if (d >= 1.0 || u_intensity <= 0.0) { fragColor = scene; return; }

    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The nearer neighbour on each axis, as SSAO takes it: across a silhouette the far
    // side is another surface and a centred derivative would average the two.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                        : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                        : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    vec3 V = viewDirection(P);
    if (dot(N, V) < 0.0) N = -N;

    // What the surface is, as the scene wrote it: its own normal (a normal map's detail, which depth
    // cannot see), how rough it is and whether it is metal. Where nothing wrote — a sprite, a draw whose
    // shader has no record to give — nothing is known of it, and a reflection of a guess is worse than none.
    Surface sf = readSurface(c);
    if (!sf.known) { fragColor = scene; return; }
    N = sf.normal;
    if (dot(N, V) < 0.0) N = -N;
    float rough = sf.roughness;
    float metal = sf.metallic;

    // Standing water is flat and mirror-like whatever the ground under it is: its normal is
    // straight up, and a still surface reflects far more than the 4% a dry one does.
    float flatUp = smoothstep(0.86, 0.95, N.y);
    float puddle = 0.0;
    if (u_puddles > 0.0) {
        puddle = puddleMask(P.xz, basinCoverage(c, size, P, u_puddles, u_puddleScale), u_puddleScale) * flatUp;
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle));
    }
    // Wet ground is smoother than dry: a film of water fills the pores a rough surface scatters from.
    rough = mix(rough, rough * 0.35, u_wetness * flatUp);
    rough = mix(rough, 0.04, puddle);
    // Too rough to show anything: skipped before the march, which is the whole cost.
    if (rough > u_maxRoughness) { fragColor = scene; return; }

    // Fresnel at this angle, Schlick from the surface's own reflectance face-on: a dielectric's 4%, a
    // metal's near-all. The floor mask keeps a surface nobody described from shining on every wall.
    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float f0 = mix(0.04, 0.9, metal);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
    fresnel = mix(fresnel, max(fresnel, 0.55), puddle);
    // A rough surface's reflection is spread over the lobe and dimmer for it.
    float gloss = (1.0 - rough) * (1.0 - rough);
    // Optionally only what faces up reflects: a wet street and not the walls beside it.
    float up = mix(1.0, smoothstep(0.55, 0.9, N.y), u_floorBias);
    float weight = fresnel * up * gloss * u_intensity;
    if (weight < 0.002) { fragColor = scene; return; }

    vec3 R = reflect(-V, N);
    // A ray heading back at the camera has nothing on screen to find.
    if (dot(R, V) > 0.97) { fragColor = scene; return; }

    float stepLen = u_maxDistance / float(STEPS);
    float jitter = ign(gl_FragCoord.xy);
    vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : P + u_camera.xyz * 1e4;
    vec3 hitColor = vec3(0.0);
    float hit = 0.0;
    float travelled = 0.0;
    vec3 prevP = P;
    for (int i = 0; i < STEPS; ++i) {
        float t = (float(i) + jitter) * stepLen + stepLen * 0.5;
        vec3 Q = P + R * t;
        vec3 s = project(Q);
        if (s.z <= 0.0 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) break;
        float ds = depthAt(screenTexel(s.xy, size), size);
        if (ds >= 1.0) { prevP = Q; continue; }
        vec3 S = worldFromDepth(uvOfTexel(screenTexel(s.xy, size), size), ds);
        // How far the ray has gone past the surface the depth buffer shows there,
        // measured along the view: positive is behind it.
        float behind = length(Q - eye) - length(S - eye);
        if (behind > 0.0 && behind < u_thickness + stepLen) {
            // Bisect between the last step in front and this one behind.
            vec3 a = prevP;
            vec3 b = Q;
            for (int k = 0; k < REFINE; ++k) {
                vec3 m = 0.5 * (a + b);
                vec3 sm = project(m);
                float dm = depthAt(screenTexel(sm.xy, size), size);
                vec3 Sm = worldFromDepth(uvOfTexel(screenTexel(sm.xy, size), size), dm);
                if (length(m - eye) - length(Sm - eye) > 0.0) b = m; else a = m;
            }
            vec3 sh = project(b);
            // The reflected surface must face the ray; one seen edge-on is an
            // artefact of the depth buffer's stair-stepping, not a surface.
            vec2 e = min(sh.xy, 1.0 - sh.xy);
            float edge = smoothstep(0.0, 0.1, min(e.x, e.y));
            // A farther hit is a rougher reflection: blur it by how far it is.
            // Wider with the surface's own roughness, and with how far the ray went.
            float blur = ((length(b - P) / max(u_maxDistance, 1.0)) * 6.0 + rough * 10.0) * (1.0 - 0.85 * puddle);
            vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
            vec3 col = texture(u_texture, sh.xy).rgb * 0.4;
            col += texture(u_texture, sh.xy + vec2( blur, 0.0) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(-blur, 0.0) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(0.0,  blur) * texel).rgb * 0.15;
            col += texture(u_texture, sh.xy + vec2(0.0, -blur) * texel).rgb * 0.15;
            travelled = length(b - P);
            hit = edge * (1.0 - smoothstep(0.6, 1.0, travelled / u_maxDistance));
            hitColor = col;
            break;
        }
        prevP = Q;
    }
    vec3 result = mix(scene.rgb, hitColor, clamp(weight * hit, 0.0, 1.0));
    // Where the ray found nothing on screen — it left the picture, or went on to the sky — the surface still
    // reflects what is there: the environment, at the sharpness its roughness gives. Without it a mirror
    // (a puddle) would show the sky only where the scene had already painted a blurred copy of it.
    if (u_envParams.x > 0.5 && u_skyReflection > 0.0) {
        vec3 sky = envSky(R, rough);
        result = mix(result, sky, clamp(weight * (1.0 - hit) * u_skyReflection, 0.0, 1.0));
    }
    fragColor = vec4(result, scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${PUDDLE_WGSL}
${BASIN_WGSL}
${GBUFFER_WGSL}
${ENV_WGSL}
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0 || mc.u_intensity <= 0.0) { return scene; }

    let cuv = uvOfTexel(c, size);
    let P = worldFromDepth(cuv, d);

    let dl = depthAt(c + vec2i(-1, 0), size);
    let dr = depthAt(c + vec2i( 1, 0), size);
    let dd = depthAt(c + vec2i(0, -1), size);
    let du = depthAt(c + vec2i(0,  1), size);
    var ax = P - worldAt(c + vec2i(-1, 0), size);
    if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
    var ay = P - worldAt(c + vec2i(0, -1), size);
    if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
    var N = normalize(cross(ax, ay));
    let V = viewDirection(P);
    if (dot(N, V) < 0.0) { N = -N; }

    let sf = readSurface(c);
    if (!sf.known) { return scene; }
    N = sf.normal;
    if (dot(N, V) < 0.0) { N = -N; }
    var rough = sf.roughness;
    let metal = sf.metallic;

    let flatUp = smoothstep(0.86, 0.95, N.y);
    var puddle = 0.0;
    if (mc.u_puddles > 0.0) {
        puddle = puddleMask(P.xz, basinCoverage(c, size, P, mc.u_puddles, mc.u_puddleScale), mc.u_puddleScale) * flatUp;
        N = normalize(mix(N, vec3f(0.0, 1.0, 0.0), puddle));
    }
    rough = mix(rough, rough * 0.35, mc.u_wetness * flatUp);
    rough = mix(rough, 0.04, puddle);
    if (rough > mc.u_maxRoughness) { return scene; }

    let cosT = clamp(dot(N, V), 0.0, 1.0);
    let f0 = mix(0.04, 0.9, metal);
    var fresnel = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
    fresnel = mix(fresnel, max(fresnel, 0.55), puddle);
    let gloss = (1.0 - rough) * (1.0 - rough);
    let up = mix(1.0, smoothstep(0.55, 0.9, N.y), mc.u_floorBias);
    let weight = fresnel * up * gloss * mc.u_intensity;
    if (weight < 0.002) { return scene; }

    let R = reflect(-V, N);
    if (dot(R, V) > 0.97) { return scene; }

    let stepLen = mc.u_maxDistance / f32(STEPS);
    let jitter = ign(v.pos.xy);
    var eye = P + frame.camera.xyz * 1e4;
    if (frame.camera.w > 0.5) { eye = frame.camera.xyz; }
    var hitColor = vec3f(0.0);
    var hit = 0.0;
    var prevP = P;
    for (var i : i32 = 0; i < STEPS; i = i + 1) {
        let t = (f32(i) + jitter) * stepLen + stepLen * 0.5;
        let Q = P + R * t;
        let s = project(Q);
        if (s.z <= 0.0 || s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { break; }
        let st = screenTexel(s.xy, size);
        let ds = depthAt(st, size);
        if (ds >= 1.0) { prevP = Q; continue; }
        let S = worldFromDepth(uvOfTexel(st, size), ds);
        let behind = length(Q - eye) - length(S - eye);
        if (behind > 0.0 && behind < mc.u_thickness + stepLen) {
            var a = prevP;
            var b = Q;
            for (var k : i32 = 0; k < REFINE; k = k + 1) {
                let m = 0.5 * (a + b);
                let sm = project(m);
                let mt = screenTexel(sm.xy, size);
                let dm = depthAt(mt, size);
                let Sm = worldFromDepth(uvOfTexel(mt, size), dm);
                if (length(m - eye) - length(Sm - eye) > 0.0) { b = m; } else { a = m; }
            }
            let sh = project(b);
            let e = min(sh.xy, vec2f(1.0) - sh.xy);
            let edge = smoothstep(0.0, 0.1, min(e.x, e.y));
            let travelled = length(b - P);
            let blur = ((travelled / max(mc.u_maxDistance, 1.0)) * 6.0 + rough * 10.0) * (1.0 - 0.85 * puddle);
            let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
            var col = textureSampleLevel(t0, s0, sh.xy, 0.0).rgb * 0.4;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f( blur, 0.0) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(-blur, 0.0) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(0.0,  blur) * texel, 0.0).rgb * 0.15;
            col = col + textureSampleLevel(t0, s0, sh.xy + vec2f(0.0, -blur) * texel, 0.0).rgb * 0.15;
            hit = edge * (1.0 - smoothstep(0.6, 1.0, travelled / mc.u_maxDistance));
            hitColor = col;
            break;
        }
        prevP = Q;
    }
    var result = mix(scene.rgb, hitColor, vec3f(clamp(weight * hit, 0.0, 1.0)));
    if (mc.u_envParams.x > 0.5 && mc.u_skyReflection > 0.0) {
        let sky = envSky(R, rough);
        result = mix(result, sky, vec3f(clamp(weight * (1.0 - hit) * mc.u_skyReflection, 0.0, 1.0)));
    }
    return vec4f(result, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createBlur(): ShaderHandle {
        const source = `#pragma shader "PP Blur"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(2) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 texelSize = u_viewport.zw;
    float offset = u_intensity;

    vec4 color = vec4(0.0);
    color += texture(u_texture, v_texCoord + vec2(-offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,   -offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset, -offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2(-offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord)                                     * 0.25;
    color += texture(u_texture, v_texCoord + vec2( offset,  0.0)   * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2(-offset,  offset) * texelSize) * 0.0625;
    color += texture(u_texture, v_texCoord + vec2( 0.0,    offset) * texelSize) * 0.125;
    color += texture(u_texture, v_texCoord + vec2( offset,  offset) * texelSize) * 0.0625;

    fragColor = color;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texelSize = tc.u_viewport.zw;
    let offset = mc.u_intensity;
    let uv = v.v_texCoord;

    var color = vec4f(0.0);
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,    -offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset, -offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv, 0.0)                                       * 0.25;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  0.0)   * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f(-offset,  offset) * texelSize, 0.0) * 0.0625;
    color += textureSampleLevel(t0, s0, uv + vec2f( 0.0,     offset) * texelSize, 0.0) * 0.125;
    color += textureSampleLevel(t0, s0, uv + vec2f( offset,  offset) * texelSize, 0.0) * 0.0625;

    return color;
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createVignette(): ShaderHandle {
        const source = `#pragma shader "PP Vignette"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(0.6) range(0,1)
#pragma param u_softness float default(0.5) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float dist = length(uv);
    float vig = 1.0 - smoothstep(1.0 - u_softness, 1.0, dist);
    fragColor = vec4(color.rgb * mix(1.0, vig, u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let uv = v.v_texCoord * 2.0 - 1.0;
    let dist = length(uv);
    let vig = 1.0 - smoothstep(1.0 - mc.u_softness, 1.0, dist);
    return vec4f(color.rgb * mix(1.0, vig, mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createGrayscale(): ShaderHandle {
        const source = `#pragma shader "PP Grayscale"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), u_intensity), color.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let gray = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    return vec4f(mix(color.rgb, vec3f(gray), mc.u_intensity), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createBloomExtract(): ShaderHandle {
        const source = `#pragma shader "PP Bloom Extract"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_threshold float default(0.4) range(0,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = u_threshold * 0.5;
    float soft = brightness - u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contrib = max(soft, brightness - u_threshold);
    contrib /= max(brightness, 0.00001);
    fragColor = vec4(color.rgb * contrib, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let brightness = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let knee = mc.u_threshold * 0.5;
    var soft = brightness - mc.u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    var contrib = max(soft, brightness - mc.u_threshold);
    contrib /= max(brightness, 0.00001);
    return vec4f(color.rgb * contrib, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createBloomKawase(iteration: number): ShaderHandle {
        const d = `(${iteration.toFixed(1)} + 0.5)`;
        const source = `#pragma shader "PP Bloom Kawase ${iteration.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(1) range(0.5,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    float d = ${d} * max(u_radius, 0.5);
    vec2 ts = u_viewport.zw;
    fragColor = (
        texture(u_texture, v_texCoord + vec2(-d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2( d, -d) * ts) +
        texture(u_texture, v_texCoord + vec2(-d,  d) * ts) +
        texture(u_texture, v_texCoord + vec2( d,  d) * ts)
    ) * 0.25;
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let d = ${d} * max(mc.u_radius, 0.5);
    let ts = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    return (
        textureSampleLevel(t0, s0, uv + vec2f(-d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d, -d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f(-d,  d) * ts, 0.0) +
        textureSampleLevel(t0, s0, uv + vec2f( d,  d) * ts, 0.0)
    ) * 0.25;
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createBloomComposite(): ShaderHandle {
        const source = `#pragma shader "PP Bloom Composite"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1.5) range(0,5)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    vec4 blur = texture(u_texture, v_texCoord);
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb + blur.rgb * u_intensity, scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blur = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb + blur.rgb * mc.u_intensity, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createColorGrade(): ShaderHandle {
        const source = `#pragma shader "PP Color Grade"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)
#pragma param u_contrast float default(1) range(0,2)
#pragma param u_saturation float default(1) range(0,2)
#pragma param u_temperature float default(0) range(-1,1)
#pragma param u_tint float default(0) range(-1,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb;

    // Exposure (stops): 2^EV.
    c *= exp2(u_exposure);

    // White balance: warm/cool on R/B, green/magenta on G. Identity at 0.
    c.r *= 1.0 + u_temperature * 0.2;
    c.b *= 1.0 - u_temperature * 0.2;
    c.g *= 1.0 + u_tint * 0.2;

    // Contrast about mid-grey.
    c = (c - 0.5) * u_contrast + 0.5;

    // Saturation about Rec.709 luma.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, u_saturation);

    fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    var c = src.rgb;

    c *= exp2(mc.u_exposure);

    c.r *= 1.0 + mc.u_temperature * 0.2;
    c.b *= 1.0 - mc.u_temperature * 0.2;
    c.g *= 1.0 + mc.u_tint * 0.2;

    c = (c - 0.5) * mc.u_contrast + 0.5;

    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = mix(vec3f(luma), c, mc.u_saturation);

    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createChromaticAberration(): ShaderHandle {
        const source = `#pragma shader "PP Chromatic Aberration"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(3) range(0,20)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 offset = u_intensity * u_viewport.zw;
    float r = texture(u_texture, v_texCoord + offset).r;
    float g = texture(u_texture, v_texCoord).g;
    float b = texture(u_texture, v_texCoord - offset).b;
    float a = texture(u_texture, v_texCoord).a;
    fragColor = vec4(r, g, b, a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let offset = mc.u_intensity * tc.u_viewport.zw;
    let r = textureSampleLevel(t0, s0, v.v_texCoord + offset, 0.0).r;
    let g = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).g;
    let b = textureSampleLevel(t0, s0, v.v_texCoord - offset, 0.0).b;
    let a = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).a;
    return vec4f(r, g, b, a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createTonemap(): ShaderHandle {
        // The manual tonemap: the same acesFilmic() every fragment stage is given,
        // at a point of the stack's choosing and with an exposure. Carry this OR
        // PostProcess.setOutputTransform — the curve is not idempotent.
        const source = `#pragma shader "PP Tonemap"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_exposure float default(0) range(-3,3)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec3 c = src.rgb * exp2(u_exposure);
    fragColor = vec4(acesFilmic(c), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let c = src.rgb * exp2(mc.u_exposure);
    return vec4f(acesFilmic(c), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createFxaa(): ShaderHandle {
        // Luma-based FXAA (Lottes' classic edge-directed blur). Reads only the
        // built-in u_texture/u_viewport; u_intensity blends the AA result back
        // toward the original so 0 is an exact no-op.
        const source = `#pragma shader "PP FXAA"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

const float REDUCE_MIN = 1.0 / 128.0;
const float REDUCE_MUL = 1.0 / 8.0;
const float SPAN_MAX = 8.0;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec2 inv = u_viewport.zw;
    vec4 srcM = texture(u_texture, v_texCoord);
    vec3 rgbNW = texture(u_texture, v_texCoord + vec2(-1.0, -1.0) * inv).rgb;
    vec3 rgbNE = texture(u_texture, v_texCoord + vec2( 1.0, -1.0) * inv).rgb;
    vec3 rgbSW = texture(u_texture, v_texCoord + vec2(-1.0,  1.0) * inv).rgb;
    vec3 rgbSE = texture(u_texture, v_texCoord + vec2( 1.0,  1.0) * inv).rgb;

    float lM = luma(srcM.rgb);
    float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    vec2 dir;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2(-SPAN_MAX), vec2(SPAN_MAX)) * inv;

    vec3 rgbA = 0.5 * (
        texture(u_texture, v_texCoord + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(u_texture, v_texCoord + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(u_texture, v_texCoord + dir * -0.5).rgb +
        texture(u_texture, v_texCoord + dir *  0.5).rgb);

    float lB = luma(rgbB);
    vec3 aa = (lB < lMin || lB > lMax) ? rgbA : rgbB;
    fragColor = vec4(mix(srcM.rgb, aa, clamp(u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end

#pragma fragment wgsl
const REDUCE_MIN = 1.0 / 128.0;
const REDUCE_MUL = 1.0 / 8.0;
const SPAN_MAX = 8.0;

fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let inv = tc.u_viewport.zw;
    let uv = v.v_texCoord;
    let srcM = textureSampleLevel(t0, s0, uv, 0.0);
    let rgbNW = textureSampleLevel(t0, s0, uv + vec2f(-1.0, -1.0) * inv, 0.0).rgb;
    let rgbNE = textureSampleLevel(t0, s0, uv + vec2f( 1.0, -1.0) * inv, 0.0).rgb;
    let rgbSW = textureSampleLevel(t0, s0, uv + vec2f(-1.0,  1.0) * inv, 0.0).rgb;
    let rgbSE = textureSampleLevel(t0, s0, uv + vec2f( 1.0,  1.0) * inv, 0.0).rgb;

    let lM = luma(srcM.rgb);
    let lNW = luma(rgbNW);
    let lNE = luma(rgbNE);
    let lSW = luma(rgbSW);
    let lSE = luma(rgbSE);
    let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    var dir : vec2f;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    let reduce = max((lNW + lNE + lSW + lSE) * 0.25 * REDUCE_MUL, REDUCE_MIN);
    let rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2f(-SPAN_MAX), vec2f(SPAN_MAX)) * inv;

    let rgbA = 0.5 * (
        textureSampleLevel(t0, s0, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
    let rgbB = rgbA * 0.5 + 0.25 * (
        textureSampleLevel(t0, s0, uv + dir * -0.5, 0.0).rgb +
        textureSampleLevel(t0, s0, uv + dir *  0.5, 0.0).rgb);

    let lB = luma(rgbB);
    let aa = select(rgbB, rgbA, lB < lMin || lB > lMax);
    return vec4f(mix(srcM.rgb, aa, clamp(mc.u_intensity, 0.0, 1.0)), srcM.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createLensDistortion(): ShaderHandle {
        // Radial lens warp: u_strength > 0 barrels (bulge), < 0 pincushions;
        // u_zoom rescales to keep edges in frame. Identity at strength 0 / zoom 1
        // (sample uv == source uv). Out-of-source taps resolve to transparent
        // black so a warped edge does not smear.
        const source = `#pragma shader "PP Lens Distortion"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_strength float default(0) range(-1,1)
#pragma param u_zoom float default(1) range(0.5,2)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    vec2 warped = uv * (1.0 + u_strength * r2) / max(u_zoom, 0.0001);
    vec2 suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        fragColor = vec4(0.0);
    } else {
        fragColor = texture(u_texture, suv);
    }
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let uv = v.v_texCoord * 2.0 - 1.0;
    let r2 = dot(uv, uv);
    let warped = uv * (1.0 + mc.u_strength * r2) / max(mc.u_zoom, 0.0001);
    let suv = warped * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        return vec4f(0.0);
    }
    return textureSampleLevel(t0, s0, suv, 0.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createOutline(): ShaderHandle {
        // Ink-edge outline: Sobel edge detection on scene luma, darkening edge
        // pixels toward black — the classic full-screen 2D ink look.
        // u_intensity 0 is an exact no-op; u_threshold gates the edge magnitude
        // (higher = only hard silhouettes); u_thickness is the Sobel tap offset
        // in device pixels (via the injected u_viewport).
        const source = `#pragma shader "PP Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_threshold float default(0.2) range(0,1)
#pragma param u_thickness float default(1) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

float lum(vec2 offset) {
    return dot(texture(u_texture, v_texCoord + offset).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 px = vec2(u_thickness) / u_viewport.xy;
    float tl = lum(vec2(-px.x,  px.y));
    float tt = lum(vec2( 0.0,   px.y));
    float tr = lum(vec2( px.x,  px.y));
    float ll = lum(vec2(-px.x,  0.0));
    float rr = lum(vec2( px.x,  0.0));
    float bl = lum(vec2(-px.x, -px.y));
    float bb = lum(vec2( 0.0,  -px.y));
    float br = lum(vec2( px.x, -px.y));
    float gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    float gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    float edge = clamp((sqrt(gx * gx + gy * gy) - u_threshold) * 4.0, 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, vec3(0.0), edge * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
fn lum(uv : vec2f) -> f32 {
    return dot(textureSampleLevel(t0, s0, uv, 0.0).rgb, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let px = vec2f(mc.u_thickness) / tc.u_viewport.xy;
    let tl = lum(v.v_texCoord + vec2f(-px.x,  px.y));
    let tt = lum(v.v_texCoord + vec2f( 0.0,   px.y));
    let tr = lum(v.v_texCoord + vec2f( px.x,  px.y));
    let ll = lum(v.v_texCoord + vec2f(-px.x,  0.0));
    let rr = lum(v.v_texCoord + vec2f( px.x,  0.0));
    let bl = lum(v.v_texCoord + vec2f(-px.x, -px.y));
    let bb = lum(v.v_texCoord + vec2f( 0.0,  -px.y));
    let br = lum(v.v_texCoord + vec2f( px.x, -px.y));
    let gx = (tr + 2.0 * rr + br) - (tl + 2.0 * ll + bl);
    let gy = (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br);
    let edge = clamp((sqrt(gx * gx + gy * gy) - mc.u_threshold) * 4.0, 0.0, 1.0);
    return vec4f(mix(src.rgb, vec3f(0.0), edge * mc.u_intensity), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createDepthOutline(): ShaderHandle {
        // The silhouette, not the shading: `outline` Sobels scene LUMA and draws
        // an edge wherever the picture changes, while this reads DEPTH, so an
        // edge is a place the geometry steps — at any contrast, including none.

        // Depth is compared as a RATIO, which is what makes one threshold hold
        // across the view: an absolute 0.001 is a wall up close and a kilometre
        // out. Fetched by texel — the pass is 1:1 and depth is not filterable.
        const source = `#pragma shader "PP Depth Outline"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,1)
#pragma param u_threshold float default(0.01) range(0.0005,0.2)
#pragma param u_thickness float default(1) range(1,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

float depthAt(ivec2 texel, ivec2 size) {
    return texelFetch(u_sceneDepth, clamp(texel, ivec2(0), size - ivec2(1)), 0).r;
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 here = ivec2(gl_FragCoord.xy);
    int step = int(max(u_thickness, 1.0));

    float d = depthAt(here, size);
    // Nothing was drawn here: the cleared far plane has no silhouette to find,
    // and testing it would ring the whole frame in an outline.
    if (d >= 1.0) { fragColor = src; return; }

    float dl = depthAt(here + ivec2(-step, 0), size);
    float dr = depthAt(here + ivec2( step, 0), size);
    float dd = depthAt(here + ivec2(0, -step), size);
    float du = depthAt(here + ivec2(0,  step), size);
    // The NEAREST neighbour only: an edge belongs to the surface in front, so
    // the far side of a silhouette does not get a second outline of its own.
    float far = max(max(dl, dr), max(dd, du));
    float edge = clamp(((far - d) / max(d, 1e-6) - u_threshold) * 20.0, 0.0, 1.0);
    fragColor = vec4(mix(src.rgb, vec3(0.0), edge * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
fn depthAt(texel : vec2i, size : vec2i) -> f32 {
    return textureLoad(t7, clamp(texel, vec2i(0), size - vec2i(1)), 0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let here = vec2i(v.pos.xy);
    let step = i32(max(mc.u_thickness, 1.0));

    let d = depthAt(here, size);
    if (d >= 1.0) { return src; }

    let dl = depthAt(here + vec2i(-step, 0), size);
    let dr = depthAt(here + vec2i( step, 0), size);
    let dd = depthAt(here + vec2i(0, -step), size);
    let du = depthAt(here + vec2i(0,  step), size);
    let far = max(max(dl, dr), max(dd, du));
    let edge = clamp(((far - d) / max(d, 1e-6) - mc.u_threshold) * 20.0, 0.0, 1.0);
    return vec4f(mix(src.rgb, vec3f(0.0), vec3f(edge * mc.u_intensity)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Exponential height fog with the atmosphere's two tells: the sun's glow in the haze and a
     * sky that thickens toward the horizon.
     *
     * The fog's density falls off exponentially with height, so how much of it a ray crosses has a
     * closed form: the density at the eye, times the length, times a term that says how fast the
     * ray climbs out of it. That is also what makes the horizon hazy and the zenith clear — a ray
     * that skims the ground stays in the thick part for ever, and one aimed up leaves it at once —
     * so the sky pixels, which have no surface to measure to, are run through the same formula
     * with a very long ray. Looking toward the sun the haze takes the sun's colour.
     *
     * The fog colours are authored as sRGB and brought into linear light here when the project is
     * linear, as a clear colour and a light colour are: a colour is a colour, and the pipeline
     * under it is not the author's business.
     */
    createHeightFog(): ShaderHandle {
        const source = `#pragma shader "PP Height Fog"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.62,0.7,0.8,1)
#pragma param u_sunColor color default(1,0.82,0.55,1)
#pragma param u_density float default(0.0015) range(0,0.05)
#pragma param u_heightFalloff float default(0.003) range(0,0.1)
#pragma param u_baseHeight float default(0) range(-1000,5000)
#pragma param u_startDistance float default(0) range(0,3000)
#pragma param u_maxOpacity float default(1) range(0,1)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(25) range(-10,90)
#pragma param u_inscatter float default(0.6) range(0,2)
#pragma param u_sunExponent float default(8) range(1,64)
#pragma param u_skyFog float default(0.8) range(0,1)
#pragma param u_followSun float default(1) range(0,1)
#pragma param u_volumetric float default(0) range(0,1)
#pragma param u_volumeRange float default(3000) range(100,30000)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const float FAR_RAY = 100000.0;
const int VOLUME_STEPS = 24;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// How much of a ray's light a particle scatters toward the viewer: forward, the way fog glows around the sun.
float phaseHG(float cosine) {
    const float g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}

/// What the exponential density integrates to along a ray: the eye's density, the length,
/// and the term for how fast the ray leaves the fog. Written so a level ray (no climb)
/// needs no division, and so a long ray downward cannot overflow.
float opticalDepth(float eyeY, float dirY, float len) {
    float k = u_heightFalloff;
    float dens = u_density * exp(clamp(-k * (eyeY - u_baseHeight), -60.0, 60.0));
    float kd = k * dirY * len;
    float span = abs(kd) < 1e-4 ? 1.0 : (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd;
    return dens * len * span;
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    bool sky = depth >= 1.0;

    // The ray starts on the near plane, which is the one place that is a point under a
    // perspective camera and under an orthographic one alike.
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    vec3 target = worldFromDepth(v_texCoord, sky ? 1.0 : depth);
    vec3 dir = normalize(target - entry);
    float len = sky ? FAR_RAY : length(target - entry);
    float effective = max(len - u_startDistance, 0.0);
    if (effective <= 0.0) { fragColor = src; return; }

    float tau = opticalDepth(entry.y + dir.y * u_startDistance, dir.y, effective);
    float amount = (1.0 - exp(-tau)) * u_maxOpacity * (sky ? u_skyFog : 1.0);

    // The sun is the scene's own directional light unless the effect is told to ignore it: where it stands and
    // what colour it is come from the light block, so a sun that moves takes its haze with it.
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    float glow = pow(max(dot(dir, sun), 0.0), u_sunExponent);
    vec3 fog = u_fogColor.rgb;
    vec3 sunTint = u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    // The light's own colour is already in the pipeline's space; only its hue is wanted, not its strength.
    if (follow) sunTint = lightColor.rgb / max(max(lightColor.r, lightColor.g), max(lightColor.b, 1e-3));
    float shaped = u_volumetric > 0.0 ? glow * (1.0 - u_volumetric) : glow;
    vec3 colour = mix(fog, sunTint, clamp(shaped * u_inscatter, 0.0, 1.0));
    vec3 result = mix(src.rgb, colour, clamp(amount, 0.0, 1.0));

    // The sun's light through the haze, where the shadow map says it gets through: the air between the camera and
    // the surface is walked in steps, and each one that stands in light adds what it scatters toward the eye.
    if (u_volumetric > 0.0 && follow) {
        float range = min(len, u_volumeRange);
        float span = max(range - u_startDistance, 0.0);
        float ds = span / float(VOLUME_STEPS);
        float jitter = ign(gl_FragCoord.xy);
        float transmit = 1.0;
        float lit = 0.0;
        for (int i = 0; i < VOLUME_STEPS; ++i) {
            float t = u_startDistance + (float(i) + jitter) * ds;
            vec3 p = entry + dir * t;
            float dens = u_density * exp(clamp(-u_heightFalloff * (p.y - u_baseHeight), -60.0, 60.0));
            lit += transmit * dens * ds * sunVisibility(p, tiles.x, tiles.y);
            transmit *= exp(-dens * ds);
        }
        float strength = clamp(lightColor.a, 0.0, 8.0) * 0.5;
        result += sunTint * lit * phaseHG(dot(dir, sun)) * u_inscatter * u_volumetric * strength * (sky ? u_skyFog : 1.0);
    }
    fragColor = vec4(result, src.a);
}
#pragma end

#pragma fragment wgsl
const FAR_RAY : f32 = 100000.0;
const VOLUME_STEPS : i32 = 24;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn phaseHG(cosine : f32) -> f32 {
    let g = 0.55;
    return (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-3), 1.5) * 0.25;
}

fn opticalDepth(eyeY : f32, dirY : f32, len : f32) -> f32 {
    let k = mc.u_heightFalloff;
    let dens = mc.u_density * exp(clamp(-k * (eyeY - mc.u_baseHeight), -60.0, 60.0));
    let kd = k * dirY * len;
    var span = 1.0;
    if (abs(kd) >= 1e-4) { span = (1.0 - exp(clamp(-kd, -60.0, 60.0))) / kd; }
    return dens * len * span;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    let depth = textureLoad(t7, clamp(vec2i(v.v_texCoord * vec2f(size)), vec2i(0), size - vec2i(1)), 0);
    let sky = depth >= 1.0;

    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var d = depth;
    if (sky) { d = 1.0; }
    let tgt = worldFromDepth(v.v_texCoord, d);
    let dir = normalize(tgt - entry);
    var len = length(tgt - entry);
    if (sky) { len = FAR_RAY; }
    let effective = max(len - mc.u_startDistance, 0.0);
    if (effective <= 0.0) { return src; }

    let tau = opticalDepth(entry.y + dir.y * mc.u_startDistance, dir.y, effective);
    var amount = (1.0 - exp(-tau)) * mc.u_maxOpacity;
    if (sky) { amount = amount * mc.u_skyFog; }

    // See the GLSL twin: the scene's own sun unless told not to follow it.
    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    var shaped = dot(dir, sun);
    let glow = pow(max(shaped, 0.0), mc.u_sunExponent);
    var fog = mc.u_fogColor.rgb;
    var sunTint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    if (follow) { sunTint = found.color.rgb / max(max(found.color.r, found.color.g), max(found.color.b, 1e-3)); }
    var glowShare = glow;
    if (mc.u_volumetric > 0.0) { glowShare = glow * (1.0 - mc.u_volumetric); }
    let colour = mix(fog, sunTint, clamp(glowShare * mc.u_inscatter, 0.0, 1.0));
    var result = mix(src.rgb, colour, clamp(amount, 0.0, 1.0));

    if (mc.u_volumetric > 0.0 && follow) {
        let range = min(len, mc.u_volumeRange);
        let span = max(range - mc.u_startDistance, 0.0);
        let ds = span / f32(VOLUME_STEPS);
        let jitter = ign(v.pos.xy);
        var transmit = 1.0;
        var lit = 0.0;
        for (var i : i32 = 0; i < VOLUME_STEPS; i = i + 1) {
            let t = mc.u_startDistance + (f32(i) + jitter) * ds;
            let p = entry + dir * t;
            let dens = mc.u_density * exp(clamp(-mc.u_heightFalloff * (p.y - mc.u_baseHeight), -60.0, 60.0));
            lit = lit + transmit * dens * ds * sunVisibility(p, found.tiles.x, found.tiles.y);
            transmit = transmit * exp(-dens * ds);
        }
        let strength = clamp(found.color.a, 0.0, 8.0) * 0.5;
        var skyShare = 1.0;
        if (sky) { skyShare = mc.u_skyFog; }
        result = result + sunTint * lit * phaseHG(dot(dir, sun)) * mc.u_inscatter * mc.u_volumetric * strength * skyShare;
    }
    return vec4f(result, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Light shafts: the sun's light through whatever stands between it and the camera, found in
     * screen space. From each pixel a short march toward the sun's position on screen collects
     * how much of the way is open sky; a pixel behind a branch or a building sees little of it
     * and one in the open sees all of it, so what stands in front of the sun leaves rays in the
     * glow around it. The sun's place comes from projecting its direction with the camera's own
     * matrix, so nothing but the direction is asked of the author.
     *
     * Only what the depth buffer holds can cast a shaft, and the sun has to be on screen or
     * just off it: the march has nowhere to go toward a sun behind the camera.
     */
    createLightShafts(): ShaderHandle {
        const source = `#pragma shader "PP Light Shafts"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_sunColor color default(1,0.85,0.6,1)
#pragma param u_intensity float default(0.6) range(0,3)
#pragma param u_sunAzimuth float default(40) range(0,360)
#pragma param u_sunElevation float default(25) range(-10,90)
#pragma param u_decay float default(0.96) range(0.8,1)
#pragma param u_reach float default(0.6) range(0.1,1)
#pragma param u_followSun float default(1) range(0,1)
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int SAMPLES = 40;

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec4 lightDir, lightColor;
    ivec2 tiles;
    findSun(lightDir, lightColor, tiles);
    bool follow = u_followSun > 0.5 && lightDir.w > 0.5;
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = follow ? lightDir.xyz : vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    vec3 eye = worldFromDepth(v_texCoord, 0.0);
    vec4 clip = u_projection * vec4(eye + sun * 10000.0, 1.0);
    // Behind the camera there is no screen position to march toward.
    if (clip.w <= 1e-4) { fragColor = src; return; }
    vec2 sunUv = clip.xy / clip.w * 0.5 + 0.5;

    ivec2 size = textureSize(u_sceneDepth, 0);
    vec2 toSun = (sunUv - v_texCoord) * u_reach;
    float aspect = float(size.x) / float(size.y);
    float dist = length(vec2((sunUv.x - v_texCoord.x) * aspect, sunUv.y - v_texCoord.y));
    vec2 stepUv = toSun / float(SAMPLES);
    vec2 uv = v_texCoord + stepUv * ign(gl_FragCoord.xy);
    float light = 0.0;
    float weight = 1.0;
    for (int i = 0; i < SAMPLES; ++i) {
        uv += stepUv;
        ivec2 t = clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
        // Open sky is where the sun reaches; anything with a surface blocks it.
        float open = texelFetch(u_sceneDepth, t, 0).r >= 1.0 ? 1.0 : 0.0;
        light += open * weight;
        weight *= u_decay;
    }
    light /= float(SAMPLES);
    // Strongest next to the sun, gone a screen away from it.
    float falloff = 1.0 - smoothstep(0.0, 1.2, dist);
    vec3 tint = u_sunColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    if (follow) tint = lightColor.rgb / max(max(lightColor.r, lightColor.g), max(lightColor.b, 1e-3));
    fragColor = vec4(src.rgb + tint * light * falloff * u_intensity, src.a);
}
#pragma end

#pragma fragment wgsl
const SAMPLES : i32 = 40;

fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let found = findSun();
    let follow = mc.u_followSun > 0.5 && found.dir.w > 0.5;
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    var sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    if (follow) { sun = found.dir.xyz; }
    let eye = worldFromDepth(v.v_texCoord, 0.0);
    let clip = frame.projection * vec4f(eye + sun * 10000.0, 1.0);
    if (clip.w <= 1e-4) { return src; }
    // This device's uv runs down the rows, so clip y is flipped on the way back.
    let sunUv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);

    let size = vec2i(textureDimensions(t7, 0));
    let toSun = (sunUv - v.v_texCoord) * mc.u_reach;
    let aspect = f32(size.x) / f32(size.y);
    let dist = length(vec2f((sunUv.x - v.v_texCoord.x) * aspect, sunUv.y - v.v_texCoord.y));
    let stepUv = toSun / f32(SAMPLES);
    var uv = v.v_texCoord + stepUv * ign(v.pos.xy);
    var light = 0.0;
    var weight = 1.0;
    for (var i : i32 = 0; i < SAMPLES; i = i + 1) {
        uv = uv + stepUv;
        let t = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
        var lit = 0.0;
        if (textureLoad(t7, t, 0) >= 1.0) { lit = 1.0; }
        light = light + lit * weight;
        weight = weight * mc.u_decay;
    }
    light = light / f32(SAMPLES);
    let falloff = 1.0 - smoothstep(0.0, 1.2, dist);
    var tint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    if (follow) { tint = found.color.rgb / max(max(found.color.r, found.color.g), max(found.color.b, 1e-3)); }
    return vec4f(src.rgb + tint * light * falloff * mc.u_intensity, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Auto exposure, pass 1 of 3: how bright is the picture, in a few texels. Each texel of this
     * small target averages the LOG of the luminance over a block of the scene — the log, because
     * the eye judges brightness by ratio, and an average of raw values is decided by whatever
     * lamp or sun is in view. Pixels darker than 2^-8 are left out of the average — a black
     * backdrop is not a dark scene, and counting it would open the exposure to the limit — and
     * what share of the block counted travels beside the average. Both are stored as 0..1 codes
     * (the average over -12..8 stops), because the target may be 8-bit when the project is not HDR.
     */
    createAutoExposureMeasure(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Measure"
#pragma version 300 es
#pragma domain PostProcess
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    float sum = 0.0;
    float counted = 0.0;
    // Sixteen bilinear taps, four pixels apart: each reads 2x2 pixels and together they
    // cover the 16x16 block this texel stands for.
    for (int j = 0; j < 4; ++j) {
        for (int i = 0; i < 4; ++i) {
            vec3 c = texture(u_texture, v_texCoord + (vec2(float(i), float(j)) - 1.5) * 4.0 * texel).rgb;
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            if (lum > 0.0039) { sum += log2(lum); counted += 1.0; }
        }
    }
    float code = counted > 0.0 ? clamp((sum / counted + 12.0) / 20.0, 0.0, 1.0) : 0.0;
    fragColor = vec4(code, counted / 16.0, 0.0, 1.0);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    var sum = 0.0;
    var counted = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        for (var i : i32 = 0; i < 4; i = i + 1) {
            let c = textureSampleLevel(t0, s0, v.v_texCoord + (vec2f(f32(i), f32(j)) - 1.5) * 4.0 * texel, 0.0).rgb;
            let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
            if (lum > 0.0039) { sum = sum + log2(lum); counted = counted + 1.0; }
        }
    }
    var code = 0.0;
    if (counted > 0.0) { code = clamp((sum / counted + 12.0) / 20.0, 0.0, 1.0); }
    return vec4f(code, counted / 16.0, 0.0, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Auto exposure, pass 2 of 3: the exposure the eye has settled on. The measurement is averaged
     * to one number, turned into the exposure that would put that brightness at middle grey, and
     * moved toward over time from where the last frame left it — that last value is this pass's own
     * previous output, which the engine keeps for it (`u_feedback`). Brightening is allowed to
     * be faster than darkening, as an eye adapts, and the rate is per second so it does not depend on
     * the frame rate.
     */
    createAutoExposureAdapt(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Adapt"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_bias float default(0) range(-4,4)
#pragma param u_speedUp float default(3) range(0.1,20)
#pragma param u_speedDown float default(1) range(0.1,20)
#pragma param u_minEV float default(-4) range(-10,0)
#pragma param u_maxEV float default(4) range(0,10)
#pragma param u_metering float default(0) range(0,2)
#pragma param u_meterSize float default(0.35) range(0.02,1)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_feedback texture default(black)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

/// How much a place on the screen counts: everywhere equally, a soft bright-centre bias, or a disc and nothing else.
float meterWeight(vec2 uv) {
    if (u_metering < 0.5) return 1.0;
    float r = length(uv - 0.5) / max(u_meterSize, 0.02);
    if (u_metering < 1.5) return exp(-2.0 * r * r) + 0.04;
    return r < 1.0 ? 1.0 : 0.0;
}

void main() {
    float sum = 0.0;
    float weight = 0.0;
    // The taps spread over the part of the picture that counts: all of it for an average, a region around the centre
    // for the other two, so a small spot still has taps in it.
    float extent = u_metering < 0.5 ? 1.0 : clamp(u_meterSize * 2.4, 0.1, 1.0);
    for (int j = 0; j < 8; ++j) {
        for (int i = 0; i < 8; ++i) {
            vec2 at = 0.5 + ((vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5) * extent;
            vec2 m = texture(u_texture, at).rg;
            float w = meterWeight(at);
            sum += m.r * m.g * w;
            weight += m.g * w;
        }
    }
    // Weighted by how much of each block counted; a picture with nothing to measure
    // is left at the exposure the author's compensation alone asks for.
    float meanLog = weight > 1e-3 ? (sum / weight) * 20.0 - 12.0 : log2(0.18);
    // The exposure that takes the scene's mean to 18% grey, plus what the author asked for.
    float target = clamp(log2(0.18) - meanLog + u_bias, u_minEV, u_maxEV);
    float prev = texture(u_feedback, vec2(0.5)).r * 20.0 - 10.0;
    float ev = target;
    if (u_historyValid > 0.5) {
        float rate = target > prev ? u_speedUp : u_speedDown;
        ev = prev + (target - prev) * (1.0 - exp(-clamp(u_time.y, 0.0, 0.25) * rate));
    }
    float code = clamp((ev + 10.0) / 20.0, 0.0, 1.0);
    fragColor = vec4(code, code, code, 1.0);
}
#pragma end

#pragma fragment wgsl
fn meterWeight(uv : vec2f) -> f32 {
    if (mc.u_metering < 0.5) { return 1.0; }
    let r = length(uv - vec2f(0.5)) / max(mc.u_meterSize, 0.02);
    if (mc.u_metering < 1.5) { return exp(-2.0 * r * r) + 0.04; }
    return select(0.0, 1.0, r < 1.0);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var sum = 0.0;
    var weight = 0.0;
    var extent = 1.0;
    if (mc.u_metering >= 0.5) { extent = clamp(mc.u_meterSize * 2.4, 0.1, 1.0); }
    for (var j : i32 = 0; j < 8; j = j + 1) {
        for (var i : i32 = 0; i < 8; i = i + 1) {
            let at = vec2f(0.5) + ((vec2f(f32(i), f32(j)) + 0.5) / 8.0 - vec2f(0.5)) * extent;
            let m = textureSampleLevel(t0, s0, at, 0.0).rg;
            let w = meterWeight(at);
            sum = sum + m.r * m.g * w;
            weight = weight + m.g * w;
        }
    }
    var meanLog = log2(0.18);
    if (weight > 1e-3) { meanLog = (sum / weight) * 20.0 - 12.0; }
    let target_ev = clamp(log2(0.18) - meanLog + mc.u_bias, mc.u_minEV, mc.u_maxEV);
    let prev = textureSampleLevel(u_feedback, u_feedback_s, vec2f(0.5), 0.0).r * 20.0 - 10.0;
    var ev = target_ev;
    if (mc.u_historyValid > 0.5) {
        var rate = mc.u_speedDown;
        if (target_ev > prev) { rate = mc.u_speedUp; }
        ev = prev + (target_ev - prev) * (1.0 - exp(-clamp(tc.u_time.y, 0.0, 0.25) * rate));
    }
    let code = clamp((ev + 10.0) / 20.0, 0.0, 1.0);
    return vec4f(code, code, code, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /** Auto exposure, pass 3 of 3: the scene, at unit 1, scaled by the exposure the last pass settled on. */
    createAutoExposureApply(): ShaderHandle {
        const source = `#pragma shader "PP Auto Exposure Apply"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;

void main() {
    float ev = texture(u_texture, vec2(0.5)).r * 20.0 - 10.0;
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    fragColor = vec4(scene.rgb * exp2(ev), scene.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let ev = textureSampleLevel(t0, s0, vec2f(0.5), 0.0).r * 20.0 - 10.0;
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    return vec4f(scene.rgb * exp2(ev), scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Depth of field, pass 1 of 3: where the lens is focused. A few texels hold one number, the focus distance —
     * the one the author wrote, or with `u_autoFocus` on, the distance of the surface under the focus point,
     * which moves toward its target a little each frame so a rack focus is a glide and not a cut. A float
     * target, because a distance in metres is not a share of 255.
     */
    createDofFocus(): ShaderHandle {
        const source = `#pragma shader "PP DoF Focus"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_focusDistance float default(600) range(1,5000)
#pragma param u_autoFocus float default(0) range(0,1)
#pragma param u_focusX float default(0.5) range(0,1)
#pragma param u_focusY float default(0.5) range(0,1)
#pragma param u_focusSpeed float default(5) range(0.1,40)
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_feedback texture default(black)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

void main() {
    float prev = texture(u_feedback, vec2(0.5)).r;
    float target = u_focusDistance;
    if (u_autoFocus > 0.5) {
        ivec2 size = textureSize(u_sceneDepth, 0);
        vec3 eye = worldFromDepth(vec2(u_focusX, 1.0 - u_focusY), 0.0);
        // Nine taps a little apart: what is under the point, not whatever one pixel of it happens to be.
        float sum = 0.0;
        float n = 0.0;
        for (int j = -1; j <= 1; ++j) {
            for (int i = -1; i <= 1; ++i) {
                vec2 uv = vec2(u_focusX, 1.0 - u_focusY) + vec2(float(i), float(j)) * 0.012;
                float d = depthAt(screenTexel(uv, size), size);
                if (d >= 1.0) continue;
                sum += length(worldFromDepth(uv, d) - eye);
                n += 1.0;
            }
        }
        // Nothing but sky under the point: the lens stays where it was.
        target = n > 0.5 ? sum / n : (u_historyValid > 0.5 ? prev : u_focusDistance);
    }
    float focus = target;
    if (u_historyValid > 0.5 && prev > 0.0) {
        // In the log of the distance: the same share of a near thing and a far one per second.
        float k = 1.0 - exp(-clamp(u_time.y, 0.0, 0.25) * u_focusSpeed);
        focus = exp(mix(log(prev), log(max(target, 1e-3)), k));
    }
    fragColor = vec4(focus, 0.0, 0.0, 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let prev = textureSampleLevel(u_feedback, u_feedback_s, vec2f(0.5), 0.0).r;
    var target_d = mc.u_focusDistance;
    if (mc.u_autoFocus > 0.5) {
        let size = vec2i(textureDimensions(t7, 0));
        let eye = worldFromDepth(vec2f(mc.u_focusX, mc.u_focusY), 0.0);
        var sum = 0.0;
        var n = 0.0;
        for (var j : i32 = -1; j <= 1; j = j + 1) {
            for (var i : i32 = -1; i <= 1; i = i + 1) {
                let uv = vec2f(mc.u_focusX, mc.u_focusY) + vec2f(f32(i), f32(j)) * 0.012;
                let d = depthAt(screenTexel(uv, size), size);
                if (d >= 1.0) { continue; }
                sum = sum + length(worldFromDepth(uv, d) - eye);
                n = n + 1.0;
            }
        }
        if (n > 0.5) { target_d = sum / n; }
        else if (mc.u_historyValid > 0.5) { target_d = prev; }
    }
    var focus = target_d;
    if (mc.u_historyValid > 0.5 && prev > 0.0) {
        let k = 1.0 - exp(-clamp(tc.u_time.y, 0.0, 0.25) * mc.u_focusSpeed);
        focus = exp(mix(log(prev), log(max(target_d, 1e-3)), k));
    }
    return vec4f(focus, 0.0, 0.0, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Depth of field, pass 2 of 3: how blurred each pixel is. The circle of confusion comes from how far the surface is
     * from the focus the first pass settled on (at unit 0), past the slab that stays sharp, as a share of its distance — the
     * thin-lens ratio, capped — and travels in the alpha of the scene (unit 1), so the pass that gathers does not have to find
     * a depth for every tap. A float target: a blur of 11.4 pixels is not a share of 255.
     */
    createDofCoc(): ShaderHandle {
        const source = `#pragma shader "PP DoF Circle"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_focusRange float default(100) range(0,2000)
#pragma param u_aperture float default(24) range(0,64)
#pragma param u_maxBlur float default(14) range(1,32)
#pragma highprecision

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

void main() {
    vec4 src = texture(u_sceneTexture, v_texCoord);
    float focus = texture(u_texture, vec2(0.5)).r;
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = depthAt(screenTexel(v_texCoord, size), size);
    float coc = min(u_aperture, u_maxBlur);
    if (depth < 1.0) {
        vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : worldFromDepth(v_texCoord, 0.0);
        float dist = length(worldFromDepth(v_texCoord, depth) - eye);
        coc = min(u_aperture * max(abs(dist - focus) - u_focusRange, 0.0) / max(dist, 1e-3), u_maxBlur);
    }
    fragColor = vec4(src.rgb, coc);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let focus = textureSampleLevel(t0, s0, vec2f(0.5), 0.0).r;
    let size = vec2i(textureDimensions(t7, 0));
    let depth = depthAt(screenTexel(v.v_texCoord, size), size);
    var coc = min(mc.u_aperture, mc.u_maxBlur);
    if (depth < 1.0) {
        var eye = worldFromDepth(v.v_texCoord, 0.0);
        if (frame.camera.w > 0.5) { eye = frame.camera.xyz; }
        let dist = length(worldFromDepth(v.v_texCoord, depth) - eye);
        coc = min(mc.u_aperture * max(abs(dist - focus) - mc.u_focusRange, 0.0) / max(dist, 1e-3), mc.u_maxBlur);
    }
    return vec4f(src.rgb, coc);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Depth of field, pass 3 of 3: the blur. A pixel gathers its neighbours over its own circle, counting a neighbour
     * only to the extent that neighbour's own circle reaches back (read from the previous pass's alpha, so a sharp object in
     * front of a blurred background does not bleed into it while a blurred foreground spreads over what is behind). The taps
     * lie on a spiral inside a disc, or inside an n-sided polygon when `u_blades` is 3 or more — the shape of the lens's
     * aperture, which is what a point of light becomes out of focus — and `u_highlight` makes bright taps count for more, so
     * a lamp out of focus is a bright shape and not a dim smear.
     */
    createDofGather(): ShaderHandle {
        const GLSL = `
const int TAPS = 64;
const float TAU = 6.2831853;
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// A point of the unit disc pushed out to the n-gon that has the disc as its circumscribing circle.
vec2 shapeTap(vec2 p, float blades, float turn) {
    if (blades < 2.5) return p;
    float a = atan(p.y, p.x) - turn;
    float sector = TAU / blades;
    float within = mod(a + sector * 0.5, sector) - sector * 0.5;
    return p * (cos(sector * 0.5) / cos(within));
}`;
        const WGSL = `
const TAPS : i32 = 64;
const TAU : f32 = 6.2831853;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn shapeTap(p : vec2f, blades : f32, turn : f32) -> vec2f {
    if (blades < 2.5) { return p; }
    let a = atan2(p.y, p.x) - turn;
    let sector = TAU / blades;
    let within = (a + sector * 0.5) - sector * floor((a + sector * 0.5) / sector) - sector * 0.5;
    return p * (cos(sector * 0.5) / cos(within));
}`;
        const source = `#pragma shader "PP DoF Gather"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_blades float default(0) range(0,9)
#pragma param u_bokehRotation float default(0) range(0,360)
#pragma param u_highlight float default(0) range(0,8)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float coc = src.a;
    if (coc < 0.5) { fragColor = vec4(src.rgb, 1.0); return; }

    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    // The taps shift along their spiral by a fraction of one, a different one at each pixel: the pattern stays whole and
    // what is left of the jitter is grain a temporal pass averages away, instead of a disc turned about at random.
    float jitter = ign(gl_FragCoord.xy);
    float turn = radians(u_bokehRotation);
    float centre = 1.0 + u_highlight * smoothstep(1.0, 6.0, dot(src.rgb, vec3(0.2126, 0.7152, 0.0722)));
    vec3 sum = src.rgb * centre;
    float wsum = centre;
    for (int i = 0; i < TAPS; ++i) {
        float k = float(i) + jitter;
        float r = sqrt((k + 0.5) / float(TAPS));
        float a = k * 2.39996323;
        vec2 disc = shapeTap(vec2(cos(a), sin(a)) * r, u_blades, turn);
        vec2 uv = v_texCoord + disc * coc * texel;
        vec4 tap = texture(u_texture, uv);
        // Gathered only to the extent that tap's own blur reaches back here.
        float w = clamp(tap.a / max(length(disc) * coc, 0.5), 0.0, 1.0);
        w *= 1.0 + u_highlight * smoothstep(1.0, 6.0, dot(tap.rgb, vec3(0.2126, 0.7152, 0.0722)));
        sum += tap.rgb * w;
        wsum += w;
    }
    fragColor = vec4(sum / wsum, 1.0);
}
#pragma end

#pragma fragment wgsl
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let coc = src.a;
    if (coc < 0.5) { return vec4f(src.rgb, 1.0); }

    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    let jitter = ign(v.pos.xy);
    let turn = radians(mc.u_bokehRotation);
    let centre = 1.0 + mc.u_highlight * smoothstep(1.0, 6.0, dot(src.rgb, vec3f(0.2126, 0.7152, 0.0722)));
    var sum = src.rgb * centre;
    var wsum = centre;
    for (var i : i32 = 0; i < TAPS; i = i + 1) {
        let k = f32(i) + jitter;
        let r = sqrt((k + 0.5) / f32(TAPS));
        let a = k * 2.39996323;
        let disc = shapeTap(vec2f(cos(a), sin(a)) * r, mc.u_blades, turn);
        let uv = v.v_texCoord + disc * coc * texel;
        let tap = textureSampleLevel(t0, s0, uv, 0.0);
        var w = clamp(tap.a / max(length(disc) * coc, 0.5), 0.0, 1.0);
        w = w * (1.0 + mc.u_highlight * smoothstep(1.0, 6.0, dot(tap.rgb, vec3f(0.2126, 0.7152, 0.0722))));
        sum = sum + tap.rgb * w;
        wsum = wsum + w;
    }
    return vec4f(sum / wsum, 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * Rain, in two parts that a real storm has. Falling streaks: three layers of thin slanted lines
     * scrolling down the screen, each standing at a different distance, so a streak is hidden by a
     * surface nearer than the layer it belongs to and drawn over one farther away — the sky counts as
     * infinitely far. And a wet ground: a surface that faces up is darkened, and rings spread over it
     * where drops land, laid out on a grid in the WORLD so they stay on the ground when the camera moves.
     *
     * The clock is `u_time.x * u_timeScale + u_phase`: left alone it runs with the game, and a capture that
     * must be the same on every run sets the scale to 0 and the phase to the time it wants.
     *
     * Wet surfaces are also shinier than dry ones, which is not done here: raise \`ssr\` beside it.
     */
    createRain(): ShaderHandle {
        const GLSL = `
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/// One layer of streaks: columns across the screen, one streak per cell at most, scrolling down.
float streaks(vec2 uv, float aspect, float cols, float speed, float seed, float T) {
    vec2 q = vec2(uv.x * aspect - uv.y * u_wind, uv.y);
    float cx = floor(q.x * cols);
    float fx = fract(q.x * cols);
    float h1 = hash11(cx + seed);
    float h2 = hash11(cx * 1.7 + seed * 3.1);
    // GL rows run up the screen, so a pattern that falls moves toward lower rows.
    float y = q.y * 4.0 + T * speed * (0.8 + 0.4 * h1) + h2 * 17.0;
    float cell = floor(y);
    float fy = fract(y);
    float here = hash11(cx * 31.0 + cell + seed);
    if (here > u_intensity * 0.5) return 0.0;
    float dx = abs(fx - 0.5 - (hash11(cell + cx) - 0.5) * 0.6);
    float across = 1.0 - smoothstep(0.0, 0.06, dx);
    float along = (1.0 - fy / u_streakLength) * step(fy, u_streakLength);
    return across * along;
}`;
        const WGSL = `
fn hash11(n : f32) -> f32 { return fract(sin(n * 127.1) * 43758.5453); }
fn hash21(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

fn streaks(uv : vec2f, aspect : f32, cols : f32, speed : f32, seed : f32, T : f32) -> f32 {
    let q = vec2f(uv.x * aspect - (1.0 - uv.y) * mc.u_wind, 1.0 - uv.y);
    let cx = floor(q.x * cols);
    let fx = fract(q.x * cols);
    let h1 = hash11(cx + seed);
    let h2 = hash11(cx * 1.7 + seed * 3.1);
    // Here uv runs DOWN the screen and q is flipped back to run up, as in GL, so the same
    // falling motion is the same sign.
    let y = q.y * 4.0 + T * speed * (0.8 + 0.4 * h1) + h2 * 17.0;
    let cell = floor(y);
    let fy = fract(y);
    let here = hash11(cx * 31.0 + cell + seed);
    if (here > mc.u_intensity * 0.5) { return 0.0; }
    let dx = abs(fx - 0.5 - (hash11(cell + cx) - 0.5) * 0.6);
    let across = 1.0 - smoothstep(0.0, 0.06, dx);
    var along = 0.0;
    if (fy <= mc.u_streakLength) { along = 1.0 - fy / mc.u_streakLength; }
    return across * along;
}`;
        const source = `#pragma shader "PP Rain"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_wetness float default(1) range(0,1)
#pragma param u_wind float default(0.15) range(-1,1)
#pragma param u_speed float default(1.6) range(0.2,6)
#pragma param u_streakLength float default(0.3) range(0.05,0.9)
#pragma param u_rippleScale float default(60) range(5,400)
#pragma param u_puddles float default(0.3) range(0,1)
#pragma param u_puddleScale float default(350) range(40,2000)
#pragma param u_streakColor color default(0.78,0.82,0.9,1)
#pragma param u_timeScale float default(1) range(0,1)
#pragma param u_phase float default(0) range(0,100000)
#pragma param u_shelterRange float default(3000) range(100,30000)
#pragma param u_shelterBias float default(40) range(1,500)
#pragma param u_coverActive float default(0) range(0,1)
#pragma param u_coverMatrix0 color default(1,0,0,0)
#pragma param u_coverMatrix1 color default(0,1,0,0)
#pragma param u_coverMatrix2 color default(0,0,1,0)
#pragma param u_coverMatrix3 color default(0,0,0,1)
#pragma param u_rainCover texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}
${PUDDLE_GLSL}
${BASIN_GLSL}
${GLSL}

/// 1 where something stands over a point, as the map of the scene seen from straight above says — an awning, a roof,
/// a tree — and 0 in the open. The map stores the depth the shadow maps do, so a point on the surface itself is not over it.
float shelteredAt(vec3 W) {
    if (u_coverActive < 0.5) return 0.0;
    vec4 c = mat4(u_coverMatrix0, u_coverMatrix1, u_coverMatrix2, u_coverMatrix3) * vec4(W, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float stored = dot(texture(u_rainCover, uv).rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    float here = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
    return stored < here - u_shelterBias / (4.0 * u_shelterRange) ? 1.0 : 0.0;
}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 sz = vec2(textureSize(u_texture, 0));
    float aspect = sz.x / sz.y;
    float T = u_time.x * u_timeScale + u_phase;
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    // How far the surface here is, measured along the same ray as the streak layers are.
    float dist = d >= 1.0 ? 1e9 : length(worldFromDepth(uvOfTexel(c, size), d) - entry);

    vec3 tint = u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    vec3 col = src.rgb;

    if (d < 1.0 && u_wetness > 0.0) {
        vec3 P = worldFromDepth(uvOfTexel(c, size), d);
        float dl = depthAt(c + ivec2(-1, 0), size);
        float dr = depthAt(c + ivec2( 1, 0), size);
        float dd = depthAt(c + ivec2(0, -1), size);
        float du = depthAt(c + ivec2(0,  1), size);
        vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                            : P - worldAt(c + ivec2(-1, 0), size);
        vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                            : P - worldAt(c + ivec2(0, -1), size);
        vec3 N = normalize(cross(ax, ay));
        if (dot(N, viewDirection(P)) < 0.0) N = -N;
        float up = smoothstep(0.86, 0.95, N.y);
        // A wet surface is darker, because water in the pores takes the light a dry one scatters;
        // standing water is darker still.
        // What stands over it: rain does not reach ground under an awning, so it stays dry and still, and the drops that
        // would have fallen there have landed on the awning instead — which, being open to the sky, is wet in its turn.
        float shelter = shelteredAt(P + vec3(0.0, 1.0, 0.0));
        float wet = u_wetness * (1.0 - 0.9 * shelter);
        float puddle = puddleMask(P.xz, basinCoverage(c, size, P, u_puddles, u_puddleScale), u_puddleScale) * up * wet;
        col *= 1.0 - 0.32 * wet * up;
        col *= 1.0 - 0.35 * puddle;
        // Drops landing need drops falling: wet ground under no rain is still.
        float falling = clamp(u_intensity, 0.0, 1.0) * (1.0 - shelter);
        float near = 1.0 - smoothstep(1200.0, 3500.0, dist);
        // Rings where drops land, on a grid in the world; they are denser and clearer on standing water.
        vec2 g = P.xz / u_rippleScale;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float h = hash21(id);
        vec2 centre = (vec2(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
        float phase = fract(T * 0.9 + h);
        float ring = (1.0 - smoothstep(0.0, 0.035, abs(length(f - centre) - phase * 0.5)))
                   * (1.0 - phase) * (1.0 - phase) * step(hash21(id + 3.0), mix(0.55, 0.9, puddle));
        col += tint * ring * mix(0.4, 0.9, puddle) * u_wetness * up * near * falling;
        // Splashes: the small, quick crown of a drop that lands on ground that is not water.
        vec2 g2 = P.xz / (u_rippleScale * 0.3);
        vec2 id2 = floor(g2);
        vec2 f2 = fract(g2) - 0.5;
        float ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
        vec2 c2 = (vec2(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
        float splash = (1.0 - smoothstep(0.0, 0.06, abs(length(f2 - c2) - ph2 * 0.3)))
                     * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2) * step(hash21(id2 + 2.0), 0.5);
        col += tint * splash * 0.55 * u_wetness * up * near * falling * (1.0 - puddle);
    }

    // Three layers, nearest last: a layer is drawn only over what is farther than it.
    // And a layer's drops fall where the layer stands: under a roof there are none.
    vec3 along = normalize(worldFromDepth(v_texCoord, d < 1.0 ? d : 1.0) - entry);
    float rain = 0.0;
    if (dist > 120.0)  rain += streaks(v_texCoord, aspect,  70.0, u_speed * 1.0, 1.0, T) * 0.35 * (1.0 - shelteredAt(entry + along * 120.0));
    if (dist > 450.0)  rain += streaks(v_texCoord, aspect, 130.0, u_speed * 1.4, 2.0, T) * 0.28 * (1.0 - shelteredAt(entry + along * 450.0));
    if (dist > 1400.0) rain += streaks(v_texCoord, aspect, 230.0, u_speed * 1.9, 3.0, T) * 0.22 * (1.0 - shelteredAt(entry + along * 1400.0));
    col += tint * rain * u_intensity;
    fragColor = vec4(col, src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${PUDDLE_WGSL}
${BASIN_WGSL}
${WGSL}

fn shelteredAt(W : vec3f) -> f32 {
    if (mc.u_coverActive < 0.5) { return 0.0; }
    let m = mat4x4f(mc.u_coverMatrix0, mc.u_coverMatrix1, mc.u_coverMatrix2, mc.u_coverMatrix3);
    let c = m * vec4f(W, 1.0);
    let uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
    // This device's texture rows run the other way from the clip space the map was drawn in.
    let stored = dot(textureSampleLevel(u_rainCover, u_rainCover_s, vec2f(uv.x, 1.0 - uv.y), 0.0).rgb,
                     vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    let here = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
    return select(0.0, 1.0, stored < here - mc.u_shelterBias / (4.0 * mc.u_shelterRange));
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let sz = vec2f(vec2i(textureDimensions(t0, 0)));
    let aspect = sz.x / sz.y;
    let T = tc.u_time.x * mc.u_timeScale + mc.u_phase;
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    var dist = 1e9;
    if (d < 1.0) { dist = length(worldFromDepth(uvOfTexel(c, size), d) - entry); }

    var tint = mc.u_streakColor.rgb;
#ifdef ES_LINEAR
    tint = srgbToLinear(tint);
#endif
    var col = src.rgb;

    if (d < 1.0 && mc.u_wetness > 0.0) {
        let P = worldFromDepth(uvOfTexel(c, size), d);
        let dl = depthAt(c + vec2i(-1, 0), size);
        let dr = depthAt(c + vec2i( 1, 0), size);
        let dd = depthAt(c + vec2i(0, -1), size);
        let du = depthAt(c + vec2i(0,  1), size);
        var ax = P - worldAt(c + vec2i(-1, 0), size);
        if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
        var ay = P - worldAt(c + vec2i(0, -1), size);
        if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
        var N = normalize(cross(ax, ay));
        if (dot(N, viewDirection(P)) < 0.0) { N = -N; }
        let up = smoothstep(0.86, 0.95, N.y);
        let shelter = shelteredAt(P + vec3f(0.0, 1.0, 0.0));
        let wet = mc.u_wetness * (1.0 - 0.9 * shelter);
        let puddle = puddleMask(P.xz, basinCoverage(c, size, P, mc.u_puddles, mc.u_puddleScale), mc.u_puddleScale) * up * wet;
        col = col * (1.0 - 0.32 * wet * up);
        col = col * (1.0 - 0.35 * puddle);
        let falling = clamp(mc.u_intensity, 0.0, 1.0) * (1.0 - shelter);
        let near = 1.0 - smoothstep(1200.0, 3500.0, dist);
        let g = P.xz / mc.u_rippleScale;
        let id = floor(g);
        let f = fract(g) - 0.5;
        let h = hash21(id);
        let centre = (vec2f(hash21(id + 7.0), hash21(id + 13.0)) - 0.5) * 0.5;
        let phase = fract(T * 0.9 + h);
        var ring = (1.0 - smoothstep(0.0, 0.035, abs(length(f - centre) - phase * 0.5)))
                 * (1.0 - phase) * (1.0 - phase);
        if (hash21(id + 3.0) > mix(0.55, 0.9, puddle)) { ring = 0.0; }
        col = col + tint * ring * mix(0.4, 0.9, puddle) * mc.u_wetness * up * near * falling;
        let g2 = P.xz / (mc.u_rippleScale * 0.3);
        let id2 = floor(g2);
        let f2 = fract(g2) - 0.5;
        let ph2 = fract(T * 2.4 + hash21(id2 + 29.0));
        let c2 = (vec2f(hash21(id2 + 5.0), hash21(id2 + 11.0)) - 0.5) * 0.4;
        var splash = (1.0 - smoothstep(0.0, 0.06, abs(length(f2 - c2) - ph2 * 0.3)))
                   * (1.0 - ph2) * (1.0 - ph2) * (1.0 - ph2);
        if (hash21(id2 + 2.0) > 0.5) { splash = 0.0; }
        col = col + tint * splash * 0.55 * mc.u_wetness * up * near * falling * (1.0 - puddle);
    }

    var dd1 = d;
    if (d >= 1.0) { dd1 = 1.0; }
    let along = normalize(worldFromDepth(v.v_texCoord, dd1) - entry);
    var rain = 0.0;
    if (dist > 120.0)  { rain = rain + streaks(v.v_texCoord, aspect,  70.0, mc.u_speed * 1.0, 1.0, T) * 0.35 * (1.0 - shelteredAt(entry + along * 120.0)); }
    if (dist > 450.0)  { rain = rain + streaks(v.v_texCoord, aspect, 130.0, mc.u_speed * 1.4, 2.0, T) * 0.28 * (1.0 - shelteredAt(entry + along * 450.0)); }
    if (dist > 1400.0) { rain = rain + streaks(v.v_texCoord, aspect, 230.0, mc.u_speed * 1.9, 3.0, T) * 0.22 * (1.0 - shelteredAt(entry + along * 1400.0)); }
    col = col + tint * rain * mc.u_intensity;
    return vec4f(col, src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createDistanceFog(): ShaderHandle {
        // Fog is a DISTANCE and a depth sample is not one: the same 0.9 is a
        // metre away up close and a hundred out. `worldFromDepth` (injected with
        // FrameConstants) puts the sample back in the world, so one setting holds.

        // The cleared far plane is not a surface — it is the absence of one, and
        // fogging it to full would paint the sky the fog colour at any range.
        const source = `#pragma shader "PP Distance Fog"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_fogColor color default(0.6,0.68,0.78,1)
#pragma param u_fogNear float default(10) range(0,500)
#pragma param u_fogFar float default(60) range(0,500)
#pragma param u_intensity float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    float depth = texelFetch(u_sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
    if (depth >= 1.0) { fragColor = src; return; }

    // Un-projected twice, at the sample and at the near plane along the SAME ray.
    // An orthographic eye has no point to measure from, and this needs none: the
    // near plane is one, per pixel, and it is where fog should start anyway.
    vec3 world = worldFromDepth(v_texCoord, depth);
    vec3 entry = worldFromDepth(v_texCoord, 0.0);
    float dist = length(world - entry);
    float t = clamp((dist - u_fogNear) / max(u_fogFar - u_fogNear, 1e-4), 0.0, 1.0);
    // Authored as sRGB, like every colour: a linear frame takes it as light, not as a code.
    vec3 fog = u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    fragColor = vec4(mix(src.rgb, fog, t * u_intensity), src.a);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let depth = textureLoad(t7, vec2i(v.pos.xy), 0);
    if (depth >= 1.0) { return src; }

    let world = worldFromDepth(v.v_texCoord, depth);
    let entry = worldFromDepth(v.v_texCoord, 0.0);
    let dist = length(world - entry);
    let t = clamp((dist - mc.u_fogNear) / max(mc.u_fogFar - mc.u_fogNear, 1e-4), 0.0, 1.0);
    var fog = mc.u_fogColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
#endif
    return vec4f(mix(src.rgb, fog, vec3f(t * mc.u_intensity)), src.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    createPixelate(): ShaderHandle {
        // Snaps sampling to a grid of u_pixelSize-device-pixel blocks — the
        // canonical retro/mosaic 2D look. u_pixelSize <= 1 samples per-texel
        // (identity). Uses the injected u_viewport for block sizing.
        const source = `#pragma shader "PP Pixelate"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_pixelSize float default(4) range(1,64)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    vec2 blocks = u_viewport.xy / max(u_pixelSize, 1.0);
    vec2 uv = (floor(v_texCoord * blocks) + 0.5) / blocks;
    fragColor = texture(u_texture, uv);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let blocks = tc.u_viewport.xy / max(mc.u_pixelSize, 1.0);
    let uv = (floor(v.v_texCoord * blocks) + 0.5) / blocks;
    return textureSampleLevel(t0, s0, uv, 0.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * SSAO, pass 1 of 4: the occlusion term, at half resolution. No G-buffer —
     * scene depth and the injected `worldFromDepth` are the whole input, and
     * positions come back in WORLD space, so the radius is a world length.
     * Coordinates are the pass uv's texels, which run in each device's own row order.
     */
    createSsaoAo(): ShaderHandle {
        const source = `#pragma shader "PP SSAO"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_radius float default(60) range(1,400)
#pragma param u_intensity float default(1) range(0,2)
#pragma param u_bias float default(0.12) range(0,0.6)
#pragma param u_power float default(1.6) range(0.5,4)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int K = 12;
const float TAU = 6.28318530718;

void main() {
    // Depth is full resolution and this pass is not, so the texel comes from the
    // uv — gl_FragCoord here counts THIS pass's smaller grid.
    ivec2 size = textureSize(u_sceneDepth, 0);
    ivec2 c = screenTexel(v_texCoord, size);
    float d = depthAt(c, size);
    // The cleared far plane is the absence of a surface: nothing there is
    // occluded, and shading it would ring the sky in grey.
    if (d >= 1.0) { fragColor = vec4(1.0); return; }

    // The TEXEL CENTRE, not this pass's uv: at half resolution they differ by
    // half a depth texel, and the tangents below are one texel long. Mixing the
    // two conventions reconstructs noise instead of a normal.
    vec2 cuv = uvOfTexel(c, size);
    vec3 P = worldFromDepth(cuv, d);

    // The NEARER neighbour on each axis. Across a silhouette the far side is a
    // different surface, and a centred derivative would average the two into a
    // normal facing neither — the smeared ring a naive reconstruction leaves.
    float dl = depthAt(c + ivec2(-1, 0), size);
    float dr = depthAt(c + ivec2( 1, 0), size);
    float dd = depthAt(c + ivec2(0, -1), size);
    float du = depthAt(c + ivec2(0,  1), size);
    vec3 ax = abs(dr - d) < abs(dl - d) ? worldAt(c + ivec2(1, 0), size) - P
                                        : P - worldAt(c + ivec2(-1, 0), size);
    vec3 ay = abs(du - d) < abs(dd - d) ? worldAt(c + ivec2(0, 1), size) - P
                                        : P - worldAt(c + ivec2(0, -1), size);
    vec3 N = normalize(cross(ax, ay));
    // Which side each pick came from decides the sign of the cross; the camera
    // settles it, because a visible surface faces the eye.
    if (dot(N, viewDirection(P)) < 0.0) N = -N;

    // A world radius spans different pixel counts near and far. One texel step
    // un-projected AT THIS DEPTH measures that scale without a projection matrix
    // or a neighbour's geometry. The ceiling is the bandwidth budget.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(size.x), 0.0), d) - P), 1e-6);
    float radiusTexels = clamp(u_radius / worldPerTexel, 2.0, 96.0);

    // A 4x4 rotation scrambled by a factor coprime to 16, so the blur averages a
    // pattern and not a band. Keyed to THIS pass's pixel — c counts full-res
    // texels, and raw it would give a half-res pass every other phase.
    ivec2 rp = c / 2;
    int idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    float rot = float(idx - (idx / 16) * 16) * (TAU / 16.0);

    // Every sample votes equally: the result is the fraction of the
    // neighbourhood closed off. Weighting near taps louder is the tempting
    // mistake — they land back on this surface and would vote OPEN loudest.
    float occl = 0.0;
    for (int i = 0; i < K; ++i) {
        float a = (float(i) + 0.5) / float(K);
        float ang = a * 7.0 * TAU + rot;
        vec2 off = vec2(cos(ang), sin(ang)) * (a * radiusTexels);
        ivec2 st = c + ivec2(floor(off + 0.5));
        float ds = depthAt(st, size);
        // Sky: nothing in that direction, so it votes OPEN by contributing
        // nothing. This is what lightens the top of a wall toward its edge.
        if (ds >= 1.0) continue;

        // Measured in radii, so the estimator keeps its shape when the radius
        // changes and u_bias keeps one meaning.
        vec3 u = (worldAt(st, size) - P) / max(u_radius, 1e-4);
        float uu = dot(u, u);
        // Elevation above the tangent plane, less the bias that stops a flat
        // surface from occluding itself into grey.
        float sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        // Beyond the radius a sample is a different surface, not an occluder:
        // this is what stops a silhouette haloing what is behind it. Faded, not
        // cut, or the term pops as geometry crosses the edge under camera motion.
        float range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl += max(sinE - u_bias, 0.0) * range;
    }

    float ao = 1.0 - clamp(occl / float(K) * u_intensity, 0.0, 1.0);
    fragColor = vec4(vec3(pow(ao, u_power)), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const K : i32 = 12;
const TAU : f32 = 6.28318530718;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(t7, 0));
    let c = screenTexel(v.v_texCoord, size);
    let d = depthAt(c, size);
    if (d >= 1.0) { return vec4f(1.0); }

    let cuv = uvOfTexel(c, size);
    let P = worldFromDepth(cuv, d);

    let dl = depthAt(c + vec2i(-1, 0), size);
    let dr = depthAt(c + vec2i( 1, 0), size);
    let dd = depthAt(c + vec2i(0, -1), size);
    let du = depthAt(c + vec2i(0,  1), size);
    var ax = P - worldAt(c + vec2i(-1, 0), size);
    if (abs(dr - d) < abs(dl - d)) { ax = worldAt(c + vec2i(1, 0), size) - P; }
    var ay = P - worldAt(c + vec2i(0, -1), size);
    if (abs(du - d) < abs(dd - d)) { ay = worldAt(c + vec2i(0, 1), size) - P; }
    var N = normalize(cross(ax, ay));
    if (dot(N, viewDirection(P)) < 0.0) { N = -N; }

    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(size.x), 0.0), d) - P), 1e-6);
    let radiusTexels = clamp(mc.u_radius / worldPerTexel, 2.0, 96.0);

    let rp = c / 2;
    let idx = ((rp.x & 3) * 4 + (rp.y & 3)) * 7;
    let rot = f32(idx - (idx / 16) * 16) * (TAU / 16.0);

    var occl = 0.0;
    for (var i : i32 = 0; i < K; i = i + 1) {
        let a = (f32(i) + 0.5) / f32(K);
        let ang = a * 7.0 * TAU + rot;
        let off = vec2f(cos(ang), sin(ang)) * (a * radiusTexels);
        let st = c + vec2i(floor(off + 0.5));
        let ds = depthAt(st, size);
        if (ds >= 1.0) { continue; }

        let u = (worldAt(st, size) - P) / max(mc.u_radius, 1e-4);
        let uu = dot(u, u);
        let sinE = dot(u, N) / max(sqrt(uu), 1e-6);
        let range = 1.0 - smoothstep(0.6, 1.0, uu);
        occl = occl + max(sinE - mc.u_bias, 0.0) * range;
    }

    let ao = 1.0 - clamp(occl / f32(K) * mc.u_intensity, 0.0, 1.0);
    return vec4f(vec3f(pow(ao, mc.u_power)), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * SSAO, passes 2 and 3: a separable blur that will not cross a depth edge,
     * or a contact shadow ends up on the wall behind. Each tap is weighted by
     * its gap ALONG THE VIEW RAY in world units against the pixel's own scale,
     * so one constant holds near and far where a raw depth compare would not.
     */
    createSsaoBlur(axis: 0 | 1): ShaderHandle {
        const step = axis === 0 ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)';
        const stepW = axis === 0 ? 'vec2f(1.0, 0.0)' : 'vec2f(0.0, 1.0)';
        const source = `#pragma shader "PP SSAO Blur ${axis.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const int R = 3;
/// A tap whose view-ray gap exceeds this many texel-widths is another surface.
const float SLOPE = 4.0;

void main() {
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 hsize = textureSize(u_texture, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = texture(u_texture, v_texCoord); return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    // The pixel's own world scale, from one texel step at ITS depth — the same
    // measure the AO pass sizes its radius with.
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    vec2 stepUv = ${step} / vec2(hsize);
    float sum = 0.0;
    float wsum = 0.0;
    for (int i = -R; i <= R; ++i) {
        vec2 uv = v_texCoord + stepUv * float(i);
        float g = exp(-float(i * i) / 8.0);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        // Off the far plane there is no surface to agree with; the Gaussian
        // alone would let the sky pull the edge of a silhouette toward white.
        float w = dj >= 1.0 ? 0.0
                            : g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // Every neighbour rejected (a one-pixel sliver): keep this pixel's own value
    // rather than dividing by nothing.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(vec3(ao), 1.0);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const R : i32 = 3;
const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let dsize = vec2i(textureDimensions(t7, 0));
    let hsize = vec2i(textureDimensions(t0, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return textureSampleLevel(t0, s0, v.v_texCoord, 0.0); }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let stepUv = ${stepW} / vec2f(hsize);
    var sum = 0.0;
    var wsum = 0.0;
    for (var i : i32 = -R; i <= R; i = i + 1) {
        let uv = v.v_texCoord + stepUv * f32(i);
        let g = exp(-f32(i * i) / 8.0);

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = g * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(vec3f(ao), 1.0);
}
#pragma end
`;
        return Material.compileShader(source);
    },

    /**
     * SSAO, pass 4 of 4: upsample the half-resolution term and apply it. Plain
     * bilinear would undo the blur's care — a half-res texel straddling a
     * silhouette bleeds back across it — so the four candidates carry the same
     * view-ray gap weight. The scene arrives at unit 1, as bloom's composite.
     */
    createSsaoComposite(): ShaderHandle {
        const source = `#pragma shader "PP SSAO Composite"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

const float SLOPE = 4.0;

void main() {
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 dc = screenTexel(v_texCoord, dsize);
    float d = depthAt(dc, dsize);
    if (d >= 1.0) { fragColor = scene; return; }

    vec2 cuv = uvOfTexel(dc, dsize);
    vec3 P = worldFromDepth(cuv, d);
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    float tol = worldPerTexel * SLOPE;
    float perDepth = worldPerDepth(cuv, d, P);

    // The four half-resolution texels this pixel falls between, in SCREEN texel
    // space so the bilinear weights mean the same on both backends.
    ivec2 hsize = textureSize(u_texture, 0);
    vec2 hf = v_texCoord * vec2(hsize) - 0.5;
    ivec2 base = ivec2(floor(hf));
    vec2 frac = hf - vec2(base);

    float sum = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < 4; ++j) {
        ivec2 o = ivec2(j & 1, j >> 1);
        ivec2 t = clamp(base + o, ivec2(0), hsize - ivec2(1));
        vec2 uv = uvOfTexel(t, hsize);
        float bw = (o.x == 1 ? frac.x : 1.0 - frac.x) * (o.y == 1 ? frac.y : 1.0 - frac.y);

        ivec2 dt = screenTexel(uv, dsize);
        float dj = depthAt(dt, dsize);
        float w = dj >= 1.0 ? 0.0
                            : bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        sum += texture(u_texture, uv).r * w;
        wsum += w;
    }
    // No candidate agreed: this pixel is its own sliver, so take the term
    // straight rather than leaving it unshaded.
    float ao = wsum > 1e-5 ? sum / wsum : texture(u_texture, v_texCoord).r;
    fragColor = vec4(scene.rgb * ao, scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}

const SLOPE : f32 = 4.0;

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let dsize = vec2i(textureDimensions(t7, 0));
    let dc = screenTexel(v.v_texCoord, dsize);
    let d = depthAt(dc, dsize);
    if (d >= 1.0) { return scene; }

    let cuv = uvOfTexel(dc, dsize);
    let P = worldFromDepth(cuv, d);
    let worldPerTexel = max(length(worldFromDepth(cuv + vec2f(1.0 / f32(dsize.x), 0.0), d) - P), 1e-6);
    let tol = worldPerTexel * SLOPE;
    let perDepth = worldPerDepth(cuv, d, P);

    let hsize = vec2i(textureDimensions(t0, 0));
    let hf = v.v_texCoord * vec2f(hsize) - 0.5;
    let base = vec2i(floor(hf));
    let frac = hf - vec2f(base);

    var sum = 0.0;
    var wsum = 0.0;
    for (var j : i32 = 0; j < 4; j = j + 1) {
        let o = vec2i(j & 1, j >> 1);
        let t = clamp(base + o, vec2i(0), hsize - vec2i(1));
        let uv = uvOfTexel(t, hsize);
        var bwx = 1.0 - frac.x;
        if (o.x == 1) { bwx = frac.x; }
        var bwy = 1.0 - frac.y;
        if (o.y == 1) { bwy = frac.y; }
        let bw = bwx * bwy;

        let dt = screenTexel(uv, dsize);
        let dj = depthAt(dt, dsize);
        var w = 0.0;
        if (dj < 1.0) {
            w = bw * (1.0 - clamp(abs(dj - d) * perDepth / tol, 0.0, 1.0));
        }
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).r * w;
        wsum = wsum + w;
    }
    var ao = textureSampleLevel(t0, s0, v.v_texCoord, 0.0).r;
    if (wsum > 1e-5) { ao = sum / wsum; }
    return vec4f(scene.rgb * ao, scene.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};
