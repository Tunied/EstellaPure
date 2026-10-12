// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ecs/TransformSystem.hpp"

using namespace esengine;
using namespace esengine::ecs;
struct Sample { int value = 1; };

TEST_CASE("activity is derived without overwriting a child's switch") {
    Registry r;
    const auto root = r.create(), child = r.create(), leaf = r.create();
    setParent(r, child, root); setParent(r, leaf, child);
    r.setEntityEnabled(root, false);
    CHECK_FALSE(r.isEntityActive(leaf));
    r.setEntityEnabled(child, false);
    r.setEntityEnabled(root, true);
    CHECK(r.isEntityActive(root));
    CHECK_FALSE(r.isEntityActive(leaf));
    r.setEntityEnabled(child, true);
    CHECK(r.isEntityActive(leaf));
}
TEST_CASE("reparenting and detachment invalidate the derived closure") {
    Registry r;
    const auto off = r.create(), on = r.create(), child = r.create();
    r.setEntityEnabled(off, false); setParent(r, child, off);
    CHECK_FALSE(r.isEntityActive(child));
    setParent(r, child, on); CHECK(r.isEntityActive(child));
    setParent(r, child, off); CHECK_FALSE(r.isEntityActive(child));
    setParent(r, child, INVALID_ENTITY); CHECK(r.isEntityActive(child));
}
TEST_CASE("active views filter single, multiple, snapshot and live iteration") {
    Registry r;
    const auto on = r.create(), off = r.create();
    for (auto e : {on, off}) { r.emplace<Sample>(e); r.emplace<Transform>(e); }
    r.setEntityEnabled(off, false);
    CHECK(r.view<Sample>().size() == 2);
    int count = 0;
    for (auto e : r.activeView<Sample>()) { CHECK(e == on); ++count; }
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample, Transform>().each([&](Entity e, Sample&, Transform&) { CHECK(e == on); ++count; });
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample>().eachLive([&](Sample&) { ++count; });
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample>().each([&](Sample&) { ++count; });
    r.activeView<Sample>().each([&](Entity e) { CHECK(e == on); ++count; });
    r.activeView<Sample>().eachLive([&](Entity e, Sample&) { CHECK(e == on); ++count; });
    r.activeView<Sample>().eachLive([&](Entity e) { CHECK(e == on); ++count; });
    CHECK(count == 4);
}
TEST_CASE("destruction and clear do not disable a recycled slot") {
    Registry r;
    const auto old = r.create();
    r.setEntityEnabled(old, false); r.destroy(old);
    const auto replacement = r.create();
    CHECK(replacement.index() == old.index());
    CHECK(r.isEntityActive(replacement));
    CHECK_FALSE(r.isEntityActive(old));
    CHECK_FALSE(r.setEntityEnabled(old, false));
    r.setEntityEnabled(replacement, false); r.clear();
    CHECK(r.isEntityActive(r.create()));
}
TEST_CASE("a deep chain resolves iteratively and responds to native component writes") {
    Registry r;
    const auto root = r.create();
    auto last = root;
    for (int i = 0; i < 50000; ++i) { const auto child = r.create(); r.emplace<Parent>(child, last); last = child; }
    r.setEntityEnabled(root, false);
    CHECK_FALSE(r.isEntityActive(last));
    r.remove<Parent>(last); CHECK(r.isEntityActive(last));
    r.emplaceOrReplace<Parent>(last, root); CHECK_FALSE(r.isEntityActive(last));
}
TEST_CASE("unrelated entity churn leaves the all-active epoch stable") {
    Registry r;
    const auto epoch = r.activityEpoch();
    const auto e = r.create(); r.destroy(e);
    CHECK(r.activityEpoch() == epoch);
}
