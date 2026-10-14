// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Unified submission face: BatchBuilder is the ONLY DrawCommand producer, and every
// stream (Batch quads, shape vertices, particle instances) routes through it. Drives
// pushBatchDraw / appendIndexedDraw / appendQuad against a real TransientBufferPool +
// DrawList over the MockGfxDevice and asserts the per-stream baseVertex math, the
// texture-slot rules, instanced command assembly, sort/merge behavior, clip stamping,
// and execute() dispatch — the invariants the per-plugin hand-rolled paths used to own.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "MockGfxDevice.hpp"
#include "esengine/renderer/draw/BatchBuilder.hpp"
#include "esengine/renderer/draw/DrawList.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include "esengine/renderer/rhi/TransientBufferPool.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/renderer/plugins/UIElementPlugin.hpp"
#include "esengine/ecs/components/UINode.hpp"
#include "esengine/ecs/components/UIVisual.hpp"
#include "esengine/ecs/components/UIMask.hpp"

#include <functional>
#include <utility>
#include <vector>

using namespace esengine;

namespace {

struct Harness {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    DrawList list;
    ClipState clips;

    Harness() {
        pool.init(64 * 1024, 16 * 1024);
        pool.beginFrame();
    }
    ~Harness() { pool.shutdown(); }
};

struct NineSlicePlugin : UIElementPlugin {
    using BatchPlugin::emitNineSlice;
};

BatchDrawKey quadKey(u32 textureId, i32 layer = 0) {
    BatchDrawKey key{};
    key.stage = RenderStage::Transparent;
    key.layer = layer;
    key.shaderId = 7;
    key.blend = BlendMode::Normal;
    key.textureId = textureId;
    key.type = RenderType::Sprite;
    return key;
}

// The 48-byte record the Shape stream is laid out for (mirrors ShapePlugin's format).
struct TestShapeVertex {
    f32 px, py, ux, uy;
    f32 cr, cg, cb, ca;
    f32 shapeType, halfW, halfH, cornerRadius;
};
static_assert(sizeof(TestShapeVertex) == 48, "shape record must match the Shape stream stride");

// The per-instance slot the ParticleInstance stream is laid out for (mirrors ParticlePlugin's).
struct TestParticleInstance {
    f32 px, py, pz;
    f32 sx, sy;
    f32 rotation;
    u32 color;
    f32 uvOffsetX, uvOffsetY;
    f32 uvScaleX, uvScaleY;
};
static_assert(sizeof(TestParticleInstance) == 44,
              "instance record must match the ParticleInstance stream stride");

}  // namespace

TEST_CASE("pool reports each stream's vertex stride (single source for baseVertex math)") {
    Harness h;
    CHECK(h.pool.vertexStride(LayoutId::Batch) == sizeof(BatchVertex));
    CHECK(h.pool.vertexStride(LayoutId::Shape) == sizeof(TestShapeVertex));
    CHECK(h.pool.vertexStride(LayoutId::ParticleInstance) == sizeof(TestParticleInstance));
}

TEST_CASE("appendQuad: Batch command with baseVertex-offset indices and one texture slot") {
    Harness h;
    BatchVertex quad[4] = {
        { {0, 0, 0}, 0xFFFFFFFFu, {0, 0} },
        { {1, 0, 0}, 0xFFFFFFFFu, {1, 0} },
        { {1, 1, 0}, 0xFFFFFFFFu, {1, 1} },
        { {0, 1, 0}, 0xFFFFFFFFu, {0, 1} },
    };
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    REQUIRE(h.list.commandCount() == 2);
    const DrawCommand& first = h.list.command(0);
    const DrawCommand& second = h.list.command(1);
    CHECK(first.layout_id == LayoutId::Batch);
    CHECK(first.index_count == 6);
    CHECK(first.vertex_count == 4);
    CHECK(first.texture_count == 1);
    CHECK(first.texture_ids[0] == 42);
    CHECK(first.instance_count == 0);
    // Second quad's vertices start at record 4, so its indices must be rebased there.
    CHECK(second.vertex_byte_offset == 4 * sizeof(BatchVertex));
    CHECK(second.index_offset == 6);
}

TEST_CASE("empty scissor regions allocate no quad geometry or draw command") {
    for (const auto size : {std::pair{0, 20}, std::pair{20, 0}, std::pair{-1, 20}}) {
        Harness h;
        BatchVertex quad[4] = {};
        auto blocked = quadKey(42); blocked.entity = Entity(91);
        h.clips.setScissor(91, 10, 20, size.first, size.second);
        h.clips.setStencilTestOutside(91, 3);
        appendQuad(h.pool, h.list, h.clips, quad, blocked);
        auto visible = quadKey(42); visible.entity = Entity(92);
        appendQuad(h.pool, h.list, h.clips, quad, visible);
        REQUIRE(h.list.commandCount() == 1);
        CHECK(h.list.command(0).entity == Entity(92));
        CHECK(h.list.command(0).vertex_byte_offset == 0);
        CHECK(h.list.command(0).index_offset == 0);
    }
}

TEST_CASE("empty scissors suppress direct and prebuilt-vertex submissions") {
    Harness h;
    auto blocked = quadKey(42); blocked.entity = Entity(91);
    h.clips.setScissor(91, 0, 0, 0, 0);
    pushBatchDraw(h.list, h.clips, 0, 4, 0, 6, blocked);
    const u32 indices[] = {0, 1, 2, 2, 3, 0};
    pushBatchCommand(h.pool, h.list, h.clips, 0, 4, indices, 6, blocked);
    CHECK(h.list.commandCount() == 0);
    BatchVertex quad[4] = {};
    auto visible = quadKey(42); visible.entity = Entity(92);
    appendQuad(h.pool, h.list, h.clips, quad, visible);
    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).index_offset == 0);
}

TEST_CASE("stencil-only entries and nonempty scissors still draw") {
    Harness h;
    BatchVertex quad[4] = {};
    auto stencil = quadKey(42); stencil.entity = Entity(91);
    h.clips.setStencilMask(91, 1);
    appendQuad(h.pool, h.list, h.clips, quad, stencil);
    auto clipped = quadKey(42); clipped.entity = Entity(92);
    h.clips.setScissor(92, 10, 20, 1, 1);
    appendQuad(h.pool, h.list, h.clips, quad, clipped);
    CHECK(h.list.commandCount() == 2);
}

TEST_CASE("appendIndexedDraw: non-Batch stream uses its own stride for baseVertex") {
    Harness h;
    TestShapeVertex verts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.type = RenderType::Shape;
    key.layoutId = LayoutId::Shape;

    appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, key);
    appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, key);

    REQUIRE(h.list.commandCount() == 2);
    CHECK(h.list.command(0).layout_id == LayoutId::Shape);
    // A textureless draw must not claim a sampler slot: texture_count is what
    // execute() binds, and zero of them is what "declares no sampler" looks like.
    CHECK(h.list.command(0).texture_count == 0);
    CHECK(h.list.command(1).vertex_byte_offset == 4 * sizeof(TestShapeVertex));
    // Indices rebased by the SHAPE stride (4 records), not the Batch stride.
    CHECK(h.list.command(1).index_offset == 6);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Shape) == 8 * sizeof(TestShapeVertex));
    CHECK(h.pool.indicesUsed(LayoutId::Shape) == 12);
}

TEST_CASE("pushBatchDraw: instanced key assembles an instanced command over static indices") {
    Harness h;
    u32 instOffset = h.pool.allocVertices(LayoutId::ParticleInstance, 3 * 40);
    BatchDrawKey key = quadKey(42);  // type tag irrelevant here (stats/capture only)
    key.layoutId = LayoutId::ParticleInstance;
    key.instanceCount = 3;

    pushBatchDraw(h.list, h.clips, instOffset, 0, 0, 6, key);

    REQUIRE(h.list.commandCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK(cmd.layout_id == LayoutId::ParticleInstance);
    CHECK(cmd.instance_count == 3);
    CHECK(cmd.index_offset == 0);
    CHECK(cmd.index_count == 6);
    CHECK(cmd.texture_count == 1);
    CHECK(cmd.texture_ids[0] == 42);
}

TEST_CASE("finalize: adjacent same-key Batch draws with different textures merge multi-texture") {
    Harness h;
    BatchVertex quad[4] = {
        { {0, 0, 0}, 0xFFFFFFFFu, {0, 0} },
        { {1, 0, 0}, 0xFFFFFFFFu, {1, 0} },
        { {1, 1, 0}, 0xFFFFFFFFu, {1, 1} },
        { {0, 1, 0}, 0xFFFFFFFFu, {0, 1} },
    };
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(43));

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const DrawCommand& merged = h.list.command(0);
    CHECK(merged.index_count == 12);
    CHECK(merged.texture_count == 2);
    CHECK(merged.texture_ids[0] == 42);
    CHECK(merged.texture_ids[1] == 43);
    // The second quad's staged vertices got their sampler slot stamped to 1.
    const auto* verts = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
    CHECK(verts[3].texIndex == 0.0f);
    CHECK(verts[4].texIndex == 1.0f);
    CHECK(verts[7].texIndex == 1.0f);
}

