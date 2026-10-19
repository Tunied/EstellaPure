// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "../../core/Types.hpp"
#include <glm/glm.hpp>
namespace esengine {
inline constexpr u32 PLANAR_CONSTANTS_BINDING = 9;
inline constexpr const char* PLANAR_CONSTANTS_BLOCK = "PlanarConstants";
struct PlanarConstants {
    glm::mat4 projection{1.0f};
    // x = active, y = render-target UV y sign, zw = one texel.
    glm::vec4 params{0.0f};
};
static_assert(sizeof(PlanarConstants) == 80);
} // namespace esengine
