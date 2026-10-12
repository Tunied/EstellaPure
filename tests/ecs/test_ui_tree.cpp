#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ui/UITree.hpp"
#include "esengine/ui/UIRenderOrderSystem.hpp"

using namespace esengine;
using namespace esengine::ecs;

TEST_CASE("nested canvas roots respect hierarchy instead of component insertion order") {
    for (bool nestedFirst : {false, true}) {
        Registry registry;
        auto root = registry.create(), group = registry.create(), nested = registry.create(), leaf = registry.create();
        if (nestedFirst) registry.emplace<Canvas>(nested).layer = 3;
        registry.emplace<Canvas>(root).layer = 1;
        if (!nestedFirst) registry.emplace<Canvas>(nested).layer = 3;
        for (Entity entity : {root, nested, leaf}) {
            registry.emplace<UINode>(entity); registry.emplace<Transform>(entity); registry.emplace<UIVisual>(entity);
        }
        registry.emplace<Children>(root).entities = {group};
        registry.emplace<Parent>(group).entity = root;
        registry.emplace<Children>(group).entities = {nested};
        registry.emplace<Parent>(nested).entity = group;
        registry.emplace<Children>(nested).entities = {leaf};
        registry.emplace<Parent>(leaf).entity = nested;
        UITree tree; tree.rebuild(registry);
        REQUIRE(tree.nodes_.size() == 3);
        CHECK(tree.nodes_[0].entity == root);
        CHECK(tree.nodes_[1].parent == root);
        CHECK(tree.nodes_[0].subtree_size == 3);
        uiRenderOrderUpdate(registry);
        CHECK(registry.get<UIVisual>(root).uiOrder == 0);
        CHECK(registry.get<UIVisual>(nested).uiOrder == 1);
        CHECK(registry.get<UIVisual>(leaf).uiOrder == 2);
        CHECK(registry.get<UIVisual>(leaf).uiCullBit == 8);
        registry.remove<Canvas>(root);
        tree.rebuild(registry);
        REQUIRE(tree.nodes_.size() == 2);
        CHECK(tree.nodes_[0].entity == nested);
        registry.emplace<Canvas>(root);
        tree.rebuild(registry);
        CHECK(tree.nodes_.size() == 3);
        registry.remove<UINode>(root);
        tree.rebuild(registry);
        REQUIRE(tree.nodes_.size() == 2);
        CHECK(tree.nodes_[0].entity == nested);
    }
}

TEST_CASE("deep scene groups keep UI traversal and draw order intact") {
    Registry registry;
    auto root = registry.create();
    registry.emplace<Canvas>(root);
    registry.emplace<Transform>(root);
    registry.emplace<UINode>(root);
    auto parent = root;
    for (int i = 0; i < 50000; ++i) {
        auto child = registry.create();
        registry.emplace<Children>(parent).entities.push_back(child);
        registry.emplace<Parent>(child).entity = parent;
        parent = child;
    }
    registry.emplace<UINode>(parent);
    registry.emplace<UIVisual>(parent);
    UITree tree;
    tree.rebuild(registry);
    REQUIRE(tree.nodes_.size() == 2);
    CHECK(tree.nodes_[0].subtree_size == 2);
    CHECK(tree.nodes_[1].parent == root);
    CHECK(tree.nodes_[1].depth == 1);
    uiRenderOrderUpdate(registry);
    CHECK(registry.get<UIVisual>(parent).uiOrder == 0);
}

TEST_CASE("repeated and cyclic child links cannot duplicate UI traversal") {
    Registry registry;
    auto root = registry.create(), first = registry.create(), last = registry.create();
    registry.emplace<Canvas>(root);
    registry.emplace<Transform>(root);
    registry.emplace<UINode>(root);
    registry.emplace<UINode>(first);
    registry.emplace<UINode>(last);
    registry.emplace<UIVisual>(first);
    registry.emplace<UIVisual>(last);
    registry.emplace<Children>(root).entities = {first, first, last};
    registry.emplace<Children>(first).entities = {root};
    UITree tree;
    tree.rebuild(registry);
    REQUIRE(tree.nodes_.size() == 3);
    CHECK(tree.nodes_[1].entity == first);
    CHECK(tree.nodes_[2].entity == last);
    CHECK(tree.nodes_[0].subtree_size == 3);
    uiRenderOrderUpdate(registry);
    CHECK(registry.get<UIVisual>(first).uiOrder == 0);
    CHECK(registry.get<UIVisual>(last).uiOrder == 1);
    const auto signature = tree.structure_sig_;
    tree.rebuild(registry);
    CHECK(tree.structure_sig_ == signature);
}

TEST_CASE("wide UI subtrees preserve their full span across the 16-bit boundary") {
    Registry registry;
    auto root = registry.create();
    registry.emplace<Canvas>(root);
    registry.emplace<Transform>(root);
    registry.emplace<UINode>(root);
    auto& children = registry.emplace<Children>(root).entities;
    children.reserve(65535);
    for (int i = 0; i < 65535; ++i) {
        auto child = registry.create();
        registry.emplace<UINode>(child);
        registry.emplace<Parent>(child).entity = root;
        children.push_back(child);
    }
    UITree tree;
    tree.rebuild(registry);
    REQUIRE(tree.nodes_.size() == 65536);
    CHECK(tree.nodes_[0].subtree_size == tree.nodes_.size());
    CHECK(tree.nodes_.back().subtree_size == 1);
    children.pop_back();
    tree.rebuild(registry);
    REQUIRE(tree.nodes_.size() == 65535);
    CHECK(tree.nodes_[0].subtree_size == tree.nodes_.size());
    children.push_back(registry.create());
    registry.emplace<UINode>(children.back());
    tree.rebuild(registry);
    CHECK(tree.nodes_[0].subtree_size == 65536);
    children.push_back(registry.create());
    registry.emplace<UINode>(children.back());
    tree.rebuild(registry);
    CHECK(tree.nodes_[0].subtree_size == 65537);
}