TEST_CASE("finalize: sorted Batch index gaps merge in painter order with their texture slots") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 3));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(11, 1));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(12, 2));
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const auto& cmd = h.list.command(0);
    REQUIRE(cmd.index_count == 18);
    const u32 expected[] = {4,5,6,6,7,4, 8,9,10,10,11,8, 0,1,2,2,3,0};
    const auto* indices = h.pool.indexData(LayoutId::Batch) + cmd.index_offset;
    for (u32 i = 0; i < 18; i++) CHECK(indices[i] == expected[i]);
    REQUIRE(cmd.texture_count == 3);
    CHECK(cmd.texture_ids[0] == 11);
    CHECK(cmd.texture_ids[1] == 12);
    CHECK(cmd.texture_ids[2] == 10);
    const auto* verts = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
    CHECK(verts[0].texIndex == 2);
    CHECK(verts[4].texIndex == 0);
    CHECK(verts[8].texIndex == 1);
}

TEST_CASE("camera mask: hidden text and skeletal submissions upload no geometry") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const glm::mat4 transform(1.0f);
    const f32 text[36] = {};
    const f32 skeletal[32] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    frame.begin(transform);
    frame.setCullingMask(1u << 6);
    const int uploads = device.updateBufferCalls;
    for (u32 i = 0; i < 1000; ++i) {
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 4, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 4, 0, 0, false);
    }
    frame.flush();
    CHECK(frame.stats().draw_calls == 0);
    CHECK(device.updateBufferCalls == uploads);
    frame.end();
    frame.begin(transform);
    frame.setCullingMask(1u << 6);
    frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 4, 0, false, 1u << 6);
    frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 6, 0, 0, false);
    frame.flush();
    CHECK(frame.stats().sprites == 0);
    CHECK(frame.stats().text == 1);
    CHECK(frame.stats().skeletal == 1);
    CHECK(frame.stats().triangles == 4);
}

TEST_CASE("nine-slice: small boxes contain their borders and preserve source UVs") {
    for (const glm::vec2 size : {glm::vec2{40, 30}, {10, 6}, {10, 30}, {40, 6}, {0, 6}, {10, 0}}) {
        Harness h;
        NineSlicePlugin plugin;
        const glm::vec3 position{13, 17, 0};
        const glm::vec2 pivot{.25f, .75f};
        plugin.emitNineSlice(h.pool, h.list, h.clips, position, size, pivot,
                            0, {100, 100}, {8, 12, 10, 6}, {0, 0}, {1, 1}, {1, 1, 1, 1}, quadKey(1));
        const u32 bytes = h.pool.vertexBytesUsed(LayoutId::Batch);
        if (size.x == 0 || size.y == 0) {
            CHECK(bytes == 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
            CHECK(h.list.commandCount() == 0);
            continue;
        }
        const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
        const u32 count = bytes / sizeof(BatchVertex);
        REQUIRE(count > 0);
        const glm::vec2 low = glm::vec2(position) - size * pivot;
        const glm::vec2 high = low + size;
        f32 area = 0;
        bool hasLeftUV = false, hasRightUV = false, hasBottomUV = false, hasTopUV = false;
        for (u32 i = 0; i < count; ++i) {
            CHECK(vertices[i].position.x >= low.x - .0001f);
            CHECK(vertices[i].position.x <= high.x + .0001f);
            CHECK(vertices[i].position.y >= low.y - .0001f);
            CHECK(vertices[i].position.y <= high.y + .0001f);
            hasLeftUV |= std::abs(vertices[i].texCoord.x - .08f) < .0001f;
            hasRightUV |= std::abs(vertices[i].texCoord.x - .88f) < .0001f;
            hasBottomUV |= std::abs(vertices[i].texCoord.y - .06f) < .0001f;
            hasTopUV |= std::abs(vertices[i].texCoord.y - .90f) < .0001f;
            if (i % 4 == 0) area += (vertices[i + 1].position.x - vertices[i].position.x)
                                  * (vertices[i + 3].position.y - vertices[i].position.y);
        }
        CHECK(area == doctest::Approx(size.x * size.y));
        CHECK(hasLeftUV);
        CHECK(hasRightUV);
        CHECK(hasBottomUV);
        CHECK(hasTopUV);
    }
}

TEST_CASE("nine-slice: signed transforms and UV flips preserve every cell") {
    NineSlicePlugin plugin;
    const glm::vec3 position{13, 17, 0};
    const glm::vec2 pivot{.25f, .75f}, uvOffset{.2f, .1f}, uvScale{.6f, .8f};
    for (const glm::vec2 size : {glm::vec2{40, 30}, {10, 6}}) {
        Harness reference;
        plugin.emitNineSlice(reference.pool, reference.list, reference.clips, position, size, pivot,
                            0, {100, 100}, {8, 12, 10, 6}, uvOffset, uvScale, {1, 1, 1, 1}, quadKey(1));
        const u32 bytes = reference.pool.vertexBytesUsed(LayoutId::Batch);
        const auto* original = reinterpret_cast<const BatchVertex*>(reference.pool.vertexData(LayoutId::Batch));
        for (f32 signX : {1.0f, -1.0f}) for (f32 signY : {1.0f, -1.0f}) {
            for (f32 flipX : {1.0f, -1.0f}) for (f32 flipY : {1.0f, -1.0f}) {
                for (f32 angle : {0.0f, .4f}) {
                    Harness h;
                    const glm::vec2 offset = uvOffset + glm::vec2(flipX < 0 ? uvScale.x : 0, flipY < 0 ? uvScale.y : 0);
                    plugin.emitNineSlice(h.pool, h.list, h.clips, position, size * glm::vec2(signX, signY), pivot,
                                        angle, {100, 100}, {8, 12, 10, 6}, offset, uvScale * glm::vec2(flipX, flipY),
                                        {1, 1, 1, 1}, quadKey(1));
                    REQUIRE(h.pool.vertexBytesUsed(LayoutId::Batch) == bytes);
                    CHECK(h.pool.indicesUsed(LayoutId::Batch) == reference.pool.indicesUsed(LayoutId::Batch));
                    const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
                    for (u32 i = 0; i < bytes / sizeof(BatchVertex); ++i) {
                        glm::vec2 local = glm::vec2(original[i].position) - glm::vec2(position);
                        if (flipX < 0) local.x = size.x * (1 - 2 * pivot.x) - local.x;
                        if (flipY < 0) local.y = size.y * (1 - 2 * pivot.y) - local.y;
                        local *= glm::vec2(signX, signY);
                        const glm::vec2 expected{position.x + local.x * std::cos(angle) - local.y * std::sin(angle),
                                                 position.y + local.x * std::sin(angle) + local.y * std::cos(angle)};
                        bool found = false;
                        for (u32 j = 0; j < bytes / sizeof(BatchVertex); ++j) {
                            found |= glm::length(glm::vec2(vertices[j].position) - expected) < .0001f
                                  && glm::length(vertices[j].texCoord - original[i].texCoord) < .0001f;
                        }
                        CHECK(found);
                    }
                }
            }
        }
    }
}

TEST_CASE("UI visuals: zero alpha skips geometry and a restored fade draws again") {
    for (auto mode : {ecs::UIVisualType::SolidColor, ecs::UIVisualType::Image,
                      ecs::UIVisualType::NineSlice, ecs::UIVisualType::Tiled,
                      ecs::UIVisualType::Filled}) {
        for (bool inherited : {false, true}) {
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            ecs::Registry registry;
            const auto entity = registry.create();
            registry.emplace<ecs::Transform>(entity);
            auto& node = registry.emplace<ecs::UINode>(entity);
            node.computed_size_ = {20, 20};
            auto& visual = registry.emplace<ecs::UIVisual>(entity);
            visual.visualType = mode;
            visual.sliceBorder = {2, 2, 2, 2};
            visual.fillMethod = ecs::UIFillMethod::Radial360;
            visual.fillAmount = .5f;
            if (inherited) node.alpha_in_tree_ = 0;
            else visual.color.a = 0;
            RenderFrameContext frameContext{context, resources};
            frameContext.purpose = RenderPurpose::ScreenOverlay;
            std::unordered_set<u32> screen{entity.id()};
            Frustum frustum;
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            collect.screen_ui = &screen;
            UIElementPlugin plugin;
            plugin.init(frameContext);
            plugin.collect(collect);
            CHECK(h.list.commandCount() == 0);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
            node.alpha_in_tree_ = .5f;
            visual.color.a = 1;
            plugin.collect(collect);
            CHECK(h.list.commandCount() > 0);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) > 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) > 0);
        }
    }
}

