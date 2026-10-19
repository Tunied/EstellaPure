// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "FrameConstants.hpp"
#include <glm/gtc/matrix_access.hpp>
#include <algorithm>
#include <cmath>

namespace esengine {
struct PlanarReflectionCamera {
    glm::mat4 projection{1.0f};
    glm::mat4 samplingProjection{1.0f};
};

/** Mirrors through a world plane; supports perspective and orthographic sources.
 * Engine clip depth stays [-1,1] until the existing device remap at upload.
 * Oblique row replacement: https://terathon.com/blog/oblique-clipping.html
 */
inline bool planarReflectionCamera(const glm::mat4& source, const glm::vec3& origin,
                                  glm::vec3 normal, f32 offset, PlanarReflectionCamera& out) {
    const f32 length = glm::length(normal);
    if (!std::isfinite(length) || length < 1e-6f || !std::isfinite(offset)) return false;
    normal /= length;
    const glm::vec4 eye = cameraFromViewProjection(source);
    const f32 side = eye.w > 0.5f ? glm::dot(glm::vec3(eye) - origin, normal)
                                   : glm::dot(glm::vec3(eye), normal);
    if (!std::isfinite(side) || std::abs(side) < 1e-5f) return false;
    if (side < 0) normal = -normal;
    const f32 d = -glm::dot(normal, origin);
    glm::mat4 mirror(1.0f);
    for (int c = 0; c < 3; ++c) {
        for (int r = 0; r < 3; ++r) mirror[c][r] -= 2.0f * normal[c] * normal[r];
        mirror[3][c] = -2.0f * d * normal[c];
    }
    glm::mat4 reflected = source * mirror;
    // Reflection reverses handedness. Flip clip X as well so the existing
    // front-face and two-sided normal rules stay valid; sampling uses this
    // same projection, undoing the image flip on the receiving surface.
    for (int c = 0; c < 4; ++c) reflected[c][0] = -reflected[c][0];
    const f32 determinant = glm::determinant(reflected);
    if (!std::isfinite(determinant) || std::abs(determinant) < 1e-12f) return false;
    const glm::vec4 plane(normal, d - std::max(offset, 0.0f));
    const glm::mat4 inverse = glm::inverse(reflected);
    const glm::vec4 clipPlane = glm::transpose(inverse) * plane;
    const glm::vec4 corner(clipPlane.x < 0 ? -1.0f : 1.0f,
                           clipPlane.y < 0 ? -1.0f : 1.0f, 1.0f, 1.0f);
    const f32 denominator = glm::dot(plane, inverse * corner);
    if (!std::isfinite(denominator) || denominator < 1e-6f) return false;
    const glm::vec4 scaled = plane * (2.0f / denominator);
    out.samplingProjection = reflected;
    out.projection = reflected;
    for (int c = 0; c < 4; ++c) out.projection[c][2] = scaled[c] - reflected[c][3];
    return true;
}
} // namespace esengine
