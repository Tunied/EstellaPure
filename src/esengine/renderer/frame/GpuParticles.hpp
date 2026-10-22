// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GpuParticles.hpp
 * @brief   Particles simulated by a compute kernel, drawn from the buffer the kernel wrote (WebGPU).
 *
 * @details An emitter that asks for it keeps its particles in a ring of GPU slots: a state buffer the kernel advances and an
 *          instance buffer it writes in the layout the particle draw already reads. The CPU decides only how many are born
 *          and how long the step is, so what costs a CPU emitter per particle per frame costs this one a dispatch: hundreds
 *          of thousands of particles are an ordinary emitter. Nothing is read back; the draw binds the instance buffer as it
 *          lies, which is why a storage buffer here is also a vertex buffer.
 *
 *          One compute pass per frame, declared into the render graph ahead of the scene pass it feeds. It carries every
 *          emitter the frame's collect asked to step, each with its own block of parameters.
 *
 *          What it is not: the particles are not sorted (an additive or cut-out look is exact, a deep alpha-blended pile
 *          draws in slot order), do not spawn sub-emitters or trails, and collide only with the floor plane. Where the device
 *          cannot compute, ParticleSystem simulates the same emitter on the CPU, capped.
 */
#pragma once

#include "../../core/Types.hpp"

#include "../graph/RenderGraph.hpp"
#include "../rhi/GfxEnums.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

class GfxDevice;

namespace ecs { struct ParticleEmitter; struct Transform; }
namespace particle { class ParticleSystem; struct GpuStep; }

class GpuParticles {
public:
    explicit GpuParticles(GfxDevice& device);
    ~GpuParticles();

    GpuParticles(const GpuParticles&) = delete;
    GpuParticles& operator=(const GpuParticles&) = delete;

    /// Whether the device can run the kernel at all.
    bool available() const;

    /// A new frame: the previous frame's jobs are gone, and a slot nobody asked for in a while is given back.
    void beginFrame();

    /**
     * @brief Queues the step an emitter needs and says where its particles are. The step is committed to the emitter only
     *        once the kernel has run it; an emitter already queued this frame is not queued twice.
     * @param drawCount How many slots may hold a live particle once the step has run.
     * @param instances The buffer to draw them from.
     * @return false when there is nothing to draw (no compute, no memory).
     */
    bool submit(Entity entity, const ecs::ParticleEmitter& emitter, const ecs::Transform& transform,
                particle::ParticleSystem& system, const particle::GpuStep& step, BufferHandle& instances);

    /// Adds the compute pass for what was submitted. The resource it writes must be named by the pass that draws the result.
    rg::ResourceId declare(rg::RenderGraph& graph);

    void release();

    /// Slots live right now, for the stats.
    u32 slotCount() const { return static_cast<u32>(slots_.size()); }
    u32 lastDispatches() const { return lastDispatches_; }
    /// Particle slots handed to a draw this frame, over every emitter and camera: what the GPU is asked to draw.
    u32 drawnSlots() const { return drawn_; }

private:
    struct Slot {
        BufferHandle state = BufferHandle::Invalid;
        BufferHandle instances = BufferHandle::Invalid;
        u32 capacity = 0;
        u64 lastUsed = 0;
    };
    struct Job;

    bool ensureKernel();
    Slot* ensureSlot(Entity entity, u32 capacity);
    void freeSlot(Slot& slot);
    void run();

    GfxDevice& device_;
    ComputeHandle kernel_ = ComputeHandle::Invalid;
    BufferHandle params_ = BufferHandle::Invalid;
    u32 paramsCapacity_ = 0;
    bool failed_ = false;
    u64 frame_ = 0;
    u32 lastDispatches_ = 0;
    u32 drawn_ = 0;
    std::unordered_map<u32, Slot> slots_;
    std::vector<Job> jobs_;
};

}  // namespace esengine
