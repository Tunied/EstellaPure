// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpringBoneSolver.hpp
 * @brief   The arithmetic of a spring chain, with no registry in it: Verlet integration, length
 *          constraints, collision against spheres and capsules, and the rotation that aims a
 *          bone at where its child has got to.
 * @details Everything is over plain arrays and plain structs so the same code is exercised by a
 *          unit test, by the editor's world, and by a build with no JIT. A chain is a tree stored
 *          parents-first: a node's parent always has a smaller index.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <vector>

namespace esengine::springbone {

/** @brief One simulated point of a chain. */
struct Particle {
    /** @brief Index of the parent particle, -1 for the root, which the animation drives. */
    i32 parent = -1;
    /** @brief Simulated world position, and where it was a step ago (Verlet's velocity). */
    glm::vec3 position{0.0f};
    glm::vec3 previous{0.0f};
    /** @brief Where the animation puts it this frame. */
    glm::vec3 target{0.0f};
    /** @brief Its distance from its parent, which the chain keeps. */
    f32 restLength = 0.0f;
};

/** @brief What shapes one step. */
struct StepParams {
    f32 stiffness = 0.1f;   ///< Pull toward the animated pose per 60 Hz frame, 0 to 1.
    f32 drag = 0.5f;         ///< Share of speed lost per 60 Hz frame, 0 to 1.
    glm::vec3 gravity{0.0f, -980.0f, 0.0f};
    f32 radius = 0.0f;       ///< The strand's own thickness, kept clear of colliders.
};

/** @brief A collider in world space: a sphere when `a == b`, else a capsule from `a` to `b`. */
struct Collider {
    glm::vec3 a{0.0f};
    glm::vec3 b{0.0f};
    f32 radius = 0.0f;
};

/** @brief The rate the integration is stepped at: the stiffness and drag are per frame of this. */
constexpr f32 kReferenceStep = 1.0f / 60.0f;

/** @brief Longest stretch of time one call integrates; a stall must not become a lurch. */
constexpr f32 kMaxStep = 1.0f / 20.0f;

/** @brief Sets every particle to rest at its target: the state a chain starts in and the one it is put back in after a teleport. */
void reset(std::vector<Particle>& chain);

/**
 * @brief Advances the chain by `dt` seconds.
 * @details The root is held at its target. Every other particle keeps its velocity less drag, falls with gravity, and is pulled toward its
 *          target; then each is put back at its rest length from its parent (parents first, so a bone cannot stretch) and pushed out of
 *          every collider. The time is split into steps of at most one 60 Hz frame, so the result does not depend on the frame rate much.
 */
void step(std::vector<Particle>& chain, const StepParams& params, const std::vector<Collider>& colliders, f32 dt);

/** @brief The shortest rotation that turns direction `from` onto direction `to`; identity when either has no length. */
glm::quat shortestArc(const glm::vec3& from, const glm::vec3& to);

/** @brief Moves `p` out of `c` if it is inside (radius widened by `extra`), returning whether it moved. */
bool pushOut(glm::vec3& p, const Collider& c, f32 extra);

}  // namespace esengine::springbone
