// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"

namespace esengine {

// JS/native text submission: x, y, u, v, r, g, b, a, sdfBias.
// The boundary validator and the renderer must consume the same stride.
inline constexpr i32 TEXT_VERTEX_FLOATS = 9;

}  // namespace esengine
