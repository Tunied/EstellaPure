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
#include <glm/gtc/matrix_transform.hpp>

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

/// A view-projection made for `origin`, for a point given from the origin now: the point from the old origin is the new one's plus the step between them.
inline glm::mat4 viewProjectionFromOrigin(const glm::mat4& viewProjection, const glm::dvec3& origin) {
    const glm::dvec3 step = renderOrigin() - origin;
    if (step == glm::dvec3(0.0)) return viewProjection;
    return viewProjection * glm::translate(glm::mat4(1.0f), glm::vec3(step));
}

/// A model placed from `origin`, as it is placed from the origin now.
inline glm::mat4 modelFromOrigin(const glm::mat4& model, const glm::dvec3& origin) {
    const glm::dvec3 step = origin - renderOrigin();
    if (step == glm::dvec3(0.0)) return model;
    return glm::translate(glm::mat4(1.0f), glm::vec3(step)) * model;
}

}  // namespace esengine
