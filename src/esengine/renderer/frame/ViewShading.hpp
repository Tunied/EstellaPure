// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ViewShading.hpp
 * @brief   How a view shades the meshes it draws: as authored, as plain clay, or flat albedo.
 */
#pragma once

#include "../../core/Types.hpp"

#include <unordered_map>

namespace esengine {

/**
 * @brief What a mesh is drawn WITH in a view, whatever its own material says.
 *
 * @details A debugging question, not a style: shape is asked of clay, texture of albedo.
 *          View state, so a camera preview drawn in the same frame keeps the authored
 *          look. Only the camera collect reads it; a shadow map draws depth either way.
 */
enum class ShadingMode : u8 {
    /// Each mesh as authored: its material, its textures, its light.
    Shaded = 0,
    /// One neutral matte surface, lit: form and silhouette without anyone's colours.
    Clay = 1,
    /// Base colour and texture with no light and no material: what was painted.
    Albedo = 2,
};

inline constexpr u8 kShadingModeCount = 3;

/**
 * @brief The mode each view asked for. A view that never asked is Shaded, which is
 *        why a frame with nothing set costs a hash lookup per collect and nothing else.
 */
class ViewShading {
public:
    void set(u32 view, ShadingMode mode) {
        if (mode == ShadingMode::Shaded) modes_.erase(view);
        else modes_[view] = mode;
    }

    ShadingMode get(u32 view) const {
        const auto it = modes_.find(view);
        return it == modes_.end() ? ShadingMode::Shaded : it->second;
    }

    /// Views holding a non-default mode, for a criterion that checks nothing leaked.
    usize count() const { return modes_.size(); }

private:
    std::unordered_map<u32, ShadingMode> modes_;
};

}  // namespace esengine
