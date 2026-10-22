// Native CTest harness for the CPU half of tiled forward lighting: which screen tiles a light's sphere can reach.
//
// What a wrong answer costs is invisible in a passing frame and plain in a failing one — a light that misses a tile it reaches is a
// hard-edged hole in the lighting, and one that marks every tile is a frame that pays for lights nobody sees. So the numbers
// here are pinned: the tile a light sits in, how many a big one covers, that one behind the eye marks them all, that one off the
// screen marks none, and that the bit lands in the word it should.

#include "esengine/renderer/store/LightStore.hpp"
#include "esengine/renderer/store/TiledLights.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>
#include <cstring>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

constexpr u32 kTiles = TILE_COLUMNS * TILE_ROWS;

u32 tilesWithBit(u32 (*masks)[4], u32 index) {
    u32 n = 0;
    for (u32 t = 0; t < kTiles; ++t) {
        if (masks[t][index >> 5] & (1u << (index & 31u))) ++n;
    }
    return n;
}

bool hasBit(u32 (*masks)[4], u32 tile, u32 index) { return (masks[tile][index >> 5] & (1u << (index & 31u))) != 0; }

/// A camera at the origin looking down -Z, 60 degrees, square picture.
glm::mat4 camera() {
    return glm::perspective(glm::radians(60.0f), 1.0f, 0.1f, 1000.0f);
}

}  // namespace

int main() {
    static u32 masks[kTiles][4];
    const glm::mat4 vp = camera();

    // --- a small light straight ahead lights the tile at the centre, and only the tiles around it
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f, 0, masks);
        const u32 centreX = TILE_COLUMNS / 2, centreY = TILE_ROWS / 2;
        CHECK(hasBit(masks, centreY * TILE_COLUMNS + centreX, 0) || hasBit(masks, (centreY - 1) * TILE_COLUMNS + centreX - 1, 0),
              "a light straight ahead marks a tile at the middle of the picture");
        CHECK(tilesWithBit(masks, 0) <= 4, "and, being small and far, no more than four tiles");
        CHECK(!hasBit(masks, 0, 0) && !hasBit(masks, kTiles - 1, 0), "none of the corners");
    }

    // --- a light's bit lands in its own word
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f, 70, masks);
        bool wordOk = true;
        for (u32 t = 0; t < kTiles; ++t) {
            if (masks[t][0] != 0 || masks[t][1] != 0 || masks[t][3] != 0) wordOk = false;
        }
        CHECK(wordOk && tilesWithBit(masks, 70) > 0, "light 70 sets bit 6 of word 2 and nothing in the other words");
    }

    // --- a big light covers a lot of the picture, and a bigger one all of it
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -30.0f), 9.0f, 0, masks);
        const u32 wide = tilesWithBit(masks, 0);
        CHECK(wide > kTiles / 4 && wide < kTiles, "a light that spans much of the picture marks much of it, not all");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -20.0f), 200.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "a light that covers the whole picture marks every tile");
    }

    // --- off the screen: none; behind or around the eye: all
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(500.0f, 0.0f, -50.0f), 1.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == 0, "a light far to the side of the view marks no tile");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, 20.0f), 1.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "a light behind the camera marks every tile, since where it lands is not known");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, 0.0f), 5.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "and so does one that straddles the camera plane");
    }

    // --- the grid is in normalized device coordinates: the bottom-left of the picture is tile 0, y up
    {
        std::memset(masks, 0, sizeof(masks));
        // Down and to the left of the centre.
        markLightTiles(vp, glm::vec3(-20.0f, -20.0f, -50.0f), 1.0f, 0, masks);
        bool lowLeft = false;
        for (u32 y = 0; y < TILE_ROWS / 2; ++y) {
            for (u32 x = 0; x < TILE_COLUMNS / 2; ++x) lowLeft |= hasBit(masks, y * TILE_COLUMNS + x, 0);
        }
        CHECK(lowLeft && tilesWithBit(masks, 0) > 0, "a light below and left of the centre marks a tile in the first rows and columns");
        bool upper = false;
        for (u32 y = TILE_ROWS / 2; y < TILE_ROWS; ++y) {
            for (u32 x = 0; x < TILE_COLUMNS; ++x) upper |= hasBit(masks, y * TILE_COLUMNS + x, 0);
        }
        CHECK(!upper, "and none in the upper half: rows count up from the bottom");
    }

    // --- an orthographic camera (every 2D game) maps the same way
    {
        std::memset(masks, 0, sizeof(masks));
        const glm::mat4 ortho = glm::ortho(-100.0f, 100.0f, -100.0f, 100.0f, -10.0f, 10.0f);
        markLightTiles(ortho, glm::vec3(0.0f, 0.0f, 0.0f), 5.0f, 3, masks);
        const u32 n = tilesWithBit(masks, 3);
        CHECK(n >= 1 && n <= 4, "an orthographic light at the centre marks the tiles at the centre");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(ortho, glm::vec3(0.0f, 0.0f, 0.0f), 500.0f, 3, masks);
        CHECK(tilesWithBit(masks, 3) == kTiles, "and one bigger than the view marks them all");
    }

    // --- the store carries what the tiles name, up to its cap, and a reflection pass can hide them
    {
        LightStore store;
        store.clear();
        GpuLight light;
        light.posDir = glm::vec4(0.0f, 0.0f, 0.0f, 10.0f);
        light.color = glm::vec4(1.0f, 0.0f, 0.0f, 2.0f);
        for (u32 i = 0; i < MAX_TILED_LIGHTS; ++i) {
            if (!store.addTiledLight(light, vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f)) { CHECK(false, "a tiled light was refused under the cap"); break; }
        }
        CHECK(store.tiledCount() == MAX_TILED_LIGHTS && store.data().tileInfo.x == static_cast<f32>(MAX_TILED_LIGHTS),
              "the store holds a full set of tiled lights and says how many");
        CHECK(!store.addTiledLight(light, vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f), "and refuses the next");
        CHECK(store.data().tileInfo.y == static_cast<f32>(TILE_COLUMNS) && store.data().tileInfo.z == static_cast<f32>(TILE_ROWS),
              "it says the tile grid's size");
        store.suspendTiled(true);
        CHECK(store.data().tileInfo.x == 0.0f, "suspended, the shader's loop does not run");
        store.suspendTiled(false);
        CHECK(store.data().tileInfo.x == static_cast<f32>(MAX_TILED_LIGHTS), "and resumed, it does");
        store.clear();
        CHECK(store.tiledCount() == 0 && store.data().tileInfo.x == 0.0f, "a new frame starts with none");
    }

    CHECK(sizeof(LightConstants) <= 16384, "the whole block fits the 16 KB a uniform block is guaranteed");

    std::printf(g_failures == 0 ? "\nALL PASS\n" : "\n%d FAILURE(S)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
