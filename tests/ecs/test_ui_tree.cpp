#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ui/UITree.hpp"

using namespace esengine;
using namespace esengine::ecs;

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
