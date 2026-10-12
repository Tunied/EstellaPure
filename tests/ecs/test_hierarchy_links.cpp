// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ecs/TransformSystem.hpp"

using namespace esengine;
using namespace esengine::ecs;

TEST_CASE("rejected hierarchy edits preserve the existing link") {
    Registry r;
    const auto root = r.create(), child = r.create(), leaf = r.create();
    REQUIRE(setParent(r, child, root));
    REQUIRE(setParent(r, leaf, child));
    const auto epoch = transformMutationEpoch();
    CHECK_FALSE(setParent(r, child, child));
    CHECK_FALSE(setParent(r, child, leaf));
    const auto stale = r.create();
    r.destroy(stale);
    CHECK_FALSE(setParent(r, child, stale));
    CHECK_FALSE(setParent(r, stale, root));
    CHECK(r.get<Parent>(child).entity == root);
    CHECK(r.get<Children>(root).entities == std::vector<Entity>{child});
    CHECK(transformMutationEpoch() == epoch);
}

TEST_CASE("repeated parenting does not reorder siblings or invalidate composition") {
    Registry r;
    const auto root = r.create(), a = r.create(), b = r.create();
    REQUIRE(setParent(r, a, root));
    REQUIRE(setParent(r, b, root));
    const auto epoch = transformMutationEpoch();
    CHECK(setParent(r, a, root));
    CHECK(r.get<Children>(root).entities == std::vector<Entity>{a, b});
    CHECK(transformMutationEpoch() == epoch);
}

TEST_CASE("both wire null representations detach") {
    Registry r;
    const auto root = r.create(), child = r.create();
    for (const Entity sentinel : {Entity::fromRaw(0), INVALID_ENTITY}) {
        REQUIRE(setParent(r, child, root));
        CHECK(setParent(r, child, sentinel));
        CHECK_FALSE(r.has<Parent>(child));
        CHECK(r.get<Children>(root).entities.empty());
    }
}

TEST_CASE("an existing corrupt ancestor cycle is rejected without hanging") {
    Registry r;
    const auto a = r.create(), b = r.create(), child = r.create();
    // Raw native component writes can bypass the hierarchy transaction. The
    // public operation must fail safely even when handed such a damaged tree.
    r.emplace<Parent>(a, b);
    r.emplace<Parent>(b, a);
    CHECK_FALSE(setParent(r, child, a));
    CHECK_FALSE(r.has<Parent>(child));
    CHECK_FALSE(r.has<Children>(a));
}

TEST_CASE("subtree destruction is iterative and children precede their parents") {
    Registry r;
    std::vector<Entity> ids, events;
    constexpr usize count = 20000;
    ids.reserve(count);
    for (usize i = 0; i < count; ++i) {
        const auto e = r.create();
        ids.push_back(e);
        if (i != 0) {
            // A valid chain constructed directly so this test measures teardown,
            // not the separate ancestry checks charged by setParent.
            r.emplace<Parent>(e, ids[i - 1]);
            r.emplace<Children>(ids[i - 1]).entities.push_back(e);
        }
    }
    auto connection = r.onDestroy([&](Entity e) { events.push_back(e); });
    destroyWithChildren(r, ids.front());
    CHECK(r.entityCount() == 0);
    std::reverse(ids.begin(), ids.end());
    CHECK(events == ids);
}

TEST_CASE("subtree callbacks cannot recursively destroy ancestors or attach children to them") {
    Registry r;
    const auto root = r.create(), child = r.create(), survivor = r.create();
    REQUIRE(setParent(r, child, root));
    std::vector<Entity> events;
    auto connection = r.onDestroy([&](Entity e) {
        events.push_back(e);
        if (e == child) {
            destroyWithChildren(r, root);
            CHECK(r.valid(root)); // reserved, still waiting for this child's callbacks
            CHECK_FALSE(setParent(r, survivor, root));
        }
    });
    destroyWithChildren(r, root);
    CHECK(events == std::vector<Entity>{child, root});
    CHECK(r.entityCount() == 1);
    CHECK_FALSE(r.has<Parent>(survivor));
    CHECK(r.valid(survivor));
}

TEST_CASE("a corrupt child back-edge is destroyed once and reservations do not survive teardown") {
    Registry r;
    const auto root = r.create(), child = r.create();
    REQUIRE(setParent(r, child, root));
    r.emplace<Children>(child).entities.push_back(root);
    usize callbacks = 0;
    auto connection = r.onDestroy([&](Entity) { ++callbacks; });
    destroyWithChildren(r, root);
    CHECK(r.entityCount() == 0);
    CHECK(callbacks == 2);
    CHECK_FALSE(r.destructionPending(root));
    CHECK_FALSE(r.destructionPending(child));
    const auto a = r.create(), b = r.create();
    CHECK(setParent(r, b, a));
}

TEST_CASE("an old teardown owner cannot release a new generation's reservation") {
    Registry r;
    const auto old = r.create();
    REQUIRE(r.reserveDestruction(old));
    CHECK_FALSE(r.reserveDestruction(old));
    r.destroy(old);
    const auto fresh = r.create();
    REQUIRE(fresh.index() == old.index());
    REQUIRE(fresh != old);
    REQUIRE(r.reserveDestruction(fresh));
    r.releaseDestruction(old);
    CHECK(r.destructionPending(fresh));
    const auto parent = r.create();
    CHECK_FALSE(setParent(r, fresh, parent));
    r.releaseDestruction(fresh);
    CHECK(setParent(r, fresh, parent));
    CHECK_FALSE(r.reserveDestruction(old));
    CHECK_FALSE(r.reserveDestruction(INVALID_ENTITY));
}

TEST_CASE("subtree finalization preserves a nested reservation in a reused child slot") {
    Registry r;
    const auto root = r.create(), child = r.create();
    REQUIRE(setParent(r, child, root));
    Entity fresh = INVALID_ENTITY;
    auto connection = r.onDestroy([&](Entity e) {
        if (e != root) return;
        fresh = r.create();
        REQUIRE(fresh.index() == child.index());
        CHECK(r.reserveDestruction(fresh));
    });
    destroyWithChildren(r, root);
    CHECK(r.valid(fresh));
    CHECK(r.destructionPending(fresh));
    r.releaseDestruction(fresh);
    CHECK_FALSE(r.destructionPending(fresh));
}