TEST_CASE("UI visuals: transparent stencil masks and custom materials retain geometry") {
    for (int kind : {0, 1, 2}) {
        Harness h;
        RenderContext context(h.device);
        resource::ResourceManager resources;
        ecs::Registry registry;
        const auto entity = registry.create();
        registry.emplace<ecs::Transform>(entity);
        auto& node = registry.emplace<ecs::UINode>(entity);
        node.computed_size_ = {20, 20};
        node.alpha_in_tree_ = 0;
        auto& visual = registry.emplace<ecs::UIVisual>(entity);
        visual.visualType = ecs::UIVisualType::SolidColor;
        if (kind == 0) visual.material = 42;
        if (kind == 1) registry.emplace<ecs::UIMask>(entity).mode = ecs::MaskMode::Stencil;
        if (kind == 2) h.clips.setStencilMask(entity.id(), 1);
        RenderFrameContext frameContext{context, resources};
        frameContext.purpose = RenderPurpose::ScreenOverlay;
        std::unordered_set<u32> screen{entity.id()};
        Frustum frustum;
        RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
        collect.screen_ui = &screen;
        UIElementPlugin plugin;
        plugin.init(frameContext);
        plugin.collect(collect);
        CHECK(h.list.commandCount() == 1);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    }
}

TEST_CASE("camera passes: empty text and skeletal clips recover on the next camera") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const glm::mat4 transform(1.0f);
    const f32 text[36] = {};
    const f32 skeletal[32] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    for (const auto& size : {std::pair{0, 10}, std::pair{10, 0}, std::pair{-1, 10}, std::pair{10, -1}}) {
        frame.beginFrame();
        frame.begin(transform);
        frame.setEntityClipRect(1, 0, 0, size.first, size.second);
        frame.setEntityClipRect(2, 0, 0, size.first, size.second);
        frame.collectAll(registry);
        const int uploads = device.updateBufferCalls;
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 0, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 0, 0, 0, false);
        frame.flush();
        CHECK(device.updateBufferCalls == uploads);
        CHECK(frame.stats().draw_calls == 0);
        frame.end();

        frame.begin(transform);
        frame.clearAllClipRects();
        frame.collectAll(registry);
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 0, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 0, 0, 0, false);
        frame.flush();
        CHECK(frame.stats().text == 1);
        CHECK(frame.stats().skeletal == 1);
        CHECK(frame.stats().triangles == 4);
        frame.end();
        frame.endFrame();
    }
}

TEST_CASE("camera mask: excluded bulk geometry does not enter transient streams") {
    for (LayoutId layout : {LayoutId::Batch, LayoutId::Shape}) {
        Harness h;
        h.list.setCullingMask(1u << 6);
        auto hidden = quadKey(1, 4);
        hidden.layoutId = layout;
        BatchVertex quad[4] = {};
        TestShapeVertex shape[4] = {};
        const void* verts = layout == LayoutId::Batch ? static_cast<const void*>(quad)
                                                     : static_cast<const void*>(shape);
        for (u32 i = 0; i < 10000; ++i) {
            appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, hidden);
        }
        CHECK(h.list.commandCount() == 0);
        CHECK(h.pool.vertexBytesUsed(layout) == 0);
        CHECK(h.pool.indicesUsed(layout) == 0);

        h.list.setSortingGroup(31, {6, 0, false, 0});
        hidden.entity = Entity(31);
        appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, hidden);
        CHECK(h.list.commandCount() == 1);
        CHECK(h.pool.vertexBytesUsed(layout) == 4 * h.pool.vertexStride(layout));
        CHECK(h.pool.indicesUsed(layout) == 6);
    }
}

TEST_CASE("camera mask: resident geometry skips excluded indices with both source widths") {
    Harness h;
    h.list.setCullingMask(1u << 6);
    BatchVertex quad[4] = {};
    const u32 offset = h.pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
    const u16 indices16[] = {0, 1, 2, 2, 3, 0};
    auto hidden = quadKey(1, 4);
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, BATCH_QUAD_INDICES, 6, hidden);
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, indices16, 6, hidden);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == sizeof(quad));
    CHECK(h.list.commandCount() == 0);
    hidden.cullBit = 1u << 6;
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, indices16, 6, hidden);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    CHECK(h.list.commandCount() == 1);
    auto excludedGroup = quadKey(1, 6);
    excludedGroup.entity = Entity(32);
    h.list.setSortingGroup(32, {4, 0, false, 0});
    appendQuad(h.pool, h.list, h.clips, quad, excludedGroup);
    auto excludedBit = quadKey(1, 6);
    excludedBit.cullBit = 1u << 4;
    appendQuad(h.pool, h.list, h.clips, quad, excludedBit);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == sizeof(quad));
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    CHECK(h.list.commandCount() == 1);
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(1, -1));
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 12);
    CHECK(h.list.commandCount() == 2);
}

TEST_CASE("finalize: full texture slots reject index copies but allow existing textures") {
    for (bool masked : {false, true}) {
        for (bool reuse : {false, true}) {
            Harness h;
            if (masked) {
                h.list.reserveMask2DSlots(1);
                h.list.setMask2DTexture(7, 123);
            }
            const u32 budget = MAX_CMD_TEXTURE_SLOTS - (masked ? 1 : 0);
            BatchVertex quad[4] = {};
            appendQuad(h.pool, h.list, h.clips, quad, quadKey(reuse ? 1 : 99, 2));
            for (u32 texture = 1; texture <= budget; ++texture) {
                appendQuad(h.pool, h.list, h.clips, quad, quadKey(texture, 1));
            }
            const u32 emitted = h.pool.indicesUsed(LayoutId::Batch);
            h.list.finalize(h.pool);
            CHECK(h.list.mergedDrawCallCount() == (reuse ? 1 : 2));
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == emitted + (reuse ? 6 : 0));
            CHECK(h.list.command(0).texture_count == budget);
            CHECK(h.list.command(0).index_count == (budget + (reuse ? 1 : 0)) * 6);
            if (!reuse) {
                CHECK(h.list.command(1).index_offset == 0);
                CHECK(h.list.command(1).break_reason == BatchBreak::TextureSlots);
            }
        }
    }
}

TEST_CASE("index range copies survive staging growth and reject unwritten sources") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(64, 2);
    const u32 values[] = {9,8,7,6,5,4};
    pool.appendIndices(LayoutId::Batch, values, 6);
    u32 at = 99;
    REQUIRE(pool.copyIndexRange(LayoutId::Batch, 0, 6, at));
    CHECK(at == 6);
    for (u32 i = 0; i < 6; i++) CHECK(pool.indexData(LayoutId::Batch)[at + i] == values[i]);
    CHECK_FALSE(pool.copyIndexRange(LayoutId::Batch, 12, 1, at));
    CHECK_FALSE(pool.copyIndexRange(LayoutId::Batch, 0, 13, at));
    CHECK(pool.indicesUsed(LayoutId::Batch) == 12);
    pool.shutdown();
}

