// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <array>
#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"
#include "../../resource/Handle.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

/**
 * @brief Scene-level 2D mesh renderer (MeshRenderer component).
 * @details Streams component-local geometry through the unified Batch face each
 *          frame — CPU-transformed like every 2D renderable — so meshes sort, clip,
 *          light, and multi-texture-merge exactly like sprites. The whole plugin is
 *          "vertices + BatchDrawKey + append": no bottom-layer changes.
 */
class MeshPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    /// Resident geometry is the only thing the engine draws depth-only. A flat
    /// renderable's shadow is ShadowCaster2D's to cast, not the map's.
    bool castsShadows() const override { return true; }
    bool drawsMotion() const override { return true; }
    void collect(RenderCollectContext& ctx) override;
    RenderPrewarmResult prewarm(RenderFrameContext& ctx, ecs::Registry& registry,
                                const Entity* entities, u32 count, bool shadowPasses) override;
    /** @brief Ready programs from facts already gathered — the door a PREPARED
     *         cell comes through, before any entity of it exists. */
    RenderPrewarmResult prewarmFacts(RenderFrameContext& ctx, const MeshProgramFacts* facts,
                                     u32 count, bool shadowPasses, bool residentGeometry);
    RenderPrewarmResult prewarmDocument(RenderFrameContext& ctx, const MeshDocumentRecord* rows,
                                        u32 count, bool shadowPasses) override;
    const char* collectScope() const override { return "render.collect.mesh"; }

private:
    /** Shader variants compiled during the current collect — see meshProgram. */
    u32 compiled_this_frame_ = 0;
    /** The last one built, so a late compile can be named rather than counted. */
    u32 last_compiled_variant_ = 0;
    std::vector<BatchVertex> scratch_;  ///< Reused per mesh; amortizes the transform buffer.
    /// Resident-geometry programs, indexed by {has normals, lit, normal-mapped,
    /// skinned, depth-only, environment-mapped, lightmapped}: what the geometry
    /// carries and what the draw asked for are separate. Compiled on first use.
    std::array<u32, MESH_VARIANTS> mesh_programs_{};
    std::array<bool, MESH_VARIANTS> mesh_compiled_{};
    /// The shader RESOURCES behind those ids, kept because init() runs again
    /// after a device rebuild: with no handle to release, each rebuild left a
    /// dead shader in the pool and one more program the host never freed.
    std::array<resource::ShaderHandle, MESH_VARIANTS> mesh_shaders_{};
    /// One entity's bone matrices while they are being built; reused per draw.
    std::vector<glm::mat4> pose_scratch_;
    u32 meshProgram(RenderFrameContext& ctx, u32 variant);

    /// Where one mesh stood the last two times a view drew it: the motion between them is what a temporal
    /// effect follows. Per view and entity, kept only while a temporal effect asks for it.
    struct Pose {
        glm::mat4 previous{1.0f};
        glm::mat4 current{1.0f};
        /// A skinned mesh's bones are world-space and the entity's own transform says nothing about it, so what
        /// moved is the palette: the one it was drawn with last time and the one it is drawn with now.
        std::vector<glm::mat4> bonesPrevious;
        std::vector<glm::mat4> bonesCurrent;
        u64 frame = 0;
    };
    std::unordered_map<u64, Pose> poses_;
    void trackPose(const RenderFrameContext& ctx, Entity entity, const glm::mat4& model,
                   const std::vector<glm::mat4>* bones = nullptr);
    static u64 poseKey(const RenderFrameContext& ctx, Entity entity) {
        return ctx.motion_key * 0x9E3779B97F4A7C15ull ^ static_cast<u64>(entity.id());
    }
    bool warned_material_ = false;  ///< A material on resident geometry is said once.
    bool warned_bones_ = false;     ///< A skin over the pose budget is said once.
    bool warned_lod_ = false;       ///< A group that cannot be honoured is said once.
};

}  // namespace esengine
