// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "SpringBoneSolver.hpp"

#include <algorithm>
#include <cmath>

namespace esengine::springbone {

void reset(std::vector<Particle>& chain) {
    for (auto& p : chain) {
        p.position = p.target;
        p.previous = p.target;
    }
}

glm::quat shortestArc(const glm::vec3& from, const glm::vec3& to) {
    const f32 lf = glm::length(from), lt = glm::length(to);
    if (lf < 1e-8f || lt < 1e-8f) return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    const glm::vec3 f = from / lf, t = to / lt;
    const f32 d = glm::dot(f, t);
    if (d > 0.999999f) return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    if (d < -0.999999f) {
        // Opposite: any axis across `from` turns it round.
        glm::vec3 axis = glm::cross(glm::vec3(1.0f, 0.0f, 0.0f), f);
        if (glm::dot(axis, axis) < 1e-6f) axis = glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), f);
        return glm::angleAxis(3.14159265f, glm::normalize(axis));
    }
    const glm::vec3 axis = glm::cross(f, t);
    // (1 + dot, cross) normalised is the half-angle quaternion of the arc.
    return glm::normalize(glm::quat(1.0f + d, axis.x, axis.y, axis.z));
}

bool pushOut(glm::vec3& p, const Collider& c, f32 extra) {
    const f32 r = c.radius + extra;
    // The nearest point of the capsule's segment (a sphere's is its centre).
    glm::vec3 nearest = c.a;
    const glm::vec3 ab = c.b - c.a;
    const f32 len2 = glm::dot(ab, ab);
    if (len2 > 1e-12f) {
        const f32 t = std::clamp(glm::dot(p - c.a, ab) / len2, 0.0f, 1.0f);
        nearest = c.a + ab * t;
    }
    const glm::vec3 d = p - nearest;
    const f32 d2 = glm::dot(d, d);
    if (d2 >= r * r) return false;
    if (d2 < 1e-12f) {
        // On the axis: leave along any direction rather than not at all.
        p = nearest + glm::vec3(0.0f, r, 0.0f);
        return true;
    }
    const f32 dist = std::sqrt(d2);
    p = nearest + d * (r / dist);
    return true;
}

f32 gustFactor(f32 time, f32 frequency, f32 gust, i32 index) {
    if (gust <= 0.0f) return 1.0f;
    constexpr f32 kTwoPi = 6.28318530718f;
    // Two incommensurate sines: no beat repeats soon enough to read as a loop. The index lags the phase so each bone meets a gust a moment after the one above.
    const f32 phase = time * frequency * kTwoPi - static_cast<f32>(index) * 0.35f;
    const f32 n = 0.6f * std::sin(phase) + 0.4f * std::sin(phase * 2.37f + 1.3f);
    return std::max(0.0f, 1.0f + std::clamp(gust, 0.0f, 1.0f) * n);
}

namespace {

void substep(std::vector<Particle>& chain, const StepParams& params, const std::vector<Collider>& colliders, f32 h, f32 time) {
    // Stiffness and drag are quoted per 60 Hz frame; at another step they are the same decay over that time.
    const f32 frames = h / kReferenceStep;
    const f32 keep = std::pow(std::clamp(1.0f - params.drag, 0.0f, 1.0f), frames);
    const f32 pull = 1.0f - std::pow(std::clamp(1.0f - params.stiffness, 0.0f, 1.0f), frames);
    const glm::vec3 fall = params.gravity * (h * h);

    const size_t n = chain.size();
    for (size_t i = 0; i < n; ++i) {
        Particle& p = chain[i];
        if (p.parent < 0) {
            p.position = p.target;
            p.previous = p.target;
            continue;
        }
        const glm::vec3 velocity = (p.position - p.previous) * keep;
        p.previous = p.position;
        p.position += velocity + fall;
        if (glm::dot(params.wind, params.wind) > 0.0f) p.position += params.wind * (gustFactor(time, params.windFrequency, params.windGust, static_cast<i32>(i)) * h * h);
        p.position += (p.target - p.position) * pull;
    }
    // Parents first: a node's parent is already where it will be, so each node is put at its distance from it and the chain cannot stretch.
    for (size_t i = 0; i < n; ++i) {
        Particle& p = chain[i];
        if (p.parent < 0) continue;
        const Particle& parent = chain[static_cast<size_t>(p.parent)];
        glm::vec3 d = p.position - parent.position;
        const f32 len = glm::length(d);
        if (len < 1e-8f) d = p.target - parent.target;
        else d /= len;
        const f32 dl = glm::length(d);
        if (dl < 1e-8f) continue;
        p.position = parent.position + d / dl * p.restLength;
        // Out of the colliders and back onto the bone's length, a few times over: each undoes a little of the other, and they meet where the
        // bone slides round the collider instead of through it.
        for (int pass = 0; pass < 3 && !colliders.empty(); ++pass) {
            bool moved = false;
            for (const Collider& c : colliders) moved = pushOut(p.position, c, params.radius) || moved;
            if (!moved) break;
            glm::vec3 e = p.position - parent.position;
            const f32 el = glm::length(e);
            if (el > 1e-8f) p.position = parent.position + e / el * p.restLength;
        }
    }
}

}  // namespace

void step(std::vector<Particle>& chain, const StepParams& params, const std::vector<Collider>& colliders, f32 dt) {
    if (chain.empty() || dt <= 0.0f) return;
    dt = std::min(dt, kMaxStep);
    const i32 steps = std::max(1, static_cast<i32>(std::ceil(dt / kReferenceStep - 1e-4f)));
    const f32 h = dt / static_cast<f32>(steps);
    for (i32 s = 0; s < steps; ++s) substep(chain, params, colliders, h, params.time + h * static_cast<f32>(s));
}

}  // namespace esengine::springbone
