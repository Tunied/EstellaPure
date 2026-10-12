// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/bindings/modules/spine/SkeletalModule.hpp"

TEST_CASE("PMA color separates batches even when texture and blend match") {
    es::skeletal::BatchList batches;
    es::skeletal::BatchCollector sink(batches);
    const float positions[] = {0, 0, 1, 0, 0, 1};
    const float uvs[] = {0, 0, 1, 0, 0, 1};
    const std::uint16_t indices[] = {0, 1, 2};
    const float color[] = {0.2f, 0.1f, 0.05f, 0.25f};
    for (int blend : {2, 3}) {
        batches.reset();
        for (bool pma : {false, true, true, false}) {
            sink.setPremultipliedColor(pma);
            sink.emit(positions, uvs, 3, indices, 3, 7, blend, color);
        }
        REQUIRE(batches.size() == 3);
        CHECK_FALSE(batches[0].premultipliedColor);
        CHECK(batches[1].premultipliedColor);
        CHECK_FALSE(batches[2].premultipliedColor);
        CHECK(batches[1].vertices.size() == 6 * es::skeletal::VERTEX_FLOATS);
        CHECK(batches[1].indices[3] == 3);
        CHECK(batches[1].vertices[4] == doctest::Approx(color[0]));
        CHECK(batches[1].vertices[7] == doctest::Approx(color[3]));
    }
}
