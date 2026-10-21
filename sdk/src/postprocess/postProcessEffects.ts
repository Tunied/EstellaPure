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
     * camera moves past and wrong for an object that moved by itself — there the history
     * is a different surface, so it is clipped into the colours the neighbourhood holds,
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
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_prevViewProjection0 color default(1,0,0,0)
#pragma param u_prevViewProjection1 color default(0,1,0,0)
#pragma param u_prevViewProjection2 color default(0,0,1,0)
#pragma param u_prevViewProjection3 color default(0,0,0,1)
#pragma param u_history texture default(black)

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
    bool seen = u_historyValid > 0.5 && prev.w > 1e-6
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
    let puv = vec2f(prev.x / pw * 0.5 + 0.5, 0.5 - prev.y / pw * 0.5);
    let seen = mc.u_historyValid > 0.5 && prev.w > 1e-6
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
#pragma param u_floorBias float default(1) range(0,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}
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

    // Fresnel at this angle, Schlick with the dielectric 4% a surface without a metal in
    // it reflects face-on; and the floor mask that keeps walls from shining.
    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    float up = mix(1.0, smoothstep(0.55, 0.9, N.y), u_floorBias);
    float weight = fresnel * up * u_intensity;
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
            float blur = (length(b - P) / max(u_maxDistance, 1.0)) * 6.0;
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
    fragColor = vec4(mix(scene.rgb, hitColor, clamp(weight * hit, 0.0, 1.0)), scene.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
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

    let cosT = clamp(dot(N, V), 0.0, 1.0);
    let fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    let up = mix(1.0, smoothstep(0.55, 0.9, N.y), mc.u_floorBias);
    let weight = fresnel * up * mc.u_intensity;
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
            let blur = (travelled / max(mc.u_maxDistance, 1.0)) * 6.0;
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
    return vec4f(mix(scene.rgb, hitColor, clamp(weight * hit, 0.0, 1.0)), scene.a);
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

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const float FAR_RAY = 100000.0;

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

    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    float glow = pow(max(dot(dir, sun), 0.0), u_sunExponent);
    vec3 fog = u_fogColor.rgb;
    vec3 sunTint = u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    vec3 colour = mix(fog, sunTint, clamp(glow * u_inscatter, 0.0, 1.0));
    fragColor = vec4(mix(src.rgb, colour, clamp(amount, 0.0, 1.0)), src.a);
}
#pragma end

#pragma fragment wgsl
const FAR_RAY : f32 = 100000.0;

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

    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    let sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    let glow = pow(max(dot(dir, sun), 0.0), mc.u_sunExponent);
    var fog = mc.u_fogColor.rgb;
    var sunTint = mc.u_sunColor.rgb;
#ifdef ES_LINEAR
    fog = srgbToLinear(fog);
    sunTint = srgbToLinear(sunTint);
