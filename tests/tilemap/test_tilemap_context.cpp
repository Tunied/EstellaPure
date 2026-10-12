#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/core/EstellaContext.hpp>
#include <esengine/tilemap/TilemapSystem.hpp>
#include "../renderer/MockGfxDevice.hpp"

using namespace esengine;
using esengine::tilemap::TilemapSystem;

TEST_CASE("headless contexts own independent tilemap data") {
    EstellaContext first;
    EstellaContext second;
    auto* a = first.tryGet<TilemapSystem>();
    auto* b = second.tryGet<TilemapSystem>();
    REQUIRE(a != nullptr);
    REQUIRE(b != nullptr);
    CHECK(a != b);
    const auto layer = Entity::make(10, 1);
    a->initInfiniteLayer(layer, 16, 16);
    b->initInfiniteLayer(layer, 16, 16);
    a->setTile(layer, -33, 64, 7);
    b->setTile(layer, -33, 64, 9);
    CHECK(a->getTile(layer, -33, 64) == 7);
    CHECK(b->getTile(layer, -33, 64) == 9);
    CHECK_FALSE(first.isInitialized());
    CHECK_FALSE(second.isInitialized());
}

TEST_CASE("renderer initialization retains tilemaps prepared headlessly") {
    EstellaContext context;
    auto* tiles = context.tryGet<TilemapSystem>();
    REQUIRE(tiles != nullptr);
    const auto layer = Entity::make(10, 1);
    tiles->initLayer(layer, 8, 8, 16, 16);
    tiles->setTile(layer, 2, 3, 11);
    REQUIRE(context.init(makeUnique<MockGfxDevice>()));
    CHECK(context.tryGet<TilemapSystem>() == tiles);
    CHECK(context.require<TilemapSystem>().getTile(layer, 2, 3) == 11);
    context.shutdown();
    REQUIRE(context.init(makeUnique<MockGfxDevice>()));
    CHECK(context.tryGet<TilemapSystem>() != nullptr);
    CHECK_FALSE(context.require<TilemapSystem>().hasLayer(layer));
}
