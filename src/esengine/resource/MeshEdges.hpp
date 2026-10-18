// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeshEdges.hpp
 * @brief   The distinct edges of a triangle list, as the line list a wireframe draws.
 */
#pragma once

#include "../core/Types.hpp"

#include <algorithm>
#include <vector>

namespace esengine {

/**
 * @brief Index pairs, one per distinct edge, in ascending order of (low, high) vertex.
 * @details An edge two triangles share is one line, not two: drawn twice a line is brighter,
 *          and a wireframe whose interior outshines its rim reads wrong. Edges are compared
 *          by vertex index, so a seam that splits one vertex in two stays two edges.
 */
inline std::vector<u32> distinctMeshEdges(ConstSpan<u32> indices) {
    std::vector<u64> keys;
    keys.reserve(indices.size());
    for (usize t = 0; t + 2 < indices.size(); t += 3) {
        for (u32 k = 0; k < 3; ++k) {
            const u32 a = indices[t + k], b = indices[t + (k + 1) % 3];
            keys.push_back((static_cast<u64>(std::min(a, b)) << 32) | std::max(a, b));
        }
    }
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    std::vector<u32> lines;
    lines.reserve(keys.size() * 2);
    for (const u64 key : keys) {
        lines.push_back(static_cast<u32>(key >> 32));
        lines.push_back(static_cast<u32>(key & 0xFFFFFFFFu));
    }
    return lines;
}

}  // namespace esengine
