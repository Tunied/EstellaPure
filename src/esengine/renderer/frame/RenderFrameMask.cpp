// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./RenderFrame.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/UINode.hpp"
#include "../../ecs/components/UIMask.hpp"
#include "../../ecs/components/Hierarchy.hpp"

#include <glm/glm.hpp>

#include <algorithm>
#include <cmath>
#include <unordered_set>
#include <vector>

namespace esengine {

namespace {

using ScreenRect = ScissorRect;

ScreenRect intersectRects(const ScreenRect& a, const ScreenRect& b) {
    i32 x1 = std::max(a.x, b.x);
    i32 y1 = std::max(a.y, b.y);
    i32 x2 = std::min(a.x + a.w, b.x + b.w);
    i32 y2 = std::min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return {0, 0, 0, 0};
    return {x1, y1, x2 - x1, y2 - y1};
}

glm::vec2 worldToScreen(f32 wx, f32 wy, const glm::mat4& vp,
                         i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    glm::vec4 clip = vp * glm::vec4(wx, wy, 0.0f, 1.0f);
    f32 ndcX = clip.x / clip.w;
    f32 ndcY = clip.y / clip.w;
    f32 sx = static_cast<f32>(vpX) + (ndcX * 0.5f + 0.5f) * static_cast<f32>(vpW);
    f32 sy = static_cast<f32>(vpY) + (ndcY * 0.5f + 0.5f) * static_cast<f32>(vpH);
    return {sx, sy};
}

ScreenRect computeMaskScreenRect(
    ecs::Registry& registry, Entity entity,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    if (!registry.has<ecs::UINode>(entity) || !registry.has<ecs::Transform>(entity)) {
        return {0, 0, 0, 0};
    }
    const auto& node = registry.get<ecs::UINode>(entity);
    if (node.computed_size_.x <= 0.0f || node.computed_size_.y <= 0.0f) return {0, 0, 0, 0};
    auto& transform = registry.get<ecs::Transform>(entity);
    // The world TRS below is decomposed on demand, so a mask whose transform no
    // other pass has read this frame would be clipped to where it used to be.
    transform.ensureDecomposed();

    f32 worldW = node.computed_size_.x * transform.worldScale.x;
    f32 worldH = node.computed_size_.y * transform.worldScale.y;
    if (worldW == 0.0f || worldH == 0.0f) return {0, 0, 0, 0};
    f32 cx = transform.worldPosition.x;
    f32 cy = transform.worldPosition.y;
    f32 px = 0.5f;  // UINode box is pivot-centered
    f32 py = 0.5f;

    f32 localLeft = -worldW * px;
    f32 localRight = worldW * (1.0f - px);
    f32 localBottom = -worldH * py;
    f32 localTop = worldH * (1.0f - py);

    f32 angle = 2.0f * std::atan2(transform.worldRotation.z, transform.worldRotation.w);
    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);

    glm::vec2 corners[4] = {
        {cx + localLeft  * cosA - localBottom * sinA, cy + localLeft  * sinA + localBottom * cosA},
        {cx + localRight * cosA - localBottom * sinA, cy + localRight * sinA + localBottom * cosA},
        {cx + localRight * cosA - localTop    * sinA, cy + localRight * sinA + localTop    * cosA},
        {cx + localLeft  * cosA - localTop    * sinA, cy + localLeft  * sinA + localTop    * cosA},
    };

    f32 minX = std::numeric_limits<f32>::max();
    f32 minY = std::numeric_limits<f32>::max();
    f32 maxX = std::numeric_limits<f32>::lowest();
    f32 maxY = std::numeric_limits<f32>::lowest();
    for (const auto& c : corners) {
        glm::vec2 s = worldToScreen(c.x, c.y, vp, vpX, vpY, vpW, vpH);
        minX = std::min(minX, s.x);
        minY = std::min(minY, s.y);
        maxX = std::max(maxX, s.x);
        maxY = std::max(maxY, s.y);
    }

    return {
        static_cast<i32>(std::round(minX)),
        static_cast<i32>(std::round(minY)),
        static_cast<i32>(std::round(maxX - minX)),
        static_cast<i32>(std::round(maxY - minY)),
    };
}

bool hasAncestorScissorMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& maskSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (maskSet.count(parent.id())) {
            const auto& parentMask = registry.get<ecs::UIMask>(parent);
            if (parentMask.mode == ecs::MaskMode::Scissor) return true;
        }
        current = parent;
    }
    return false;
}

bool hasAncestorStencilMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& stencilSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (stencilSet.count(parent.id())) return true;
        current = parent;
    }
    return false;
}

void applyScissorToDescendants(
    ecs::Registry& registry, RenderFrame& frame, Entity entity,
    const ScreenRect& clipRect, const std::unordered_set<u32>& maskSet,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH,
    std::vector<std::pair<Entity, ScissorRect>>& work
) {
    work.clear();
    work.emplace_back(entity, clipRect);
    usize walked = 0;
    while (!work.empty()) {
        if (++walked > registry.entityCount()) {
            ES_LOG_WARN("Scissor hierarchy repeats nodes; stopping mask traversal");
            work.clear();
            return;
        }
        const auto [owner, parentClip] = work.back();
        work.pop_back();
        if (!registry.has<ecs::Children>(owner)) continue;
        const auto& children = registry.get<ecs::Children>(owner).entities;
        for (auto it = children.rbegin(); it != children.rend(); ++it) {
            const Entity child = *it;
            if (!registry.valid(child)) continue;
            ScreenRect childClip = parentClip;
            if (maskSet.count(child.id())) {
                const auto& childMask = registry.get<ecs::UIMask>(child);
                if (childMask.mode == ecs::MaskMode::Scissor) {
                    const auto childRect = computeMaskScreenRect(registry, child, vp, vpX, vpY, vpW, vpH);
                    childClip = intersectRects(parentClip, childRect);
                }
            }
            frame.setEntityClipRect(child.id(), childClip.x, childClip.y, childClip.w, childClip.h);
            work.emplace_back(child, childClip);
        }
    }
}

