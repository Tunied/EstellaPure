// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "Registry.hpp"

#include <cmath>

namespace esengine::ecs {

// Derived by TransformSystem; never serialized or exposed as an authored component.
struct FlatGeometryCollapsed {};

// A flat local box has area only when its two transformed axes span a plane.
// Double products preserve tiny finite spans without an arbitrary epsilon cutoff.
inline bool hasFlatGeometryArea(Transform& transform, bool parented) {
    transform.ensureDecomposed();
    if (!parented) {
        return transform.worldScale.x != 0 && transform.worldScale.y != 0
            && std::isfinite(transform.worldScale.x) && std::isfinite(transform.worldScale.y);
    }
    const glm::dvec3 x(transform.cachedMatrix_[0]), y(transform.cachedMatrix_[1]);
    const auto cross = glm::cross(x, y);
    return (cross.x != 0 || cross.y != 0 || cross.z != 0)
        && std::isfinite(cross.x) && std::isfinite(cross.y) && std::isfinite(cross.z);
}

inline bool hasFlatGeometryArea(Registry& registry, Entity entity, Transform& transform) {
    return !registry.has<FlatGeometryCollapsed>(entity)
        && hasFlatGeometryArea(transform, registry.has<Parent>(entity));
}

inline bool copyFlatRenderMatrix(Registry& registry, Entity entity, glm::mat4& output) {
    auto* transform = registry.tryGet<Transform>(entity);
    if (!transform || !hasFlatGeometryArea(registry, entity, *transform)) return false;
    output = registry.has<Parent>(entity) ? transform->cachedMatrix_
        : math::compose(transform->worldPosition, transform->worldRotation, transform->worldScale);
    return true;
}

}  // namespace esengine::ecs