#endif
    let colour = mix(fog, sunTint, clamp(glow * mc.u_inscatter, 0.0, 1.0));
    return vec4f(mix(src.rgb, colour, clamp(amount, 0.0, 1.0)), src.a);
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
    float az = radians(u_sunAzimuth);
    float el = radians(u_sunElevation);
    vec3 sun = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
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
    let az = radians(mc.u_sunAzimuth);
    let el = radians(mc.u_sunElevation);
    let sun = vec3f(cos(el) * sin(az), sin(el), cos(el) * cos(az));
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
#pragma param u_historyValid float default(0) range(0,1)
#pragma param u_feedback texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    float sum = 0.0;
    float weight = 0.0;
    for (int j = 0; j < 8; ++j) {
        for (int i = 0; i < 8; ++i) {
            vec2 m = texture(u_texture, (vec2(float(i), float(j)) + 0.5) / 8.0).rg;
            sum += m.r * m.g;
            weight += m.g;
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
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var sum = 0.0;
    var weight = 0.0;
    for (var j : i32 = 0; j < 8; j = j + 1) {
        for (var i : i32 = 0; i < 8; i = i + 1) {
            let m = textureSampleLevel(t0, s0, (vec2f(f32(i), f32(j)) + 0.5) / 8.0, 0.0).rg;
            sum = sum + m.r * m.g;
            weight = weight + m.g;
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
     * Depth of field. Each pixel's circle of confusion comes from how far its surface is from the
     * focus distance, and a pixel outside focus is blurred by gathering its neighbours over that
     * circle. A neighbour counts only to the extent its OWN circle reaches this pixel: a sharp
     * object in front of a blurred background does not bleed into it, and a blurred foreground
     * does spread over what is behind. The sky counts as infinitely far.
     */
    createDepthOfField(): ShaderHandle {
        const GLSL = `
const int TAPS = 32;
float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
/// The blur radius in pixels at a uv: how far the surface is from the focus, past the slab
/// that stays sharp, as a share of its distance — the thin-lens ratio, capped.
float cocAt(vec2 uv, float depth, vec3 eye) {
    if (depth >= 1.0) return min(u_aperture, u_maxBlur);
    float dist = length(worldFromDepth(uv, depth) - eye);
    return min(u_aperture * max(abs(dist - u_focusDistance) - u_focusRange, 0.0) / max(dist, 1e-3), u_maxBlur);
}`;
        const WGSL = `
const TAPS : i32 = 32;
fn ign(p : vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}
fn cocAt(uv : vec2f, depth : f32, eye : vec3f) -> f32 {
    if (depth >= 1.0) { return min(mc.u_aperture, mc.u_maxBlur); }
    let dist = length(worldFromDepth(uv, depth) - eye);
    return min(mc.u_aperture * max(abs(dist - mc.u_focusDistance) - mc.u_focusRange, 0.0) / max(dist, 1e-3), mc.u_maxBlur);
}`;
        const source = `#pragma shader "PP Depth of Field"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_focusDistance float default(600) range(1,5000)
#pragma param u_focusRange float default(100) range(0,2000)
#pragma param u_aperture float default(24) range(0,64)
#pragma param u_maxBlur float default(14) range(1,32)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}
${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    vec3 eye = u_camera.w > 0.5 ? u_camera.xyz : worldFromDepth(v_texCoord, 0.0);
    float coc = cocAt(v_texCoord, depthAt(screenTexel(v_texCoord, size), size), eye);
    if (coc < 0.5) { fragColor = src; return; }

    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    vec3 sum = src.rgb;
    float wsum = 1.0;
    for (int i = 0; i < TAPS; ++i) {
        float r = coc * sqrt((float(i) + 0.5) / float(TAPS));
        float a = float(i) * 2.39996323 + rot;
        vec2 uv = v_texCoord + vec2(cos(a), sin(a)) * r * texel;
        float tapCoc = cocAt(uv, depthAt(screenTexel(uv, size), size), eye);
        // Gathered only to the extent that tap's own blur reaches back here.
        float w = clamp(tapCoc / max(r, 0.5), 0.0, 1.0);
        sum += texture(u_texture, uv).rgb * w;
        wsum += w;
    }
    fragColor = vec4(sum / wsum, src.a);
}
#pragma end

#pragma fragment wgsl
${SSAO_WGSL}
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let size = vec2i(textureDimensions(t7, 0));
    var eye = worldFromDepth(v.v_texCoord, 0.0);
    if (frame.camera.w > 0.5) { eye = frame.camera.xyz; }
    let coc = cocAt(v.v_texCoord, depthAt(screenTexel(v.v_texCoord, size), size), eye);
    if (coc < 0.5) { return src; }

    let texel = 1.0 / vec2f(vec2i(textureDimensions(t0, 0)));
    let rot = ign(v.pos.xy) * 6.2831853;
    var sum = src.rgb;
    var wsum = 1.0;
    for (var i : i32 = 0; i < TAPS; i = i + 1) {
        let r = coc * sqrt((f32(i) + 0.5) / f32(TAPS));
        let a = f32(i) * 2.39996323 + rot;
        let uv = v.v_texCoord + vec2f(cos(a), sin(a)) * r * texel;
        let tapCoc = cocAt(uv, depthAt(screenTexel(uv, size), size), eye);
        let w = clamp(tapCoc / max(r, 0.5), 0.0, 1.0);
        sum = sum + textureSampleLevel(t0, s0, uv, 0.0).rgb * w;
        wsum = wsum + w;
    }
    return vec4f(sum / wsum, src.a);
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
