// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderOrigin.hpp
 * @brief   The point the frame is drawn relative to: a world far from zero loses precision in single floats, so positions go to the GPU as
 *          offsets from a point near the camera.
 *
 * @details The view-projection a frame is begun with is built by the host for the same origin (the camera near zero), and every world position
 *          the renderer hands the GPU is taken from it first, so the product on the GPU is the same and the numbers in it are small. Zero is
 *          the default and changes nothing. One origin serves the whole frame, a shadow pass's draws included, so it is set between frames.
 */
#pragma once

#include <glm/glm.hpp>

namespace esengine {

/// The origin, in world units. A double, as the world positions it is taken from are far from zero.
inline glm::dvec3& renderOrigin() {
    static glm::dvec3 origin{0.0};
    return origin;
}

inline void setRenderOrigin(const glm::dvec3& origin) { renderOrigin() = origin; }

/// A world position as the frame draws it: from the origin.
inline glm::vec3 rebased(const glm::vec3& world) {
    return glm::vec3(glm::dvec3(world) - renderOrigin());
}

}  // namespace esengine
