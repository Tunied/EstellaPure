// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./GpuParticles.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../particle/ParticleSystem.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace esengine {

namespace {

// One record per live particle, exactly what the particle draw's instance attributes read (44 bytes).
constexpr u32 kInstanceBytes = 44;
// Position + age, velocity + lifetime, then start size, end size, rotation, angular velocity.
constexpr u32 kStateBytes = 48;

constexpr u32 kMaxFields = 8;
constexpr u32 kLutSize = particle::kColorLutSize;
static_assert(kLutSize == 32, "the kernel's LUT arrays are sized for 32 entries");

enum Flags : u32 {
    kReset = 1u << 0,
    kLocal = 1u << 1,
    kNoise = 1u << 2,
    kSizeLut = 1u << 3,
    kColorLut = 1u << 4,
    kSpeedLut = 1u << 5,
    kFloor = 1u << 6,
};

// Mirrors the kernel's `Params`: vec4s only, so the layout is the same in both languages with no padding to get wrong.
struct ParamsBlock {
    u32 p0[4];      // capacity, firstIndex, spawnCount, smoothCount
    u32 p1[4];      // seed, flags, shape, octaves
    f32 p2[4];      // dt, noiseTime, lifetimeMin, lifetimeMax
    f32 p3[4];      // speedMin, speedMax, startSizeMin, startSizeMax
    f32 p4[4];      // endSizeMin, endSizeMax, rotationMin, rotationMax
    f32 p5[4];      // angularVelocityMin, angularVelocityMax, gravity.x, gravity.y
    f32 p6[4];      // gravity.z, damping, noiseStrength, noiseFrequency
    f32 p7[4];      // noiseScroll.x, noiseScroll.y, shapeRadius, shapeHalfAngle
    f32 p8[4];      // shapeSize.xyz, sizeEasing
    f32 p9[4];      // aimMin, aimMax (radians), colorEasing, floorY
    f32 p10[4];     // bounce, friction, lifetimeLoss, spriteFPS
    u32 p11[4];     // spriteColumns, spriteRows, spriteLoop, fieldCount
    f32 startColor[4];
    f32 endColor[4];
    f32 origin[4];  // emitter position
    f32 scale[4];   // emitter scale
    f32 rot0[4], rot1[4], rot2[4];  // emitter rotation, one column each
    f32 local[4];   // cos, sin of the emitter's turn about Z; scale.x, scale.y
    f32 fields[kMaxFields * 3][4];
    f32 colorLut[kLutSize][4];
    f32 sizeLut[kLutSize / 4][4];
    f32 speedLut[kLutSize / 4][4];
};
static_assert(sizeof(ParamsBlock) == 92 * 16, "the kernel's Params is 92 vec4s");
constexpr u32 kJobStride = 2048;  // a uniform binding starts on a multiple of 256
static_assert(sizeof(ParamsBlock) <= kJobStride && kJobStride % 256 == 0);
constexpr u32 kMaxJobs = 64;

const char* const kKernel = R"WGSL(
struct State { pa: vec4<f32>, vl: vec4<f32>, ms: vec4<f32> };
struct Inst { px: f32, py: f32, pz: f32, sx: f32, sy: f32, rot: f32, color: u32, u0: f32, v0: f32, us: f32, vs: f32 };
struct Params {
    p0: vec4<u32>, p1: vec4<u32>,
    p2: vec4<f32>, p3: vec4<f32>, p4: vec4<f32>, p5: vec4<f32>, p6: vec4<f32>, p7: vec4<f32>,
    p8: vec4<f32>, p9: vec4<f32>, p10: vec4<f32>,
    p11: vec4<u32>,
    startColor: vec4<f32>, endColor: vec4<f32>,
    origin: vec4<f32>, scale: vec4<f32>,
    rot0: vec4<f32>, rot1: vec4<f32>, rot2: vec4<f32>,
    local: vec4<f32>,
    fields: array<vec4<f32>, 24>,
    colorLut: array<vec4<f32>, 32>,
    sizeLut: array<vec4<f32>, 8>,
    speedLut: array<vec4<f32>, 8>,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> states: array<State>;
@group(0) @binding(2) var<storage, read_write> insts: array<Inst>;

var<private> rng: u32;

fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn rand() -> f32 {
    rng = pcg(rng);
    return f32(rng) * 2.3283064365386963e-10;
}
fn rr(a: f32, b: f32) -> f32 {
    if (a >= b) { return a; }
    return a + (b - a) * rand();
}

// --- the shapes: where a particle is born and which way it leaves (ParticleShapes.hpp) ---
fn coneDir(halfAngle: f32) -> vec3<f32> {
    let cosT = rr(cos(halfAngle), 1.0);
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let phi = rr(0.0, 6.283185307179586);
    return vec3<f32>(sinT * cos(phi), cosT, sinT * sin(phi));
}
fn planarAim() -> vec3<f32> {
    let a = rr(P.p9.x, P.p9.y);
    return vec3<f32>(cos(a), sin(a), 0.0);
}

// --- curl noise (ParticleNoise.hpp): the same field the CPU sim advects along ---
fn hash2(x: i32, y: i32) -> f32 {
    var h = u32(x) * 374761393u + u32(y) * 668265263u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    return f32(h) * (1.0 / 4294967295.0);
}
fn grad2(x: i32, y: i32) -> vec2<f32> {
    let a = hash2(x, y) * 6.283185307179586;
    return vec2<f32>(cos(a), sin(a));
}
fn fade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn perlin2(p: vec2<f32>) -> f32 {
    let pi = floor(p);
    let pf = p - pi;
    let x0 = i32(pi.x);
    let y0 = i32(pi.y);
    let n00 = dot(grad2(x0, y0), pf - vec2<f32>(0.0, 0.0));
    let n10 = dot(grad2(x0 + 1, y0), pf - vec2<f32>(1.0, 0.0));
    let n01 = dot(grad2(x0, y0 + 1), pf - vec2<f32>(0.0, 1.0));
    let n11 = dot(grad2(x0 + 1, y0 + 1), pf - vec2<f32>(1.0, 1.0));
    let ux = fade(pf.x);
    let uy = fade(pf.y);
    return mix(mix(n00, n10, ux), mix(n01, n11, ux), uy);
}
fn fbm2(p: vec2<f32>, octaves: u32) -> f32 {
    var sum = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var norm = 0.0;
    let n = clamp(octaves, 1u, 8u);
    for (var i = 0u; i < n; i = i + 1u) {
        sum = sum + amp * perlin2(p * freq);
        norm = norm + amp;
        freq = freq * 2.0;
        amp = amp * 0.5;
    }
    if (norm > 0.0) { return sum / norm; }
    return 0.0;
}
fn curl(p: vec2<f32>, octaves: u32) -> vec2<f32> {
    let e = 0.1;
    let dpdx = fbm2(p + vec2<f32>(e, 0.0), octaves) - fbm2(p - vec2<f32>(e, 0.0), octaves);
    let dpdy = fbm2(p + vec2<f32>(0.0, e), octaves) - fbm2(p - vec2<f32>(0.0, e), octaves);
    return vec2<f32>(dpdy, -dpdx) * (0.25 / (2.0 * e));
}

fn ease(kind: f32, t: f32) -> f32 {
    if (kind > 2.5) { return select(-1.0 + (4.0 - 2.0 * t) * t, 2.0 * t * t, t < 0.5); }
    if (kind > 1.5) { return t * (2.0 - t); }
    if (kind > 0.5) { return t * t; }
    return t;
}

fn lutF(which: u32, t: f32) -> f32 {
    let f = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(f);
    let j = min(i + 1u, 31u);
    var a: f32;
    var b: f32;
    if (which == 0u) {
        a = P.sizeLut[i >> 2u][i & 3u];
        b = P.sizeLut[j >> 2u][j & 3u];
    } else {
        a = P.speedLut[i >> 2u][i & 3u];
        b = P.speedLut[j >> 2u][j & 3u];
    }
    return mix(a, b, f - f32(i));
}
fn lutC(t: f32) -> vec4<f32> {
    let f = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(f);
    let j = min(i + 1u, 31u);
    return mix(P.colorLut[i], P.colorLut[j], f - f32(i));
}

// A scene force field folded into a world-space particle's velocity (ParticleSystem.cpp applyForceField).
fn applyField(k: u32, pos: vec3<f32>, vel: vec3<f32>, dt: f32) -> vec3<f32> {
    let a = P.fields[k * 3u];
    let b = P.fields[k * 3u + 1u];
    let c = P.fields[k * 3u + 2u];
    let toField = a.xyz - pos;
    let distSq = dot(toField, toField);
    var factor = 1.0;
    if (c.x > 0.0) {
        if (distSq > c.x * c.x) { return vel; }
        if (c.y > 0.5) { factor = 1.0 - sqrt(distSq) / c.x; }
    }
    let strength = b.w;
    var v = vel;
    let kind = u32(a.w + 0.5);
    if (kind == 0u) {
        v = v + b.xyz * (strength * factor * dt);
    } else if (kind == 1u) {
        let d = sqrt(distSq);
        if (d > 1e-4) { v = v + (toField / d) * (strength * factor * dt); }
    } else if (kind == 2u) {
        let d = sqrt(distSq);
        if (d > 1e-4) {
            let radial = -toField / d;
            var axis = vec3<f32>(0.0, 0.0, 1.0);
            if (length(b.xyz) > 1e-6) { axis = normalize(b.xyz); }
            let perp = cross(axis, radial);
            let pl = length(perp);
            if (pl > 1e-6) { v = v + (perp / pl) * (strength * factor * dt); }
        }
    } else {
        v = v * (1.0 - min(strength * factor * dt, 1.0));
    }
    return v;
}

fn hide(i: u32) {
    insts[i] = Inst(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0.0, 0.0, 1.0, 1.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let cap = P.p0.x;
    let i = gid.x;
    if (i >= cap) { return; }
    let flags = P.p1.y;
    if ((flags & 1u) != 0u) {
        states[i] = State(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
        hide(i);
        return;
    }
    let local = (flags & 2u) != 0u;
    let R = mat3x3<f32>(P.rot0.xyz, P.rot1.xyz, P.rot2.xyz);
    let dt = P.p2.x;

    var st = states[i];
    var stepDt = dt;

    // Born this step? Slot i holds the particle whose absolute index lands on it.
    let first = P.p0.y % cap;
    let rel = (i + cap - first) % cap;
    if (rel < P.p0.z) {
        rng = pcg(P.p1.x ^ ((P.p0.y + rel) * 2654435761u));
        let life = rr(P.p2.z, P.p2.w);
        let startSize = rr(P.p3.z, P.p3.w);
        let endSize = rr(P.p4.x, P.p4.y);
        let rot = rr(P.p4.z, P.p4.w);
        let angVel = rr(P.p5.x, P.p5.y);

        var pos = vec3<f32>(0.0);
        var dir = vec3<f32>(0.0, 1.0, 0.0);
        let shape = P.p1.z;
        if (shape == 1u) {
            let angle = rr(0.0, 6.283185307179586);
            let radius = rr(0.0, P.p7.z);
            pos = vec3<f32>(cos(angle) * radius, sin(angle) * radius, 0.0);
            if (radius > 0.001) { dir = pos / radius; } else { dir = planarAim(); }
        } else if (shape == 2u) {
            let h = P.p8.xyz * 0.5;
            let x = rr(-h.x, h.x);
            let y = rr(-h.y, h.y);
            var z = 0.0;
            if (P.p8.z > 0.0) { z = rr(-h.z, h.z); }
            pos = vec3<f32>(x, y, z);
            dir = planarAim();
        } else if (shape == 3u) {
            dir = coneDir(P.p7.w);
            pos = coneDir(P.p7.w) * rr(0.0, P.p7.z);
        } else if (shape == 4u || shape == 5u) {
            var cap2 = 3.141592653589793;
            if (shape == 5u) { cap2 = 1.5707963267948966; }
            dir = coneDir(cap2);
            pos = coneDir(cap2) * (P.p7.z * pow(rr(0.0, 1.0), 1.0 / 3.0));
        } else {
            dir = planarAim();
        }
        let speed = rr(P.p3.x, P.p3.y);
        var wpos: vec3<f32>;
        var wdir: vec3<f32>;
        if (local) {
            wpos = pos * P.scale.xyz;
            wdir = dir;
        } else {
            wpos = P.origin.xyz + R * (pos * P.scale.xyz);
            wdir = R * dir;
        }
        st = State(vec4<f32>(wpos, 0.0), vec4<f32>(wdir * speed, max(life, 1e-4)), vec4<f32>(startSize, endSize, rot, angVel));
        // Rate-born particles are spread across the step they were born in, so a fast emitter draws a line, not a row of clumps.
        if (rel < P.p0.w) { stepDt = dt * (1.0 - (f32(rel) + 0.5) / f32(P.p0.w)); }
    } else if (st.pa.w >= st.vl.w) {
        hide(i);
        return;
    }

    let life = st.vl.w;
    var age = st.pa.w + stepDt;
    if (age >= life) {
        st.pa.w = life;
        states[i] = st;
        hide(i);
        return;
    }
    var pos = st.pa.xyz;
    var vel = st.vl.xyz;
    let t = age / life;

    vel = vel + vec3<f32>(P.p5.z, P.p5.w, P.p6.x) * stepDt;
    if (!local) {
        for (var k = 0u; k < P.p11.w; k = k + 1u) { vel = applyField(k, pos, vel, stepDt); }
    }
    if (P.p6.y > 0.0) { vel = vel * max(0.0, 1.0 - P.p6.y * stepDt); }
    var speedMul = 1.0;
    if ((flags & 32u) != 0u) { speedMul = lutF(1u, t); }
    pos = pos + vel * speedMul * stepDt;

    if ((flags & 4u) != 0u) {
        let flow = curl(pos.xy * P.p6.w + P.p7.xy, P.p1.w);
        pos = pos + vec3<f32>(flow, 0.0) * P.p6.z * stepDt;
    }

    if ((flags & 64u) != 0u) {
        var point = pos;
        var velW = vel;
        if (local) { point = P.origin.xyz + R * pos; velW = R * vel; }
        if (point.y < P.p9.w && velW.y < 0.0) {
            let approach = velW.y;
            let fr = clamp(P.p10.y, 0.0, 1.0);
            let bounce = clamp(P.p10.x, 0.0, 1.0);
            velW = vec3<f32>(velW.x, 0.0, velW.z) * (1.0 - fr) - vec3<f32>(0.0, approach * bounce, 0.0);
            point = vec3<f32>(point.x, P.p9.w, point.z);
            if (local) {
                pos = transpose(R) * (point - P.origin.xyz);
                vel = transpose(R) * velW;
            } else {
                pos = point;
                vel = velW;
            }
            age = age + clamp(P.p10.z, 0.0, 1.0) * life;
            if (age >= life) {
                st.pa.w = life;
                states[i] = st;
                hide(i);
                return;
            }
        }
    }

    let rotation = st.ms.z + st.ms.w * stepDt;
    st = State(vec4<f32>(pos, age), vec4<f32>(vel, life), vec4<f32>(st.ms.x, st.ms.y, rotation, st.ms.w));
    states[i] = st;

    var size = mix(st.ms.x, st.ms.y, ease(P.p8.w, t));
    if ((flags & 8u) != 0u) { size = st.ms.x * lutF(0u, t); }
    var color = mix(P.startColor, P.endColor, ease(P.p9.z, t));
    if ((flags & 16u) != 0u) { color = lutC(t); }

    var u0 = 0.0;
    var v0 = 0.0;
    var us = 1.0;
    var vs = 1.0;
    let cols = max(P.p11.x, 1u);
    let rows = max(P.p11.y, 1u);
    let total = f32(cols * rows);
    if (total > 1.0) {
        us = 1.0 / f32(cols);
        vs = 1.0 / f32(rows);
        if (P.p10.w > 0.0) {
            let raw = age * P.p10.w;
            var frameF = min(raw, total - 1.0);
            if (P.p11.z != 0u) { frameF = raw - total * floor(raw / total); }
            let fi = u32(frameF);
            u0 = f32(fi % cols) * us;
            v0 = f32(fi / cols) * vs;
        }
    }

    var worldPos = pos;
    var worldSize = vec2<f32>(size);
    if (local) {
        let rel3 = pos * vec3<f32>(P.local.z, P.local.w, 1.0);
        worldPos = P.origin.xyz + vec3<f32>(rel3.x * P.local.x - rel3.y * P.local.y, rel3.x * P.local.y + rel3.y * P.local.x, rel3.z);
        worldSize = worldSize * vec2<f32>(P.local.z, P.local.w);
    }
    insts[i] = Inst(worldPos.x, worldPos.y, worldPos.z, worldSize.x, worldSize.y, rotation, pack4x8unorm(color), u0, v0, us, vs);
}
)WGSL";

void set4(f32 (&dst)[4], f32 a, f32 b, f32 c, f32 d) { dst[0] = a; dst[1] = b; dst[2] = c; dst[3] = d; }
void set4(u32 (&dst)[4], u32 a, u32 b, u32 c, u32 d) { dst[0] = a; dst[1] = b; dst[2] = c; dst[3] = d; }

// A finite, non-negative range: a bad value reaching a kernel is a hung or poisoned buffer, and nothing reads it back.
f32 finite(f32 v, f32 fallback = 0.0f) { return std::isfinite(v) ? v : fallback; }

}  // namespace

struct GpuParticles::Job {
    Entity entity;
    ParamsBlock block;
    Slot* slot;
    particle::ParticleSystem* system;
    particle::GpuStep step;
};

GpuParticles::GpuParticles(GfxDevice& device) : device_(device) {}

GpuParticles::~GpuParticles() {
    release();
}

bool GpuParticles::available() const {
    return !failed_ && device_.supportsCompute();
}

void GpuParticles::freeSlot(Slot& slot) {
    if (slot.state != BufferHandle::Invalid) device_.deleteBuffer(slot.state);
    if (slot.instances != BufferHandle::Invalid) device_.deleteBuffer(slot.instances);
    slot = {};
}

void GpuParticles::release() {
    for (auto& [id, slot] : slots_) freeSlot(slot);
    slots_.clear();
    jobs_.clear();
    if (params_ != BufferHandle::Invalid) device_.deleteBuffer(params_);
    params_ = BufferHandle::Invalid;
    paramsCapacity_ = 0;
    if (kernel_ != ComputeHandle::Invalid) device_.deleteCompute(kernel_);
    kernel_ = ComputeHandle::Invalid;
    failed_ = false;
}

void GpuParticles::beginFrame() {
    ++frame_;
    jobs_.clear();
    lastDispatches_ = 0;
    drawn_ = 0;
    // Given back after a few seconds unseen: an emitter off screen keeps its particles for a moment, not for ever.
    for (auto it = slots_.begin(); it != slots_.end();) {
        if (frame_ > it->second.lastUsed + 300) {
            freeSlot(it->second);
            it = slots_.erase(it);
        } else {
            ++it;
        }
    }
}

bool GpuParticles::ensureKernel() {
    if (kernel_ != ComputeHandle::Invalid) return true;
    if (failed_ || !device_.supportsCompute()) return false;
    std::string log;
    kernel_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kKernel, "main"}, &log);
    if (kernel_ == ComputeHandle::Invalid) {
        ES_LOG_ERROR("GpuParticles: the kernel did not compile: {}", log);
        failed_ = true;
        return false;
    }
    return true;
}

