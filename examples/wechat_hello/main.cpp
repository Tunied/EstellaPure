#include <esengine/core/EstellaContext.hpp>
#include <esengine/renderer/draw/ImmediateDraw.hpp>
#include <esengine/renderer/rhi/GfxDevice.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <emscripten/heap.h>
#include <cmath>
#include <cstdio>
#include <memory>

namespace {
std::unique_ptr<esengine::EstellaContext> engine;
int width = 1, height = 1, frames = 0;
float elapsed = 0;
bool paused = false;
// A small C++ vector bitmap alphabet: no platform text, font file or JS draws.
const char* glyph(char c) {
    switch(c) {
    case 'H': return "10001100011000111111100011000110001";
    case 'E': return "11111100001000011110100001000011111";
    case 'L': return "10000100001000010000100001000011111";
    case 'O': return "01110100011000110001100011000101110";
    case 'W': return "10001100011000110101101011010101010";
    case 'R': return "11110100011000111110101001001010001";
    case 'D': return "11110100011000110001100011000111110";
    case 'S': return "01111100001000001110000010000111110";
    case 'T': return "11111001000010000100001000010000100";
    case 'A': return "01110100011000111111100011000110001";
    default: return "00000000000000000000000000000000000";
    }
}
void text(esengine::ImmediateDraw& draw, const char* value, float x, float y, float scale) {
    for (; *value; ++value, x += scale * 6) {
        const char* bits = glyph(*value);
        for (int row = 0; row < 7; ++row) for (int col = 0; col < 5; ++col)
            if (bits[row * 5 + col] == '1')
                draw.rect({x + col * scale, y + row * scale}, {scale, scale}, {0.88f, 0.95f, 1, 1});
    }
}
}
extern "C" {
int eh_heap_bytes() { return static_cast<int>(emscripten_get_heap_size()); }
int eh_init(int context, int w, int h) {
    if (context <= 0 || w <= 0 || h <= 0) return 0;
    std::puts("ESTELLA_STAGE context-create");
    auto next = std::make_unique<esengine::EstellaContext>();
    next->state().viewport_width = w; next->state().viewport_height = h;
    std::puts("ESTELLA_STAGE core-init");
    if (!next->init(context)) return 0;
    engine = std::move(next); width = w; height = h;
    frames = 0; elapsed = 0; paused = false;
    std::printf("ESTELLA_STAGE core-ready heap=%d\n", eh_heap_bytes());
    return 1;
}
int eh_frame(double delta) {
    if (!engine) return 0;
    if (!paused) elapsed += static_cast<float>(delta);
    auto& device = engine->require<esengine::GfxDevice>();
    device.setViewport(0, 0, width, height);
    esengine::RenderPassDesc pass{};
    pass.clearColor = true; pass.clearDepth = true;
    pass.clearColorValue[0] = 0.035f; pass.clearColorValue[1] = 0.065f; pass.clearColorValue[2] = 0.12f;
    device.beginRenderPass(pass);
    auto& draw = engine->require<esengine::ImmediateDraw>();
    draw.begin(glm::ortho(0.f, 360.f, 780.f, 0.f, -1.f, 1.f), width, height);
    text(draw, "ESTELLA", 97, 200, 4);
    text(draw, "HELLO WORLD", 49, 310, 4);
    draw.circle({180.f + 85.f * std::sin(elapsed), 470.f}, 28, paused ? glm::vec4{1,.5f,.2f,1} : glm::vec4{.2f,.85f,.65f,1});
    draw.rect({40, 580}, {280, 6}, {.16f,.25f,.4f,1});
    draw.rect({40, 580}, {280 * static_cast<float>((frames % 120) + 1) / 120, 6}, {.3f,.65f,1,1});
    draw.end();
    device.endRenderPass(); device.endFrame();
    if (auto error = device.getError()) { std::printf("ESTELLA_GL_ERROR %u\n", error); return 0; }
    ++frames;
    if (frames == 1 || frames == 120) std::printf("ESTELLA_FRAME_OK %d heap=%d\n", frames, eh_heap_bytes());
    return 1;
}
int eh_resize(int w, int h) {
    if (w <= 0 || h <= 0) return 0;
    width = w; height = h; return 1;
}
void eh_touch() { paused = !paused; }
void eh_shutdown() { engine.reset(); }
}