TEST_CASE("finalize: mixed Sprite and Text runs preserve source type counts") {
    Harness h;
    BatchVertex quad[4] = {};
    auto sprite = quadKey(10, 2), text = quadKey(11, 1);
    text.type = RenderType::Text;
    appendQuad(h.pool, h.list, h.clips, quad, sprite);
    appendQuad(h.pool, h.list, h.clips, quad, text);
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.sourceEntityCount(RenderType::Sprite) == 1);
    CHECK(h.list.sourceEntityCount(RenderType::Text) == 1);
    h.list.clear();
    CHECK(h.list.sourceEntityCount(RenderType::Sprite) == 0);
    CHECK(h.list.sourceEntityCount(RenderType::Text) == 0);
}

TEST_CASE("finalize: external Batch buffers retain their separate index ranges") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 2));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 1));
    auto a = h.list.command(0), b = h.list.command(1);
    a.vertex_buffer = b.vertex_buffer = static_cast<BufferHandle>(123);
    h.list.clear(); h.list.push(a); h.list.push(b);
    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 12);
}

TEST_CASE("merge identity: depth bias and geometry bindings must agree") {
    DrawCommand a{}, b{};
    a.shader_id = b.shader_id = 7;
    a.index_count = b.index_count = 6;
    b.index_offset = 6;
    CHECK(a.canMergeWith(b));
    SUBCASE("depth bias") {
        b.depth_bias = 1;
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("vertex buffer") {
        a.vertex_buffer = static_cast<BufferHandle>(11);
        b.vertex_buffer = static_cast<BufferHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("index buffer") {
        a.index_buffer = static_cast<BufferHandle>(11);
        b.index_buffer = static_cast<BufferHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("vertex layout") {
        a.vertex_layout = static_cast<VertexLayoutHandle>(11);
        b.vertex_layout = static_cast<VertexLayoutHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
}

TEST_CASE("finalize: different streams never coalesce; instanced draws stay one per emitter") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    TestShapeVertex sverts[4] = {};
    BatchDrawKey shapeKey = quadKey(0);
    shapeKey.layoutId = LayoutId::Shape;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, shapeKey);

    BatchDrawKey inst = quadKey(42);
    inst.layoutId = LayoutId::ParticleInstance;
    inst.instanceCount = 2;
    pushBatchDraw(h.list, h.clips, 0, 0, 0, 6, inst);
    pushBatchDraw(h.list, h.clips, 80, 0, 0, 6, inst);

    h.list.finalize(h.pool);
    // Batch quad + shape + two instanced draws: nothing merges across these.
    CHECK(h.list.mergedDrawCallCount() == 4);
}

/**
 * A resident-mesh draw as MeshPlugin submits one: the mesh's own buffers, one
 * per-object record in the frame's stream, opaque so its order does not matter.
 * `z` goes into the record so a test can see WHICH instances a merged draw holds.
 */
BatchDrawKey meshKey(u32 meshBuffer, u32 textureId = 0) {
    BatchDrawKey key{};
    key.stage = RenderStage::Opaque;
    key.shaderId = 11;
    key.blend = BlendMode::None;
    key.depthTest = true;
    key.depthWrite = true;
    key.textureId = textureId;
    key.type = RenderType::Mesh;
    key.layoutId = LayoutId::MeshInstance;
    key.instanceCount = 1;
    key.instanceStride = 68;
    key.vertexBuffer = BufferHandle{meshBuffer};
    key.indexBuffer = BufferHandle{meshBuffer + 100};
    // ONE layout for every mesh with these channels, which is what the resource
    // layer hands out: two meshes differ by their buffers, not by their shape.
    // A fixture giving each its own would let a missing buffer check pass.
    key.vertexLayout = VertexLayoutHandle{200};
    return key;
}

/** Submits one instance of `key`'s mesh, tagging its record with `mark`. */
u32 pushMeshInstance(Harness& h, const BatchDrawKey& key, f32 mark, f32 depth = 0.0f) {
    const u32 at = h.pool.allocVertices(LayoutId::MeshInstance, key.instanceStride);
    auto* rec = reinterpret_cast<f32*>(h.pool.vertexData(LayoutId::MeshInstance) + at);
    *rec = mark;
    BatchDrawKey k = key;
    k.depth = depth;
    pushBatchDraw(h.list, h.clips, at, 0, 0, 36, k);
    return at;
}

/** The mark each instance of a merged draw carries, read back from the stream. */
std::vector<f32> instanceMarks(Harness& h, const DrawCommand& cmd) {
    std::vector<f32> out;
    const u8* base = h.pool.vertexData(LayoutId::MeshInstance) + cmd.vertex_byte_offset;
    for (u32 i = 0; i < cmd.instance_count; ++i) {
        out.push_back(*reinterpret_cast<const f32*>(base + i * cmd.instance_stride));
    }
    return out;
}

TEST_CASE("finalize: the same mesh drawn three times is one instanced draw") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    // Depths chosen so the sort REORDERS them: written 1,2,3 and drawn nearest
    // first (opaque is front-to-back), so the run is z=30,20,10 — marks 2,3,1,
    // with no two records adjacent in the pool. Relocation is why this merges.
    pushMeshInstance(h, key, 1.0f, 10.0f);
    pushMeshInstance(h, key, 2.0f, 30.0f);
    pushMeshInstance(h, key, 3.0f, 20.0f);

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK(cmd.instance_count == 3);
    CHECK(cmd.index_count == 36);  // one mesh's indices, not three meshes' worth
    CHECK(cmd.entity_count == 3);
    // Every instance is present, in the order the draw will read them.
    CHECK(instanceMarks(h, cmd) == std::vector<f32>{2.0f, 3.0f, 1.0f});
}

/** Two mesh draws, the second differing only as `vary` says. How many draws survive. */
u32 drawsAfterMerge(const std::function<void(BatchDrawKey&, u32&)>& vary) {
    Harness h;
    const BatchDrawKey base = meshKey(5);
    BatchDrawKey second = base;
    u32 indexOffset = 0;
    vary(second, indexOffset);

    for (const auto& [key, at] : { std::pair{base, 0u}, std::pair{second, indexOffset} }) {
        const u32 rec = h.pool.allocVertices(LayoutId::MeshInstance, key.instanceStride);
        pushBatchDraw(h.list, h.clips, rec, 0, at, 36, key);
    }
    h.list.finalize(h.pool);
    return h.list.mergedDrawCallCount();
}

TEST_CASE("finalize: two mesh draws alike but for one thing stay two draws") {
    // Each case varies ONE thing and leaves the pair adjacent in the sort, so
    // the check under test is the only thing that can separate them. A fixture
    // where something else also differs would pass with the check deleted.
    CHECK(drawsAfterMerge([](BatchDrawKey&, u32&) {}) == 1);  // the control

    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.vertexBuffer = BufferHandle{6};                     // another mesh
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.indexBuffer = BufferHandle{106};
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey&, u32& indexOffset) {
        indexOffset = 36;                                     // another range of it
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.textureId = 42;                                     // samplers are per draw
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.materialId = 9;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.cull = 1;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.shaderId = 12;
    }) == 2);

    // Order-dependence, one property at a time. Each of these alone makes the
    // second draw one whose result depends on when it happens, and the head is
    // the opaque one — so a check that asks only about ITSELF passes them all.
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.blend = BlendMode::Normal;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.depthTest = false;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.depthWrite = false;
    }) == 2);
}