GpuParticles::Slot* GpuParticles::ensureSlot(Entity entity, u32 capacity) {
    Slot& slot = slots_[entity.raw];
    slot.lastUsed = frame_;
    if (slot.state != BufferHandle::Invalid && slot.capacity == capacity) return &slot;
    freeSlot(slot);
    // Zeroed by the device: age 0 of lifetime 0 is a dead particle, and a zero instance has no size to draw.
    slot.state = device_.createBuffer({GfxBufferUsage::Storage, capacity * kStateBytes, false}, GfxContent::transient(), nullptr);
    slot.instances = device_.createBuffer({GfxBufferUsage::Storage, capacity * kInstanceBytes, false}, GfxContent::transient(), nullptr);
    if (slot.state == BufferHandle::Invalid || slot.instances == BufferHandle::Invalid) {
        ES_LOG_ERROR("GpuParticles: could not allocate {} particles", capacity);
        freeSlot(slot);
        slots_.erase(entity.raw);
        return nullptr;
    }
    slot.capacity = capacity;
    slot.lastUsed = frame_;
    return &slot;
}

bool GpuParticles::submit(Entity entity, const ecs::ParticleEmitter& emitter, const ecs::Transform& transform,
                          particle::ParticleSystem& system, const particle::GpuStep& step, BufferHandle& instances) {
    if (!ensureKernel() || step.capacity == 0) return false;
    Slot* slot = ensureSlot(entity, step.capacity);
    if (!slot) return false;
    instances = slot->instances;
    drawn_ += step.drawCount;

    // A second camera's collect asks for the same step until the first has run it.
    for (const Job& queued : jobs_) {
        if (queued.entity == entity) return true;
    }
    const bool local = emitter.simulationSpace == static_cast<i32>(ecs::SimulationSpace::Local);
    // Nothing to advance and nowhere it could have moved to: the buffer already says what is true.
    if (step.dt <= 0.0f && step.spawnCount == 0 && !step.reset && !local) return true;
    if (jobs_.size() >= kMaxJobs) return true;

    Job job{entity, {}, slot, &system, step};
    ParamsBlock& b = job.block;
    std::memset(&b, 0, sizeof(b));

    u32 flags = 0;
    if (step.reset) flags |= kReset;
    if (local) flags |= kLocal;
    const bool noiseOn = emitter.noiseStrength > 0.0f && emitter.noiseFrequency > 0.0f;
    if (noiseOn) flags |= kNoise;
    if (emitter.collisionEnabled) flags |= kFloor;

    const auto* colorLut = system.colorLut(entity);
    const auto* sizeLut = system.sizeLut(entity);
    const auto* speedLut = system.speedLut(entity);
    if (colorLut) flags |= kColorLut;
    if (sizeLut) flags |= kSizeLut;
    if (speedLut) flags |= kSpeedLut;

    // A scene's own draw of randomness, fixed per emitter: the same emitter replays the same particles.
    const u32 seed = entity.raw * 2246822519u + 3266489917u;
    set4(b.p0, step.capacity, step.firstIndex, step.spawnCount, step.smoothCount);
    set4(b.p1, seed, flags, static_cast<u32>(std::clamp(emitter.shape, 0, 5)), static_cast<u32>(std::clamp(emitter.noiseOctaves, 1, 8)));
    set4(b.p2, step.dt, step.noiseTime, finite(emitter.lifetimeMin), finite(emitter.lifetimeMax));
    set4(b.p3, finite(emitter.speedMin), finite(emitter.speedMax), finite(emitter.startSizeMin), finite(emitter.startSizeMax));
    set4(b.p4, finite(emitter.endSizeMin), finite(emitter.endSizeMax), finite(emitter.rotationMin), finite(emitter.rotationMax));
    set4(b.p5, finite(emitter.angularVelocityMin), finite(emitter.angularVelocityMax), finite(emitter.gravity.x), finite(emitter.gravity.y));
    set4(b.p6, finite(emitter.gravity.z), finite(emitter.damping), finite(emitter.noiseStrength), finite(emitter.noiseFrequency));
    const f32 scroll = emitter.noiseScrollSpeed * step.noiseTime * emitter.noiseFrequency;
    set4(b.p7, finite(scroll), finite(scroll), finite(emitter.shapeRadius), finite(emitter.shapeAngle * 0.5f * math::DEG_TO_RAD));
    set4(b.p8, finite(emitter.shapeSize.x), finite(emitter.shapeSize.y), finite(emitter.shapeSize.z), static_cast<f32>(emitter.sizeEasing));
    set4(b.p9, finite(emitter.angleSpreadMin * math::DEG_TO_RAD), finite(emitter.angleSpreadMax * math::DEG_TO_RAD),
         static_cast<f32>(emitter.colorEasing), finite(emitter.collisionFloor));
    set4(b.p10, finite(emitter.collisionBounce), finite(emitter.collisionFriction), finite(emitter.collisionLifetimeLoss), finite(emitter.spriteFPS));
    const std::vector<particle::ForceFieldInstance>& fields = system.forceFields();
    const u32 fieldCount = local ? 0u : static_cast<u32>(std::min<std::size_t>(fields.size(), kMaxFields));
    set4(b.p11, static_cast<u32>(std::max(emitter.spriteColumns, 1)), static_cast<u32>(std::max(emitter.spriteRows, 1)),
         emitter.spriteLoop ? 1u : 0u, fieldCount);
    set4(b.startColor, emitter.startColor.r, emitter.startColor.g, emitter.startColor.b, emitter.startColor.a);
    set4(b.endColor, emitter.endColor.r, emitter.endColor.g, emitter.endColor.b, emitter.endColor.a);

    const glm::vec3 position = transform.worldPosition;
    const glm::vec3 scale = transform.worldScale;
    set4(b.origin, position.x, position.y, position.z, 0.0f);
    set4(b.scale, scale.x, scale.y, scale.z, 0.0f);
    const glm::mat3 rot = glm::mat3_cast(transform.worldRotation);
    set4(b.rot0, rot[0].x, rot[0].y, rot[0].z, 0.0f);
    set4(b.rot1, rot[1].x, rot[1].y, rot[1].z, 0.0f);
    set4(b.rot2, rot[2].x, rot[2].y, rot[2].z, 0.0f);
    f32 angle = 2.0f * std::atan2(transform.worldRotation.z, transform.worldRotation.w);
    if (std::abs(angle) <= 0.001f) angle = 0.0f;
    set4(b.local, std::cos(angle), std::sin(angle), scale.x, scale.y);

    for (u32 k = 0; k < fieldCount; ++k) {
        const particle::ForceFieldInstance& f = fields[k];
        set4(b.fields[k * 3], f.position.x, f.position.y, f.position.z, static_cast<f32>(f.type));
        set4(b.fields[k * 3 + 1], f.direction.x, f.direction.y, f.direction.z, f.strength);
        set4(b.fields[k * 3 + 2], f.radius, f.falloff ? 1.0f : 0.0f, 0.0f, 0.0f);
    }
    if (colorLut) {
        for (u32 k = 0; k < kLutSize; ++k) set4(b.colorLut[k], (*colorLut)[k].r, (*colorLut)[k].g, (*colorLut)[k].b, (*colorLut)[k].a);
    }
    for (u32 k = 0; k < kLutSize; ++k) {
        if (sizeLut) b.sizeLut[k >> 2][k & 3] = (*sizeLut)[k];
        if (speedLut) b.speedLut[k >> 2][k & 3] = (*speedLut)[k];
    }

    jobs_.push_back(job);
    return true;
}