static constexpr i32 MAX_STENCIL_REF = 255;

bool hasEmptyMaskBox(ecs::Registry& registry, Entity entity) {
    const auto* node = registry.tryGet<ecs::UINode>(entity);
    auto* transform = registry.tryGet<ecs::Transform>(entity);
    if (!node || !transform) return false;
    if (node->computed_size_.x <= 0.0f || node->computed_size_.y <= 0.0f) return true;
    transform->ensureDecomposed();
    return transform->worldScale.x == 0.0f || transform->worldScale.y == 0.0f;
}

void applyStencilHierarchy(ecs::Registry& registry, RenderFrame& frame,
                            Entity entity, i32 refValue,
                            const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed,
                            std::vector<std::pair<Entity, i32>>& work) {
    if (overflowed) return;
    work.clear();
    if (hasEmptyMaskBox(registry, entity)) {
        refValue = 0;
        frame.setEntityClipRect(entity.id(), 0, 0, 0, 0);
    } else {
        frame.setEntityStencilMask(entity.id(), refValue);
    }
    const auto enqueueChildren = [&](Entity owner, i32 parentRef) {
        if (!registry.has<ecs::Children>(owner)) return;
        const auto& children = registry.get<ecs::Children>(owner).entities;
        for (auto it = children.rbegin(); it != children.rend(); ++it) {
            if (registry.valid(*it)) work.emplace_back(*it, parentRef);
        }
    };
    enqueueChildren(entity, refValue);
    usize walked = 0;
    while (!work.empty()) {
        if (++walked > registry.entityCount()) {
            ES_LOG_WARN("Stencil hierarchy repeats nodes; stopping mask traversal");
            work.clear();
            return;
        }
        auto [owner, currentRef] = work.back();
        work.pop_back();
        if (currentRef == 0) {
            frame.setEntityClipRect(owner.id(), 0, 0, 0, 0);
        } else if (stencilSet.count(owner.id())) {
            if (hasEmptyMaskBox(registry, owner)) {
                frame.setEntityClipRect(owner.id(), 0, 0, 0, 0);
                enqueueChildren(owner, 0);
                continue;
            }
            if (nextRef > MAX_STENCIL_REF) { overflowed = true; work.clear(); return; }
            currentRef = nextRef++;
            frame.setEntityStencilMask(owner.id(), currentRef);
        } else {
            frame.setEntityStencilTest(owner.id(), currentRef);
        }
        enqueueChildren(owner, currentRef);
    }
}

}  // anonymous namespace

void RenderFrame::processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    processMasks(registry, view_projection_, vpX, vpY, vpW, vpH);
}

void RenderFrame::processMasks(ecs::Registry& registry, const glm::mat4& projection,
                               i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    clearAllClipRects();
    clearAllStencilMasks();

    auto maskView = registry.activeView<ecs::UIMask>();
    std::vector<Entity>& scissorMasks = mask_scissor_scratch_;
    std::vector<Entity>& stencilMasks = mask_stencil_scratch_;
    std::unordered_set<u32>& maskSet = mask_set_scratch_;
    std::unordered_set<u32>& stencilSet = stencil_set_scratch_;
    scissorMasks.clear();
    stencilMasks.clear();
    maskSet.clear();
    stencilSet.clear();

    for (auto entity : maskView) {
        const auto& mask = registry.get<ecs::UIMask>(entity);
        if (!mask.enabled) continue;
        maskSet.insert(entity.id());
        if (mask.mode == ecs::MaskMode::Stencil) {
            stencilMasks.push_back(entity);
            stencilSet.insert(entity.id());
        } else {
            scissorMasks.push_back(entity);
        }
    }

    if (scissorMasks.empty() && stencilMasks.empty()) return;

    if (!scissorMasks.empty()) {
        std::vector<Entity>& rootScissors = mask_root_scratch_;
        rootScissors.clear();
        for (auto entity : scissorMasks) {
            if (!hasAncestorScissorMask(registry, entity, maskSet)) {
                rootScissors.push_back(entity);
            }
        }

        for (auto entity : rootScissors) {
            ScreenRect rect = computeMaskScreenRect(registry, entity, projection, vpX, vpY, vpW, vpH);
            rect = intersectRects(rect, {vpX, vpY, vpW, vpH});
            applyScissorToDescendants(registry, *this, entity, rect, maskSet, projection, vpX, vpY, vpW, vpH, mask_scissor_walk_scratch_);
        }
    }

    if (!stencilMasks.empty()) {
#ifdef ES_PLATFORM_WEB
        device_.clearStencil(0);
#endif

        std::vector<Entity>& rootStencils = mask_root_scratch_;
        rootStencils.clear();
        for (auto entity : stencilMasks) {
            if (!hasAncestorStencilMask(registry, entity, stencilSet)) {
                rootStencils.push_back(entity);
            }
        }

        i32 nextRef = 1;
        bool overflowed = false;
        for (auto entity : rootStencils) {
            if (overflowed) break;
            if (nextRef > MAX_STENCIL_REF) break;
            applyStencilHierarchy(registry, *this, entity, nextRef++, stencilSet, nextRef, overflowed, mask_stencil_walk_scratch_);
        }

        if (overflowed) {
            ES_LOG_WARN("Stencil mask overflow: too many nested masks (>255)");
        }
    }
}

}  // namespace esengine