TEST_CASE("finalize: the HEAD's own order-dependence stops a merge too") {
    // A material can say `blend: none, depthWrite: false`: nothing reads what
    // is behind and nothing records what is in front, so the last draw wins.
    // Submitted first it is the head, which only a check on ITS state refuses.
    Harness h;
    BatchDrawKey unordered = meshKey(5);
    unordered.depthWrite = false;
    pushMeshInstance(h, unordered, 1.0f, 20.0f);
    pushMeshInstance(h, meshKey(5), 2.0f, 20.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: a blended mesh keeps its own draw, because its order is the result") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    key.stage = RenderStage::Transparent;
    key.blend = BlendMode::Normal;
    key.depthWrite = false;
    pushMeshInstance(h, key, 1.0f, 10.0f);
    pushMeshInstance(h, key, 2.0f, 20.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: an opaque head does not swallow a blended draw of the same mesh") {
    // The asymmetric case, and the one a pixel gate caught: asking only whether
    // THIS draw is opaque lets an opaque head absorb a blended sibling and paint
    // it with the head's own state — the blended one then hides what is behind it.
    Harness h;
    pushMeshInstance(h, meshKey(5), 1.0f, 20.0f);

    // Same stage on purpose — what MeshPlugin submits when one of two meshes
    // has `opaque` off, and what puts the pair next to each other. Giving the
    // blended one its own stage would sort them apart and prove nothing.
    BatchDrawKey blended = meshKey(5);
    blended.blend = BlendMode::Normal;
    blended.depthTest = false;
    pushMeshInstance(h, blended, 2.0f, 10.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: a skinned mesh keeps its own draw, because a pose is per draw") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    key.instanceStride = 4;
    key.skinCount = 2;
    key.skinOffset = 0;
    pushMeshInstance(h, key, 1.0f);
    pushMeshInstance(h, key, 2.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("execute: a merged mesh draw asks the device for its instances in one call") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    for (int i = 0; i < 4; ++i) pushMeshInstance(h, key, static_cast<f32>(i));

    h.list.finalize(h.pool);
    h.pool.upload();
    MaterialStore materials;
    h.list.execute(h.device, h.pool, materials, 1);

    CHECK(h.device.drawElementsInstancedCalls == 1);
    CHECK(h.device.lastDrawInstanceCount == 4);
    CHECK(h.device.lastDrawIndexCount == 36);
}

TEST_CASE("execute: a sampling draw pins every sampler unit it does not use") {
    // A unit a draw leaves alone keeps what the draw BEFORE it bound, across passes
    // and frames. So a draw states its whole sampler block or none of it: one that
    // leaves unit 2 alone samples the shadow atlas a shadow pass is drawing into.
    Harness h;
    MaterialStore materials;
    const u32 white = 99;

    BatchDrawKey key = meshKey(5, /*textureId=*/7);  // albedo only: texture_count == 1
    pushMeshInstance(h, key, 1.0f);
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials, white);

    u32 boundAt[MAX_CMD_TEXTURE_SLOTS] = {};
    bool seen[MAX_CMD_TEXTURE_SLOTS] = {};
    bool record = false;
    for (const auto& [unit, tex] : h.device.bindLog) {
        // The frame's per-object record rides its own unit above the draw's eight.
        if (unit == MESH_INSTANCE_TEXTURE_UNIT) {
            record = true;
            continue;
        }
        REQUIRE(unit < MAX_CMD_TEXTURE_SLOTS);
        boundAt[unit] = static_cast<u32>(tex);
        seen[unit] = true;
    }
    CHECK(record);
    for (u32 unit = 0; unit < MAX_CMD_TEXTURE_SLOTS; ++unit) {
        CHECK(seen[unit]);  // no unit left to whatever ran before
        CHECK(boundAt[unit] == (unit == 0 ? 7u : white));
    }
}

TEST_CASE("execute: a textureless stream declares no sampler and is left alone") {
    // The other half of the same rule: the shape stream samples nothing, so it
    // declares nothing, so there is no binding for stale state to land in.
    Harness h;
    MaterialStore materials;

    TestShapeVertex sverts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.layoutId = LayoutId::Shape;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, key);

    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials, 99);

    CHECK(h.device.bindLog.empty());
}

TEST_CASE("clip state is stamped onto commands from every stream") {
    Harness h;
    Entity clipped{5};
    h.clips.setScissor(clipped.id(), 1, 2, 3, 4);

    TestShapeVertex sverts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.layoutId = LayoutId::Shape;
    key.entity = clipped;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, key);

    REQUIRE(h.list.commandCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK((cmd.state_flags & CMD_STATE_SCISSOR) != 0);
    CHECK(cmd.scissor.x == 1);
    CHECK(cmd.scissor.h == 4);
}

TEST_CASE("execute: indexed and instanced commands dispatch through the device") {
    Harness h;
    MaterialStore materials;

    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    BatchDrawKey inst = quadKey(42);
    inst.layoutId = LayoutId::ParticleInstance;
    inst.instanceCount = 5;
    pushBatchDraw(h.list, h.clips, 0, 0, 0, 6, inst);

    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.drawElementsCalls == 1);
    CHECK(h.device.drawElementsInstancedCalls == 1);
    CHECK(h.device.lastDrawInstanceCount == 5);
    CHECK(h.device.setPipelineCalls == 2);
}

// The sort key ranks layer above stage, and both of these pin that down. Swapping the
// two fields back (stage on top, the classic 3D pipeline order) flips the first check
// and leaves the second passing — which is exactly the failure the old layout had:
// correct inside a layer, and silently wrong across layers. Every other case in this
// file submits Transparent only, so neither would have been caught here.
TEST_CASE("sort order: a lower sorting layer draws first even when a higher one is opaque") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey opaqueAbove = quadKey(50, /*layer=*/5);
    opaqueAbove.stage = RenderStage::Opaque;
    // A different shader only keeps the two from coalescing, so their order stays
    // observable; shader ranks below both fields under test.
    opaqueAbove.shaderId = 8;
    appendQuad(h.pool, h.list, h.clips, quad, opaqueAbove);
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(51, /*layer=*/3));

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 51);
    CHECK(h.list.command(1).texture_ids[0] == 50);
}

TEST_CASE("sort order: inside one layer, opaque draws before blended") {
    Harness h;
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(60, /*layer=*/4));
    BatchDrawKey opaque = quadKey(61, /*layer=*/4);
    opaque.stage = RenderStage::Opaque;
    opaque.shaderId = 8;
    appendQuad(h.pool, h.list, h.clips, quad, opaque);

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 61);
    CHECK(h.list.command(1).texture_ids[0] == 60);
}

// Opaque is a blend MODE, not a switch beside one — so "no blending" has to survive
// the trip from the draw's blend field to the pipeline the device is handed. Without
// this the scene path hardcoded blendEnabled, and an opaque material silently kept
// reading the destination it was asking to replace.
TEST_CASE("execute: BlendMode::None turns blending off in the resolved pipeline") {
    Harness h;
    MaterialStore materials;
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42);
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.lastPipelineDesc.blend == BlendMode::None);
    CHECK(h.device.lastPipelineDesc.blendEnabled == false);
}

TEST_CASE("execute: every other blend mode leaves blending on") {
    Harness h;
    MaterialStore materials;
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.lastPipelineDesc.blend == BlendMode::Normal);
    CHECK(h.device.lastPipelineDesc.blendEnabled == true);
}

// Two draws that agree on everything the merge used to look at, and disagree on
// whether they write depth. Before a layer could derive depth state from its stage,
// equal material_id implied equal depth state and this could not arise; now it can,
// and merging them would hand one of them the other's depth behaviour.
TEST_CASE("finalize: draws with different depth state never coalesce") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey writes = quadKey(42);
    writes.depthWrite = true;
    appendQuad(h.pool, h.list, h.clips, quad, writes);

    BatchDrawKey reads = quadKey(43);
    reads.depthWrite = false;
    appendQuad(h.pool, h.list, h.clips, quad, reads);

    h.list.finalize(h.pool);

    CHECK(h.list.mergedDrawCallCount() == 2);
}

// A depth layer resolves its own stage and depth state from the one physical fact
// that decides them: whether the draw reads the destination. Nobody declares this
// per material, because getting it wrong is not a preference — a blended draw that
// writes depth clips its neighbours into black edges.
TEST_CASE("depth layer: an opaque draw writes depth and lands in the Opaque stage") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42, /*layer=*/4);
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Opaque);
    CHECK(h.list.command(0).depth_test == true);
    CHECK(h.list.command(0).depth_write == true);
}

TEST_CASE("depth layer: a blended draw tests depth but never writes it") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42, /*layer=*/4));

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Transparent);
    CHECK(h.list.command(0).depth_test == true);
    CHECK(h.list.command(0).depth_write == false);
}

// The whole point of making it a layer property: a project that declares no depth
// layer must render exactly as it did, down to the pipeline state.
TEST_CASE("depth layer: a painter layer is untouched by the opt-in") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42, /*layer=*/5);  // not the depth layer
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Transparent);
    CHECK(h.list.command(0).depth_test == false);
}

