// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UINode.hpp"

#include <unordered_map>
#include <vector>

namespace esengine::ecs {

/** Top-level eligible canvases in query order, independent of entity creation order. */
inline std::vector<Entity> canvasRoots(Registry& registry, bool layoutOnly) {
    std::vector<Entity> candidates;
    registry.each<Canvas>([&](Entity entity, Canvas&) {
        if (!layoutOnly || (registry.has<UINode>(entity) && registry.has<Transform>(entity)))
            candidates.push_back(entity);
    });
    if (candidates.size() <= 1) return candidates;
    // 1 = current ancestor chain, 2 = no eligible canvas, 3 = eligible canvas reachable.
    std::unordered_map<Entity, u8> ancestry;
    ancestry.reserve(candidates.size());
    for (Entity entity : candidates) ancestry.emplace(entity, 3);
    std::vector<Entity> roots;
    std::vector<Entity> trail;
    for (Entity entity : candidates) {
        trail.clear();
        const auto* parent = registry.tryGet<Parent>(entity);
        Entity ancestor = parent ? parent->entity : INVALID_ENTITY;
        bool nested = false;
        while (registry.valid(ancestor)) {
            auto [entry, inserted] = ancestry.emplace(ancestor, 1);
            if (!inserted) {
                nested = entry->second == 3;
                break;
            }
            trail.push_back(ancestor);
            parent = registry.tryGet<Parent>(ancestor);
            ancestor = parent ? parent->entity : INVALID_ENTITY;
        }
        for (Entity visited : trail) ancestry[visited] = nested ? 3 : 2;
        if (!nested) roots.push_back(entity);
    }
    return roots;
}

}  // namespace esengine::ecs