rg::ResourceId GpuParticles::declare(rg::RenderGraph& graph) {
    if (jobs_.empty()) return rg::kNoResource;
    // The pass is tied to the scene by what it writes, the way the other compute passes are: a single texel nobody samples.
    rg::TargetDesc token;
    token.width = 1;
    token.height = 1;
    token.format = GfxPixelFormat::RGBA8;
    token.storage = true;
    token.linearFilter = false;
    const rg::ResourceId done = graph.createTarget(token);
    rg::PassDesc pass;
    pass.name = "gpu_particles";
    pass.compute = true;
    pass.write = done;
    pass.execute = [this](const rg::PassContext&) { run(); };
    graph.addPass(std::move(pass));
    return done;
}

void GpuParticles::run() {
    if (jobs_.empty() || kernel_ == ComputeHandle::Invalid) return;
    const u32 needed = static_cast<u32>(jobs_.size()) * kJobStride;
    if (params_ == BufferHandle::Invalid || paramsCapacity_ < needed) {
        if (params_ != BufferHandle::Invalid) device_.deleteBuffer(params_);
        paramsCapacity_ = std::max(needed, kJobStride * 8u);
        params_ = device_.createBuffer({GfxBufferUsage::Uniform, paramsCapacity_, true}, GfxContent::transient(), nullptr);
        if (params_ == BufferHandle::Invalid) {
            paramsCapacity_ = 0;
            return;
        }
    }
    std::vector<u8> staging(needed, 0);
    for (std::size_t i = 0; i < jobs_.size(); ++i) {
        std::memcpy(staging.data() + i * kJobStride, &jobs_[i].block, sizeof(ParamsBlock));
    }
    device_.updateBuffer(params_, 0, staging.data(), needed);
    for (std::size_t i = 0; i < jobs_.size(); ++i) {
        const Job& job = jobs_[i];
        const GfxComputeBinding bindings[3] = {
            GfxComputeBinding::uniform(0, params_, static_cast<u32>(i) * kJobStride, sizeof(ParamsBlock)),
            GfxComputeBinding::storage(1, job.slot->state),
            GfxComputeBinding::storage(2, job.slot->instances),
        };
        if (device_.dispatchCompute(kernel_, bindings, 3, (job.slot->capacity + 63) / 64)) {
            ++lastDispatches_;
            job.system->commitGpuStep(job.entity, job.step);
        }
    }
    jobs_.clear();
}

}  // namespace esengine
