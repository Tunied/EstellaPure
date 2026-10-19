// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/renderer/frame/PlanarReflectionCamera.hpp"
#include "esengine/renderer/draw/DrawCommand.hpp"
#include <glm/gtc/matrix_transform.hpp>

using namespace esengine;
namespace {
glm::vec3 projected(const glm::mat4& vp, const glm::vec3& p) {
    const glm::vec4 q = vp * glm::vec4(p, 1);
    return glm::vec3(q) / q.w;
}
}
TEST_CASE("planar camera mirrors geometry with an unchanged surface projection") {
    const glm::mat4 source = glm::perspective(glm::radians(55.0f), 1.5f, 0.1f, 100.0f)
        * glm::lookAt(glm::vec3(3, 4, 7), glm::vec3(0), glm::vec3(0, 1, 0));
    PlanarReflectionCamera camera;
    REQUIRE(planarReflectionCamera(source, {0,0,0}, {0,1,0}, 0, camera));
    const auto eye = cameraFromViewProjection(camera.projection);
    CHECK(eye.x == doctest::Approx(3).epsilon(1e-4));
    CHECK(eye.y == doctest::Approx(-4).epsilon(1e-4));
    CHECK(eye.z == doctest::Approx(7).epsilon(1e-4));
    for (const glm::vec3 p : {glm::vec3(1,0,1), glm::vec3(-2,0,-1)}) {
        const auto a = projected(source, p), b = projected(camera.samplingProjection, p);
        CHECK(a.x == doctest::Approx(-b.x).epsilon(1e-4));
        CHECK(a.y == doctest::Approx(b.y).epsilon(1e-4));
    }
    CHECK(glm::determinant(source) * glm::determinant(camera.samplingProjection) > 0);
}
TEST_CASE("near clipping rejects the opposite half space on both devices") {
    for (const bool ortho : {false, true}) {
        const glm::mat4 projection = ortho ? glm::ortho(-5.0f,5.0f,-5.0f,5.0f,0.1f,100.0f)
            : glm::perspective(glm::radians(60.0f),1.0f,0.1f,100.0f);
        const glm::mat4 source = projection * glm::lookAt(glm::vec3(0,3,6),glm::vec3(0),glm::vec3(0,1,0));
        PlanarReflectionCamera camera;
        REQUIRE(planarReflectionCamera(source, {0,0,0}, {0,1,0}, 0.02f, camera));
        for (auto range : {ClipDepthRange::MinusOneToOne, ClipDepthRange::ZeroToOne}) {
            const auto vp = toClipDepthRange(camera.projection, range);
            const float nearDepth = range == ClipDepthRange::MinusOneToOne ? -1.0f : 0.0f;
            CHECK(projected(vp,{0,1,0}).z > nearDepth);
            CHECK(projected(vp,{0,-1,0}).z < nearDepth);
            CHECK(projected(vp,{0,0.02f,0}).z == doctest::Approx(nearDepth).epsilon(1e-4));
        }
    }
}
TEST_CASE("tilted planes and cameras on either side share the same contract") {
    const auto normal = glm::normalize(glm::vec3(1,1,0));
    const glm::vec3 origin(2,1,-1);
    for (float side : {-1.0f,1.0f}) {
        const glm::vec3 eye = origin + side * normal * 4.0f + glm::vec3(0,0,6);
        const auto source = glm::perspective(glm::radians(60.0f),1.0f,0.1f,100.0f)
            * glm::lookAt(eye, origin, glm::vec3(0,1,0));
        PlanarReflectionCamera camera;
        REQUIRE(planarReflectionCamera(source, origin, normal, 0, camera));
        CHECK(projected(camera.projection, origin + normal * side).z > -1);
        CHECK(projected(camera.projection, origin - normal * side).z < -1);
    }
}
TEST_CASE("invalid and grazing inputs leave no invalid camera") {
    PlanarReflectionCamera camera;
    CHECK_FALSE(planarReflectionCamera(glm::mat4(0), {0,0,0}, {0,1,0},0,camera));
    CHECK_FALSE(planarReflectionCamera(glm::mat4(1), {0,0,0}, {0,0,0},0,camera));
    CHECK_FALSE(planarReflectionCamera(glm::mat4(1), {0,0,0}, {0,1,0},0,camera));
}
TEST_CASE("receiving and ordinary surfaces never merge their uniform blocks") {
    DrawCommand a, b;
    a.planar_index = 1;
    CHECK_FALSE(a.canMergeWith(b));
    CHECK(a.mergeBlocker(b) == BatchBreak::Material);
}
