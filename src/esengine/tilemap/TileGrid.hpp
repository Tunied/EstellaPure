// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TileGrid.hpp
 * @brief   Local tile placement and polygon containment shared by rendering and queries.
 */
#pragma once

#include "../core/Types.hpp"
#include <glm/glm.hpp>
#include <algorithm>
#include <cmath>
#include <initializer_list>

namespace esengine::tilemap {

enum class GridType : u8 {
    Orthogonal = 0,
    Isometric = 1,
    StaggeredIsometric = 2,
    Hexagonal = 3,
};

class TileGrid {
public:
    TileGrid(GridType type, f32 width, f32 height, f32 side, bool axisX, bool even)
        : type_(type), width_(width), height_(height), hw_(width * .5f), hh_(height * .5f),
          side_(type == GridType::Hexagonal
              ? std::min(side > 0 ? side : height * .5f, axisX ? width : height) : 0),
          step_(((axisX ? width : height) + side_) * .5f), axis_x_(axisX), even_(even) {}

    // Orthogonal/staggered anchors are top-left; isometric anchors are cell centers.
    glm::vec2 anchor(i32 x, i32 y) const {
        if (type_ == GridType::Isometric) return {(x - y) * hw_, -(x + y) * hh_};
        if (!staggered()) return {x * width_, -y * height_};
        if (axis_x_) return {x * step_, -y * height_ - (shifted(x) ? hh_ : 0)};
        return {x * width_ + (shifted(y) ? hw_ : 0), -y * step_};
    }

    glm::vec2 center(i32 x, i32 y) const {
        const auto a = anchor(x, y);
        return type_ == GridType::Isometric ? a : a + glm::vec2{hw_, -hh_};
    }

    glm::ivec2 cellAt(f32 x, f32 y) const {
        if (type_ == GridType::Isometric) return {floor(x / width_ - y / height_ + .5f),
            floor(-y / height_ - x / width_ + .5f)};
        if (!staggered()) return {floor(x / width_), floor(-y / height_)};
        const f32 down = -y;
        const i32 line = floor(((axis_x_ ? x - hw_ : down - hh_) / step_) + .5f);
        glm::ivec2 fallback{0, 0};
        // At most three stagger lines can overlap a point; tile contents are irrelevant.
        for (const i32 delta : {0, -1, 1}) {
            const i32 candidate = line + delta;
            const f32 shift = shifted(candidate) ? (axis_x_ ? hh_ : hw_) : 0;
            const i32 across = floor(((axis_x_ ? down : x) - shift) / (axis_x_ ? height_ : width_));
            const glm::ivec2 cell = axis_x_ ? glm::ivec2{candidate, across} : glm::ivec2{across, candidate};
            if (delta == 0) fallback = cell;
            const auto c = center(cell.x, cell.y);
            if (contains(x - c.x, y - c.y)) return cell;
        }
        return fallback;
    }

private:
    static i32 floor(f32 value) { return static_cast<i32>(std::floor(value)); }
    bool staggered() const { return type_ == GridType::StaggeredIsometric || type_ == GridType::Hexagonal; }
    bool shifted(i32 line) const { return ((line & 1) != 0) != even_; }
    bool contains(f32 x, f32 y) const {
        x = std::abs(x); y = std::abs(y);
        if (x > hw_ || y > hh_) return false;
        const f32 halfSide = side_ * .5f;
        if (axis_x_) return y * (hw_ - halfSide) + hh_ * std::max(0.0f, x - halfSide)
            <= hh_ * (hw_ - halfSide);
        return x * (hh_ - halfSide) + hw_ * std::max(0.0f, y - halfSide)
            <= hw_ * (hh_ - halfSide);
    }
    GridType type_;
    f32 width_, height_, hw_, hh_, side_, step_;
    bool axis_x_, even_;
};

}  // namespace esengine::tilemap
