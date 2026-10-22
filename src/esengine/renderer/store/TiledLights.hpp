// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TiledLights.hpp
 * @brief   Which screen tiles a light can reach — the half of tiled forward lighting that is decided on the CPU.
 *
 * @details The lighting UBO holds sixteen lights a fragment loops over, which a street at night overruns on its own. The rest of
 *          a frame's point and spot lights (up to MAX_TILED_LIGHTS) ride in the same block with a bitmask per screen tile: bit
 *          i of tile t says light i can reach a pixel in that tile. A fragment finds its tile from where it lands on the
 *          screen and shades only the lights whose bit is set, so the cost follows the lights near a pixel and not the lights
 *          in the scene.
 *
 *          The grid is in NORMALIZED DEVICE coordinates — x and y in [-1, 1], y up — which both backends and every camera share:
 *          a fragment recovers them from the projection it was drawn through, so there is no viewport size, no framebuffer
 *          origin and no sub-rect of a shared surface for the two sides to disagree about.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

#include <algorithm>
#include <cmath>

namespace esengine {

/// Tiles across and down the picture. 16 x 12 is 192 tiles, each a mask of 128 bits (a vec4 of u32), which with the lights is what
/// fits a uniform block's 16 KB.
inline constexpr u32 TILE_COLUMNS = 16;
inline constexpr u32 TILE_ROWS = 12;

/// Lights a frame can carry through tiles, past the sixteen the loop reads directly. Three words of mask: the fourth is spare.
inline constexpr u32 MAX_TILED_LIGHTS = 96;

/// Sets bit @p index in every tile of @p masks that the sphere (@p center, @p radius), seen through @p viewProjection, can reach.
///
/// @details Conservative: the sphere is boxed, the box's eight corners projected, and the tiles the projected rectangle covers get the
///          bit. A corner at or behind the eye makes the projection meaningless, so a light that straddles the camera plane
///          marks every tile — wrongly lit tiles cost a loop iteration, wrongly unlit ones are a visible hole. A light wholly
///          off the screen marks none.
inline void markLightTiles(const glm::mat4& viewProjection, const glm::vec3& center, f32 radius, u32 index,
                           u32 (*masks)[4]) {
    const u32 word = index >> 5;
    const u32 bit = 1u << (index & 31u);
    const auto markAll = [&]() {
        for (u32 t = 0; t < TILE_COLUMNS * TILE_ROWS; ++t) masks[t][word] |= bit;
    };
    f32 minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
    for (u32 corner = 0; corner < 8; ++corner) {
        const glm::vec3 p = center + glm::vec3((corner & 1u) ? radius : -radius, (corner & 2u) ? radius : -radius,
                                               (corner & 4u) ? radius : -radius);
        const glm::vec4 clip = viewProjection * glm::vec4(p, 1.0f);
        if (clip.w <= 1e-4f) {
            markAll();
            return;
        }
        const f32 x = clip.x / clip.w;
        const f32 y = clip.y / clip.w;
        minX = std::min(minX, x);
        maxX = std::max(maxX, x);
        minY = std::min(minY, y);
        maxY = std::max(maxY, y);
    }
    if (maxX < -1.0f || minX > 1.0f || maxY < -1.0f || minY > 1.0f) return;
    const auto tileOf = [](f32 ndc, u32 count) {
        const f32 t = std::floor((ndc * 0.5f + 0.5f) * static_cast<f32>(count));
        return static_cast<u32>(std::clamp(t, 0.0f, static_cast<f32>(count - 1)));
    };
    const u32 x0 = tileOf(minX, TILE_COLUMNS), x1 = tileOf(maxX, TILE_COLUMNS);
    const u32 y0 = tileOf(minY, TILE_ROWS), y1 = tileOf(maxY, TILE_ROWS);
    for (u32 y = y0; y <= y1; ++y) {
        for (u32 x = x0; x <= x1; ++x) masks[y * TILE_COLUMNS + x][word] |= bit;
    }
}

}  // namespace esengine