// Y-sort is a depth projected from world Y; real depth is the thing itself. A layer
// claiming both has said two contradictory things, and y-sort wins so that a project
// which had it keeps rendering as it did.
TEST_CASE("depth layer: y-sort wins when a layer declares both") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    h.list.setDepthMask(1u << 4);

    CHECK(h.list.layerOrder(4) == DrawList::LayerOrder::YSort);
    CHECK(h.list.layerOrder(5) == DrawList::LayerOrder::Painter);
}

// ─── Order within a layer ────────────────────────────────────────────────────
// The author's explicit answer to "what is on top of what", inside one layer. Each case
// below is one the layer's own ordering gets wrong on purpose, so it measures an override.

// Each pair gets two shaders, which keeps them from coalescing into one multi-texture
// draw and leaves their order observable. Shader ranks below every field under test.

TEST_CASE("order: a higher order draws on top of a nearer sprite") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey near = quadKey(1, /*layer=*/3);
    near.depth = 50.0f;   // nearest — depth alone would put it last
    BatchDrawKey far = quadKey(2, /*layer=*/3);
    far.depth = -50.0f;
    far.order = 1;
    far.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, near);
    appendQuad(h.pool, h.list, h.clips, quad, far);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// The gap this field was added for. A y-sorted layer drops z from the key entirely, so
// before this there was NO way to pin a draw inside one — a shadow that must stay under
// its owner had only the owner's own Y to argue with.
TEST_CASE("order: inside a y-sorted layer, a stated order beats world Y") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    BatchVertex quad[4] = {};

    // Lower Y draws last under y-sort, so this one would land on top unaided.
    BatchDrawKey low = quadKey(1, /*layer=*/4);
    low.y = -100.0f;
    BatchDrawKey high = quadKey(2, /*layer=*/4);
    high.y = 100.0f;
    high.order = 1;
    high.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// Y-sort still orders everything the author did not speak for. Without this, a field
// that simply disabled y-sort would pass every other case here.
TEST_CASE("order: equal orders leave y-sort to decide") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey low = quadKey(1, /*layer=*/4);  low.y = -100.0f;
    BatchDrawKey high = quadKey(2, /*layer=*/4); high.y = 100.0f; high.shaderId = 8;
    low.order = high.order = 5;                  // stated, and stated the same

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);  // higher Y is further back
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// An order is a promise about one layer's contents, never about the layer itself.
TEST_CASE("order: the largest order never escapes its own layer") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey shouted = quadKey(1, /*layer=*/3);
    shouted.order = 127;
    BatchDrawKey above = quadKey(2, /*layer=*/4);
    above.order = -128;
    above.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, shouted);
    appendQuad(h.pool, h.list, h.clips, quad, above);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).layer == 3);
    CHECK(h.list.command(1).layer == 4);
}

// Biased, not masked: -1 has to land below 0 rather than wrapping to the top of the
// field, which is what a two's-complement cast into the key would have done.
TEST_CASE("order: a negative order sinks below an unstated one") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey plain = quadKey(1, /*layer=*/3);
    BatchDrawKey behind = quadKey(2, /*layer=*/3);
    behind.order = -1;
    behind.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, plain);
    appendQuad(h.pool, h.list, h.clips, quad, behind);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// Clamped, not wrapped. A project ported from an engine with a wider range keeps the
// SIGN of what it asked for: "far on top" degrades to "on top", never to "behind".
TEST_CASE("order: an order past the range pins to the end it ran past") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey huge = quadKey(1, /*layer=*/3);
    huge.order = 32000;
    BatchDrawKey tiny = quadKey(2, /*layer=*/3);
    tiny.order = -32000;
    tiny.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, huge);
    appendQuad(h.pool, h.list, h.clips, quad, tiny);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// Order outranks stage for the same reason layer does: it is a promise the author made,
// and a stage is only how a layer groups what it holds. An opaque draw the author put
// underneath must stay underneath, early-z or not.
TEST_CASE("order: a blended draw ordered below an opaque one still draws first") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey blended = quadKey(1, /*layer=*/3);
    blended.order = -1;
    BatchDrawKey opaque = quadKey(2, /*layer=*/3);
    opaque.stage = RenderStage::Opaque;
    opaque.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, opaque);
    appendQuad(h.pool, h.list, h.clips, quad, blended);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// BlendMode::None is 9 and the key's blend field is 3 bits, so unmasked it set a bit in
// the SHADER field above it. Painter-ordered on purpose: a depth layer routes a None
// blend to the Opaque stage, never reaching the blended packing where the spill showed.
TEST_CASE("sort key: an opaque blend mode cannot reach the shader field") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey none = quadKey(1, /*layer=*/3);
    none.blend = BlendMode::None;
    BatchDrawKey normal = quadKey(2, /*layer=*/3);

    // Same shader, same depth, same everything the key ranks above blend: whatever
    // separates them is the blend field, and it may not reach past its own 3 bits.
    CHECK((DrawCommand::buildSortKey(RenderStage::Transparent, 3, none.shaderId,
                                     BlendMode::None, 0, 0.0f) >> 10)
          == (DrawCommand::buildSortKey(RenderStage::Transparent, 3, normal.shaderId,
                                        BlendMode::Normal, 0, 0.0f) >> 10));

    appendQuad(h.pool, h.list, h.clips, quad, none);
    appendQuad(h.pool, h.list, h.clips, quad, normal);
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 2);
}

// ─── Stencil mask ordering ───────────────────────────────────────────────────
// A stencil write must precede the draws that test it, and the sort key holds no
// clip state. The layer does it: UI pre-order puts a parent below its descendants.

TEST_CASE("stencil: the mask outranks its content even when material and depth fight it") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity maskEntity{11};
    Entity contentEntity{12};

    // Worst case the UI tree can produce: the mask is the parent (lower uiOrder →
    // lower layer) but loses on every field below layer.
    BatchDrawKey mask = quadKey(1, /*layer=*/1000);
    mask.entity = maskEntity;
    mask.materialId = 90000;   // sorts after the content's material
    mask.depth = 100.0f;       // nearest — would sort last within a transparent layer
    h.clips.setStencilMask(maskEntity.id(), 1);

    BatchDrawKey content = quadKey(2, /*layer=*/1001);
    content.entity = contentEntity;
    content.materialId = 1;
    content.depth = -100.0f;
    h.clips.setStencilTest(contentEntity.id(), 1);

    // Submitted content-first, so only the sort can put them right.
    appendQuad(h.pool, h.list, h.clips, quad, content);
    appendQuad(h.pool, h.list, h.clips, quad, mask);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_TEST) != 0);
}

TEST_CASE("stencil: a nested mask still writes before the content it clips") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity outer{20}, inner{21}, leaf{22};

    // outer(layer 1000) → inner mask(1001) → leaf(1002), each on its own material.
    BatchDrawKey outerKey = quadKey(1, 1000);
    outerKey.entity = outer;
    outerKey.materialId = 7;
    h.clips.setStencilMask(outer.id(), 1);

    BatchDrawKey innerKey = quadKey(2, 1001);
    innerKey.entity = inner;
    innerKey.materialId = 300;
    h.clips.setStencilMask(inner.id(), 2);

    BatchDrawKey leafKey = quadKey(3, 1002);
    leafKey.entity = leaf;
    leafKey.materialId = 4;
    h.clips.setStencilTest(leaf.id(), 2);

    appendQuad(h.pool, h.list, h.clips, quad, leafKey);
    appendQuad(h.pool, h.list, h.clips, quad, innerKey);
    appendQuad(h.pool, h.list, h.clips, quad, outerKey);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 3);
    CHECK(h.list.command(0).stencil_ref == 1);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK(h.list.command(1).stencil_ref == 2);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK(h.list.command(2).stencil_ref == 2);
    CHECK((h.list.command(2).state_flags & CMD_STATE_STENCIL_TEST) != 0);
}

