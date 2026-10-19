// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {
ES_ENUM()
enum class ReflectionAxis : u8 { X, Y, Z };
ES_ENUM()
enum class ReflectionQuality : u8 { Project, Custom };
ES_ENUM()
enum class ReflectionUpdate : u8 { EveryFrame, FixedRate, OnDemand };

/** A non-recursive capture received by this entity's lit mesh/material.
 * The plane passes through its world origin; the selected local axis is its normal.
 * Surface appearance remains owned by the material's PBR properties.
 */
ES_COMPONENT(stability=experimental)
struct PlanarReflection {
    ES_PROPERTY(enum=ReflectionAxis, category=Capture, tooltip="Local normal axis, transformed with the entity. Y for a floor, Z for a mirror.")
    ReflectionAxis axis{ReflectionAxis::Y};
    ES_PROPERTY(min=0, step=0.005, category=Capture, tooltip="Clip offset in world units; excludes geometry behind the reflecting plane.")
    f32 clipOffset{0.02f};
    ES_PROPERTY(bitmask_source=sortingLayers, category=Capture, tooltip="Sorting-layer bits captured by the reflection. The receiving surface and screen UI are excluded.")
    u32 cullingMask{0xFFFFFFFFu};
    ES_PROPERTY(enum=ReflectionQuality, category=Quality)
    ReflectionQuality quality{ReflectionQuality::Project};
    ES_PROPERTY(min=0.125, max=1, step=0.125, category=Quality, shown_when=quality:Custom)
    f32 resolutionScale{0.5f};
    ES_PROPERTY(min=64, max=4096, step=64, category=Quality, shown_when=quality:Custom)
    u32 maxSize{1024};
    ES_PROPERTY(enum=ReflectionUpdate, category=Quality, shown_when=quality:Custom, tooltip="Only the reflection capture; never limits the main scene frame rate.")
    ReflectionUpdate update{ReflectionUpdate::EveryFrame};
    ES_PROPERTY(min=1, max=120, category=Quality, shown_when=update:FixedRate)
    f32 updatesPerSecond{30.0f};
    /** Increment to request a fresh OnDemand capture from a script or editor action. */
    ES_PROPERTY(advanced)
    u32 revision{0};
    ES_PROPERTY()
    bool enabled{true};
};
} // namespace esengine::ecs
