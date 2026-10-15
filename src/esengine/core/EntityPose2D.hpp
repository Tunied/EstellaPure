// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "Types.hpp"
#include "Reflection.hpp"

namespace esengine {
ES_CONST()
static constexpr u32 ENTITY_POSE_2D_WORDS = 4;

// Entity bits followed by world X/Y and Z rotation in radians. Units belong to
// the caller: composition exports pixels; solver readback exports meters.
struct EntityPose2D { u32 entity; f32 x; f32 y; f32 angle; };
static_assert(sizeof(EntityPose2D) == ENTITY_POSE_2D_WORDS * sizeof(u32));
} // namespace esengine