// Where the guarantee stops. Nothing the engine emits puts a mask and its content
// on one layer; a caller reaching for renderer_setEntityStencilMask directly can.
TEST_CASE("stencil: on one layer, material — not submission or depth — decides") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity a{31}, b{32};

    BatchDrawKey writer = quadKey(1, /*layer=*/1000);
    writer.entity = a;
    writer.materialId = 90000;
    h.clips.setStencilMask(a.id(), 1);

    BatchDrawKey tester = quadKey(2, /*layer=*/1000);
    tester.entity = b;
    tester.materialId = 1;
    h.clips.setStencilTest(b.id(), 1);

    appendQuad(h.pool, h.list, h.clips, quad, writer);
    appendQuad(h.pool, h.list, h.clips, quad, tester);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The lower material wins, so the test lands FIRST — the mask is written after
    // the thing it was supposed to clip.
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_TEST) != 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
}

// ─── Blended depth ordering ──────────────────────────────────────────────────
// A blended draw composites onto what is already there, so back-to-front IS the
// result. Material may not outrank it — batching is the thing that yields.

TEST_CASE("transparent: back-to-front holds across materials") {
    Harness h;
    BatchVertex quad[4] = {};

    // Camera looks down -z, so larger z is nearer and must land last.
    BatchDrawKey near = quadKey(1, /*layer=*/3);
    near.materialId = 1;          // lowest material — would have sorted first
    near.depth = 50.0f;

    BatchDrawKey middle = quadKey(2, /*layer=*/3);
    middle.materialId = 90000;
    middle.depth = 0.0f;

    BatchDrawKey far = quadKey(3, /*layer=*/3);
    far.materialId = 500;
    far.depth = -50.0f;

    appendQuad(h.pool, h.list, h.clips, quad, near);
    appendQuad(h.pool, h.list, h.clips, quad, middle);
    appendQuad(h.pool, h.list, h.clips, quad, far);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 3);
    CHECK(h.list.command(0).texture_ids[0] == 3);  // far
    CHECK(h.list.command(1).texture_ids[0] == 2);  // middle
    CHECK(h.list.command(2).texture_ids[0] == 1);  // near
}

TEST_CASE("transparent: equal depth still groups by material for the merge") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey a1 = quadKey(1, 3); a1.materialId = 7; a1.depth = 0.0f;
    BatchDrawKey b = quadKey(2, 3);  b.materialId = 8;  b.depth = 0.0f;
    BatchDrawKey a2 = quadKey(3, 3); a2.materialId = 7; a2.depth = 0.0f;

    // Submitted adjacent so their index ranges stay contiguous — the merge needs
    // that as well as adjacency after the sort.
    appendQuad(h.pool, h.list, h.clips, quad, a1);
    appendQuad(h.pool, h.list, h.clips, quad, a2);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).material_id == 7);
    CHECK(h.list.command(1).material_id == 8);
}

TEST_CASE("opaque: material still outranks depth, since order cannot change the result") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey a1 = quadKey(1, 3); a1.stage = RenderStage::Opaque;
    a1.blend = BlendMode::None; a1.materialId = 7; a1.depth = 100.0f;
    BatchDrawKey b = quadKey(2, 3);  b.stage = RenderStage::Opaque;
    b.blend = BlendMode::None;  b.materialId = 8;  b.depth = 0.0f;
    BatchDrawKey a2 = quadKey(3, 3); a2.stage = RenderStage::Opaque;
    a2.blend = BlendMode::None; a2.materialId = 7; a2.depth = -100.0f;

    appendQuad(h.pool, h.list, h.clips, quad, a1);
    appendQuad(h.pool, h.list, h.clips, quad, a2);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    // Both material-7 draws coalesce despite straddling material 8 in depth.
    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).material_id == 7);
    CHECK(h.list.command(1).material_id == 8);
}

// 20 bits is sign + exponent + 11 mantissa bits, so the step is ~2^-11 of the
// exponent's range: about 0.004 around z=10. Closer than that shares a key and
// keeps submission order, which is the quantization talking, not a rule.
TEST_CASE("transparent: sorted index runs preserve distinct depth keys and quantized ties") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey nearer = quadKey(1, 3); nearer.materialId = 1; nearer.depth = 10.01f;
    BatchDrawKey farther = quadKey(2, 3); farther.materialId = 1; farther.depth = 10.00f;
    appendQuad(h.pool, h.list, h.clips, quad, nearer);
    appendQuad(h.pool, h.list, h.clips, quad, farther);
    CHECK(h.list.command(1).sort_key < h.list.command(0).sort_key);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(0).texture_ids[1] == 1);
    const auto* sorted = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(sorted[0] == 4);
    CHECK(sorted[6] == 0);

    Harness fine;
    BatchDrawKey a = quadKey(1, 3); a.materialId = 1; a.depth = 10.001f;
    BatchDrawKey b = quadKey(2, 3); b.materialId = 1; b.depth = 10.000f;
    appendQuad(fine.pool, fine.list, fine.clips, quad, a);
    appendQuad(fine.pool, fine.list, fine.clips, quad, b);
    CHECK(fine.list.command(0).sort_key == fine.list.command(1).sort_key);
    fine.list.finalize(fine.pool);
    CHECK(fine.list.mergedDrawCallCount() == 1);
    const auto* tied = fine.pool.indexData(LayoutId::Batch) + fine.list.command(0).index_offset;
    CHECK(tied[0] == 0);
    CHECK(tied[6] == 4);
}

// ─── Transient buffer growth ─────────────────────────────────────────────────
// A workload creeping upward each frame must not reallocate the GPU buffer every
// frame. The staging vectors double, and the GPU capacity follows them.

TEST_CASE("storage: idle streams allocate nothing and used streams survive recovery") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(4096, 1024);
    CHECK(device.createBufferCalls == 0);
    CHECK(device.estimatedGpuBytes() == 0);
    for (auto layout : {LayoutId::Batch, LayoutId::Shape, LayoutId::Sky, LayoutId::ParticleInstance}) {
        CHECK(pool.layoutHandle(layout) != VertexLayoutHandle::Invalid);
        CHECK(pool.vertexStride(layout) > 0);
        CHECK(pool.vertexBuffer(layout) == BufferHandle::Invalid);
    }
    pool.allocVertices(LayoutId::Batch, 0);
    pool.allocIndices(LayoutId::Shape, 0);
    pool.upload();
    CHECK(device.createBufferCalls == 0);
    BatchVertex vertices[4] = {};
    const u32 indices[6] = {0, 1, 2, 2, 3, 0};
    pool.appendVertices(LayoutId::Batch, vertices, sizeof(vertices));
    pool.appendIndices(LayoutId::Batch, indices, 6);
    pool.upload();
    CHECK(device.createBufferCalls == 2);
    CHECK(device.estimatedGpuBytes() == 8192);
    const auto batch = pool.vertexBuffer(LayoutId::Batch);
    pool.beginFrame();
    pool.appendVertices(LayoutId::Batch, vertices, sizeof(vertices));
    pool.upload();
    CHECK(device.createBufferCalls == 2);
    CHECK(pool.vertexBuffer(LayoutId::Batch) == batch);
    std::vector<u8> particle(44);
    pool.appendVertices(LayoutId::ParticleInstance, particle.data(), 44);
    pool.upload();
    CHECK(device.createBufferCalls == 5);
    CHECK(device.estimatedGpuBytes() == 8192 + 4096 + 64 + 24);
    CHECK(pool.vertexBuffer(LayoutId::Sky) == BufferHandle::Invalid);
    CHECK(pool.vertexBuffer(LayoutId::Shape) == BufferHandle::Invalid);
    const auto storage = device.estimatedGpuBytes();
    device.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "test");
    CHECK(device.estimatedGpuBytes() == 0);
    REQUIRE(device.recoverDevice());
    CHECK(device.estimatedGpuBytes() == storage);
    CHECK(pool.vertexBuffer(LayoutId::Batch) == batch);
    pool.upload();
    pool.shutdown();
    CHECK(device.estimatedGpuBytes() == 0);
    pool.init(4096, 1024);
    CHECK(device.estimatedGpuBytes() == 0);
    pool.shutdown();
}

