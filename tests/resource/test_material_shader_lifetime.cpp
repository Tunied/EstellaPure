// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "../renderer/MockGfxDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include <cstdio>
using namespace esengine;
static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FAIL: %s\n", m); ++failures; } else std::printf("ok: %s\n", m); } while (0)
static const char* source = R"(#pragma shader "Lifetime"
#pragma version 300 es
#pragma domain Unlit
#pragma fragment
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
#pragma end
)";
int main() {
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto shader = rm.createShader("vertex", "fragment", false);
        store.registerLayout(shader, {}); store.rememberSource(shader, source, "");
        MaterialRecord record; record.shaderRef = shader; store.define(1, record);
        CHECK(store.meshProgram(1, rm) != 0, "mesh variant compiles");
        CHECK(store.particleProgram(1, rm) != 0, "2D particle variant compiles");
        CHECK(rm.getStats().shaderCount == 3, "base and two variants have real pool ownership");
        rm.releaseShader(shader);
        CHECK(rm.getStats().shaderCount == 0, "final base release also retires both variants");
        CHECK(store.layoutFor(shader) == nullptr, "retired shader layout is gone");
        CHECK(store.builtVariantCount() == 0, "retired shader variant entries are gone");
        store.clear(); rm.shutdown();
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto shader = rm.createShader("vertex", "fragment", false);
        store.rememberSource(shader, source, "");
        MaterialRecord record; record.shaderRef = shader; store.define(1, record);
        const auto program = store.particleProgram(1, rm);
        bool shared = true;
        for (int i = 0; i < 10000; ++i) shared &= store.particleProgram(1, rm) == program;
        CHECK(shared, "10000 warm particle lookups share the program");
        store.clear();
        CHECK(rm.getStats().shaderCount == 1, "clear releases owned variants, not caller-owned base");
        CHECK(store.builtVariantCount() == 0, "clear forgets variant cache");
        store.define(1, record);
        CHECK(store.particleProgram(1, rm) == 0, "clear forgets source rather than rebuilding from retired bytes");
        store.clear(); rm.releaseShader(shader); rm.shutdown();
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto a = rm.createShader("vertex", "fragment", false);
        auto b = rm.createShader("vertex", "fragment", false);
        for (auto shader : {a, b}) { store.registerLayout(shader, {}); store.rememberSource(shader, source, ""); }
        MaterialRecord record; record.shaderRef = a; store.define(1, record); store.define(2, record);
        record.shaderRef = b; store.define(3, record);
        CHECK(store.particleProgram(1, rm) == store.particleProgram(2, rm), "two materials share one source variant");
        const auto other = store.particleProgram(3, rm);
        CHECK(rm.getStats().shaderCount == 4, "two source eras own two variants");
        rm.releaseShader(a);
        CHECK(rm.getStats().shaderCount == 2, "retiring one source releases only its variant");
        CHECK(store.layoutFor(b) != nullptr && store.particleProgram(3, rm) == other, "another source remains usable");
        rm.shutdown();
        CHECK(store.layoutFor(b) == nullptr && store.builtVariantCount() == 0, "pool shutdown retires remaining metadata and variants");
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        auto shader = rm.createShader("vertex", "fragment", false);
        {
            MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
            store.rememberSource(shader, source, "");
            MaterialRecord record; record.shaderRef = shader; store.define(1, record);
            store.particleProgram(1, rm);
        }
        CHECK(rm.getStats().shaderCount == 1, "store destruction releases owned variants but preserves external base");
        rm.releaseShader(shader);
        CHECK(rm.getStats().shaderCount == 0, "retirement after store destruction invokes no dead observer");
        rm.shutdown();
    }
    std::printf("Material shader lifetime: %d failures\n", failures);
    return failures ? 1 : 0;
}
