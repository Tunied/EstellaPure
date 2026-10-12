// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/ParticleEmitter.hpp"
#include "CanvasRoots.hpp"

#include <vector>

namespace esengine::ecs {

inline i32 assignRenderOrder(Registry& registry, Entity entity, i32 counter, u32 cullBit) {
    struct Task { Entity entity; u32 cullBit; };
    std::vector<Task> pending{{entity, cullBit}};
    std::vector<u8> visited;
    while (!pending.empty()) {
        const auto task = pending.back();
        entity = task.entity;
        pending.pop_back();
        if (!registry.valid(entity)) continue;
        const auto index = entity.index();
        if (index >= visited.size()) visited.resize(index + 1, 0);
        if (visited[index]) continue;
        visited[index] = 1;
        const auto* canvas = registry.tryGet<Canvas>(entity);
        const u32 inheritedBit = canvas
            ? ((canvas->layer < 0 || canvas->layer >= 32) ? 0u : (1u << canvas->layer))
            : task.cullBit;
        if (registry.has<UINode>(entity)) {
            auto* uiVisual = registry.tryGet<UIVisual>(entity);
            if (uiVisual) {
                uiVisual->uiOrder = counter;
                uiVisual->uiCullBit = inheritedBit;
                counter++;
            } else if (registry.has<Sprite>(entity)) {
                auto& sprite = registry.get<Sprite>(entity);
                if (sprite.layer != counter) {
                    sprite.layer = counter;
                }
                counter++;
            } else if (auto* emitter = registry.tryGet<ParticleEmitter>(entity)) {
                // UI emitters inherit tree order so their particles interleave with controls.
                if (emitter->layer != counter) {
                    emitter->layer = counter;
                }
                counter++;
            }
        }
        auto* children = registry.tryGet<Children>(entity);
        if (!children) continue;
        for (auto child = children->entities.rbegin(); child != children->entities.rend(); ++child)
            pending.push_back({*child, inheritedBit});
    }
    return counter;
}

inline void uiRenderOrderUpdate(Registry& registry) {
    i32 counter = 0;
    for (Entity entity : canvasRoots(registry, false)) {
        const auto& canvas = registry.get<Canvas>(entity);
        const u32 bit = (canvas.layer < 0 || canvas.layer >= 32) ? 0u : (1u << canvas.layer);
        counter = assignRenderOrder(registry, entity, counter, bit);
    }
}

}  // namespace esengine::ecs