TEST_CASE("growth: a slowly rising workload reallocates a handful of times, not per frame") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(/*initialVertexBytes=*/4096, /*initialIndexCount=*/1024);

    const int FRAMES = 200;
    for (int f = 0; f < FRAMES; ++f) {
        pool.beginFrame();
        // Each frame asks for a little more than the last.
        const u32 quads = 64 + static_cast<u32>(f) * 8;
        BatchVertex quad[4] = {};
        for (u32 i = 0; i < quads; ++i) {
            pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
        }
        pool.upload();
    }

    // Doubling from 4KB, the whole run needs a bounded number of reallocations —
    // one per doubling per stream, not one per frame.
    CHECK(device.resizeBufferCalls < 32);
    CHECK(device.resizeBufferCalls > 0);   // it did have to grow
}

TEST_CASE("growth: a steady workload inside capacity never reallocates") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(/*initialVertexBytes=*/1024 * 1024, /*initialIndexCount=*/64 * 1024);
    const int before = device.resizeBufferCalls;

    BatchVertex quad[4] = {};
    for (int f = 0; f < 100; ++f) {
        pool.beginFrame();
        for (int i = 0; i < 100; ++i) pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
        pool.upload();
    }
    CHECK_EQ(device.resizeBufferCalls, before);
}

// ============================================================================
// SortingGroup — the resolution pushBatchDraw does, asserted through the frame.
// The key's own field layout is test_sort_key's; what these hold is that the draw
// path ASKS the group rather than the member, everywhere a layer is consulted.
// ============================================================================

// The promise a per-sprite order cannot make. Two members straddle an outsider's
// order, and the outsider still may not come between them.
TEST_CASE("group: an outsider cannot be drawn between two members") {
    Harness h;
    h.list.setSortingGroup(11, {/*layer=*/3, /*order=*/5, false, 0});
    h.list.setSortingGroup(12, {/*layer=*/3, /*order=*/5, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey low = quadKey(1, /*layer=*/9);   // the member's own layer is ignored
    low.order = -100;
    low.entity = Entity(11);
    BatchDrawKey high = quadKey(3, /*layer=*/9);
    high.order = 100;
    high.entity = Entity(12);
    // Ungrouped, and stated BETWEEN what the two members state for themselves. Sorting
    // by the member's own order — the pre-group behaviour — puts it in the middle.
    BatchDrawKey outsider = quadKey(2, /*layer=*/3);
    outsider.order = 6;
    outsider.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, outsider);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The two members adjacent and in their stated order, the outsider clear of both.
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(0).texture_ids[1] == 3);
    CHECK(h.list.command(1).texture_ids[0] == 2);
    const auto* indices = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(indices[0] == 0);
    CHECK(indices[6] == 8);
    const auto members = h.list.runEntities(0);
    REQUIRE(members.size() == 2);
    CHECK(members[0] == Entity(11));
    CHECK(members[1] == Entity(12));
}

// Everything derived from a layer has to come from the GROUP's layer. A member whose
// own layer is y-sorted, in a group whose layer is not, must not y-sort.
TEST_CASE("group: the layer's rule is the group's, not the member's") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    h.list.setSortingGroup(21, {/*layer=*/6, 0, false, 0});
    h.list.setSortingGroup(22, {/*layer=*/6, 0, false, 0});
    BatchVertex quad[4] = {};

    // The two rules must DISAGREE or this passes whichever ran. A stated order cannot make
    // them — it outranks both — so the orders are equal and depth and world Y are set to
    // opposite conclusions.
    BatchDrawKey backY = quadKey(1, /*layer=*/4);
    backY.y = -100.0f;      // y-sort: lower Y draws LAST
    backY.depth = -100.0f;  // painter: further draws FIRST
    backY.entity = Entity(21);
    BatchDrawKey frontY = quadKey(2, /*layer=*/4);
    frontY.y = 100.0f;
    frontY.depth = 100.0f;
    frontY.shaderId = 8;
    frontY.entity = Entity(22);

    appendQuad(h.pool, h.list, h.clips, quad, backY);
    appendQuad(h.pool, h.list, h.clips, quad, frontY);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The group's layer is painter-ordered, so depth decides: y-sort would have
    // reversed exactly this pair.
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// A group's members answer the camera's culling mask on the group's layer too —
// otherwise half a character disappears when a camera drops the layer it was rigged in.
TEST_CASE("group: culling reads the group's layer") {
    Harness h;
    h.list.setCullingMask(1u << 6);  // the group's layer only
    h.list.setSortingGroup(31, {/*layer=*/6, 0, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey member = quadKey(1, /*layer=*/4);  // a layer this camera does not draw
    member.entity = Entity(31);
    BatchDrawKey ungrouped = quadKey(2, /*layer=*/4);

    appendQuad(h.pool, h.list, h.clips, quad, member);
    appendQuad(h.pool, h.list, h.clips, quad, ungrouped);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.command(0).texture_ids[0] == 1);
}

// A nested group is one block: its contents share the block's order and do not
// interleave with a sibling of the block, whatever they state for themselves.
TEST_CASE("group: a nested group's contents stay one block") {
    Harness h;
    h.list.setSortingGroup(41, {/*layer=*/3, 0, /*blockOrder=*/true, /*block=*/0});
    h.list.setSortingGroup(42, {/*layer=*/3, 0, /*blockOrder=*/true, /*block=*/0});
    h.list.setSortingGroup(43, {/*layer=*/3, 0, false, 0});
    BatchVertex quad[4] = {};

    // Two members of the inner block, stated far apart, and a sibling of the block
    // whose own order sits between those two statements.
    BatchDrawKey blockLow = quadKey(1, 3);
    blockLow.order = -50;
    blockLow.entity = Entity(41);
    BatchDrawKey sibling = quadKey(2, 3);
    sibling.order = 1;
    sibling.shaderId = 8;
    sibling.entity = Entity(43);
    BatchDrawKey blockHigh = quadKey(3, 3);
    blockHigh.order = 50;
    blockHigh.entity = Entity(42);

    appendQuad(h.pool, h.list, h.clips, quad, blockLow);
    appendQuad(h.pool, h.list, h.clips, quad, sibling);
    appendQuad(h.pool, h.list, h.clips, quad, blockHigh);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(1).texture_ids[0] == 2);  // the sibling is above the whole block
    const auto* indices = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(indices[0] == 0);
    CHECK(indices[6] == 8);
    const auto members = h.list.runEntities(0);
    REQUIRE(members.size() == 2);
    CHECK(members[0] == Entity(41));
    CHECK(members[1] == Entity(42));
}

// A group that is not there changes nothing — the field that decides is the table,
// not the presence of the component elsewhere in the scene.
TEST_CASE("group: an ungrouped draw is unaffected by another entity's group") {
    Harness h;
    h.list.setSortingGroup(51, {/*layer=*/0, /*order=*/100, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey a = quadKey(1, /*layer=*/2);
    BatchDrawKey b = quadKey(2, /*layer=*/1);
    b.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, a);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// A sprite cut to the inside of a mask and one cut to the outside of the SAME mask differ
// only in a state flag. Merged, one of them would be drawn with the other's stencil compare
// — the hole and the window are the same picture then.
TEST_CASE("stencil: inside and outside of one mask are different draws") {
    Harness h;
    h.clips.setStencilTest(61, 1);
    h.clips.setStencilTestOutside(62, 1);
    BatchVertex quad[4] = {};

    BatchDrawKey inside = quadKey(1, /*layer=*/2);
    inside.entity = Entity(61);
    BatchDrawKey outside = quadKey(1, /*layer=*/2);
    outside.entity = Entity(62);

    appendQuad(h.pool, h.list, h.clips, quad, inside);
    appendQuad(h.pool, h.list, h.clips, quad, outside);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_OUT) == 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_OUT) != 0);
}

// Setting one mode must clear the other, or a sprite switched from outside to inside keeps
// both flags and reads as outside forever.
TEST_CASE("stencil: the two test modes are exclusive on one entity") {
    ClipState clips;
    clips.setStencilTestOutside(70, 3);
    clips.setStencilTest(70, 3);
    DrawCommand cmd{};
    clips.applyTo(Entity(70), cmd);
    CHECK((cmd.state_flags & CMD_STATE_STENCIL_TEST) != 0);
    CHECK((cmd.state_flags & CMD_STATE_STENCIL_OUT) == 0);

    clips.setStencilTestOutside(70, 3);
    DrawCommand back{};
    clips.applyTo(Entity(70), back);
    CHECK((back.state_flags & CMD_STATE_STENCIL_OUT) != 0);
}
