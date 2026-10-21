// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PostProcessPipeline.hpp
 * @brief   Post-processing effects pipeline
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../resource/Handle.hpp"
#include "../../math/Math.hpp"
#include "../rhi/Framebuffer.hpp"
#include "../graph/RenderGraph.hpp"
#include "../store/HdrFormat.hpp"

#include <glm/glm.hpp>
#include <string>
#include <vector>
#include <unordered_map>

namespace esengine {

class GfxDevice;
class RenderContext;
class Shader;

namespace resource {
    class ResourceManager;
}

/**
 * @brief What the last pass of a chain does to scene values on the way out.
 *
 * @details A tonemap is the OUTPUT transform, not an effect: it runs exactly once
 *          and last — after the effects, which want scene values, and before the
 *          OETF, which is a transfer function. `None` by default: a flat frame in
 *          linear light wants an exact round trip, and a filmic curve is not one.
 */
enum class OutputTransform : u8 {
    None = 0,  ///< Encode only. Values above 1 clip, which is what LDR content means.
    ACES = 1,  ///< Narkowicz ACES filmic curve, for a scene that carries HDR radiance.
    Neutral = 2,  ///< Khronos PBR Neutral: hue and saturation survive, highlights roll off.
};

/**
 * @brief Post-processing pass configuration
 */
struct PostProcessPass {
    std::string name;
    resource::ShaderHandle shader;
    bool enabled = true;
    std::unordered_map<std::string, f32> floatUniforms;
    std::unordered_map<std::string, glm::vec4> vec4Uniforms;
    /// Effect-declared textures (LUTs, masks): sampler uniform name -> GL
    /// texture id. #pragma-param shaders bind them at their reflected material
    /// units; the legacy loose path binds in order above the two engine units
    /// (0 = input, 1 = scene).
    std::vector<std::pair<std::string, u32>> textureUniforms;

    /// Set by the chain when the pass keeps its output for the next frame (its
    /// shader declares `u_history`); the pass then reads the previous frame there.
    bool temporal = false;
    /// Set instead of `temporal` when the shader declares `u_feedback`: the pass keeps
    /// its own last output without shifting the picture, and reads it there. An
    /// auto-exposure's adapted value is remembered this way.
    bool feedback = false;
    /// Which remembered state the pass uses, resolved when the chain is declared.
    u64 historyKey = 0;

    /// Fraction of the chain's size this pass draws at; the pass consuming it
    /// upsamples. The graph resolves the fraction, and u_viewport still reports
    /// the CANVAS, so a fractional pass must read its extent off its texture.
    f32 scale = 1.0f;

    /// Set on every pass of a multi-pass effect after its first: unit 1 then
    /// reads the input that effect started from, not this pass's own input. False
    /// starts an effect, so a single-pass effect sees the chain as it reached it.
    bool continuesEffect = false;

    /// #pragma-param shaders: the pass's packed MaterialConstants payload +
    /// its UBO (binding 1) — the same reflected block a material would use.
    /// Rebuilt from float/vec4Uniforms over the layout defaults when dirty.
    std::vector<u8> paramBytes;
    BufferHandle paramUbo = BufferHandle::Invalid;
    bool paramDirty = true;
};

/**
 * @brief Post-processing effects pipeline
 *
 * @details Owns the scene capture and the effect chains; the chains themselves
 *          are declared to a RenderGraph, which decides what physical targets
 *          they cost. The per-camera and screen-level chains are the same shape
 *          and go through the same builder.
 */
class PostProcessPipeline {
public:
    /**
     * @brief Builds a pipeline that declares its chains onto the FRAME's graph.
     *
     * @details A chain is not a graph of its own: the frame declares the scene
     *          and the effects that read it to one graph and executes it once,
     *          so every pass a frame runs is stated in one place.
     */
    PostProcessPipeline(GfxDevice& device, RenderContext& context,
                        resource::ResourceManager& resourceManager, rg::RenderGraph& graph);

    /**
     * @brief Builds one with no frame behind it; it gets a graph of its own.
     *
     * @details The fallback path in the bindings, for a pipeline that exists
     *          without a RenderFrame having made one.
     */
    PostProcessPipeline(GfxDevice& device, RenderContext& context,
                        resource::ResourceManager& resourceManager);
    ~PostProcessPipeline();

    PostProcessPipeline(const PostProcessPipeline&) = delete;
    PostProcessPipeline& operator=(const PostProcessPipeline&) = delete;

    /**
     * @brief Initializes the pipeline with given dimensions
     */
    void init(u32 width, u32 height);

    /**
     * @brief Shuts down and releases resources
     */
    void shutdown();

    /**
     * @brief Resizes the framebuffers
     */
    void resize(u32 width, u32 height);

    /**
     * @brief Adds a post-processing pass
     * @param name Unique name for the pass
     * @param shader Shader handle for the effect
     * @return Index of the added pass
     */
    u32 addPass(const std::string& name, resource::ShaderHandle shader);
    /// The project's multisampling request; 1 = off. Clamped by the device.
    void setRequestedSamples(u32 samples);
    /// What the scene target is actually created with: the request after the
    /// device's ceiling. The two silently differing is how a project ships at 1x
    /// believing it asked for 8.
    u32 sceneSamples() const { return scene_samples_; }
    /// What was asked for, before the ceiling.
    u32 requestedSamples() const { return requested_samples_; }
    /// Draw @p passName at @p scale of the chain size (clamped to (0, 1]).
    void setPassScale(const std::string& passName, f32 scale);
    /// Mark @p passName as a later pass of the effect the pass before it began.
    void setPassContinuesEffect(const std::string& passName);




    /**
     * @brief Sets a float uniform for a pass
     */
    void setPassUniformFloat(const std::string& passName, const std::string& uniform, f32 value);

    /**
     * @brief Binds a texture to a pass's sampler uniform (unit 2 upward, in
     *        registration order). Replaces an existing binding of the same name.
     */
    void setPassTexture(const std::string& passName, const std::string& uniform, u32 glTextureId);

    /**
     * @brief Sets a vec4 uniform for a pass
     */
    void setPassUniformVec4(const std::string& passName, const std::string& uniform, const glm::vec4& value);

    /**
     * @brief Gets the pass count
     */
    u32 getPassCount() const { return static_cast<u32>(passes_.size()); }

    /**
     * @brief Gets a pass by index
     */
    const PostProcessPass* getPass(u32 index) const;

    /**
     * @brief Gets a pass by name
     */
    const PostProcessPass* getPass(const std::string& name) const;

    /**
     * @brief Begins rendering to the pipeline
     * @details Binds the input framebuffer. Render scene content after this.
     *          @p clearColor (RGBA) colors the capture's load-op clear — the
     *          camera background; null = opaque black.
     */
    void begin(const f32* clearColor = nullptr);

    /** The graph resource the scene is captured into, for the frame to declare
     *  its scene pass against. kNoResource when no capture is open. */
    rg::ResourceId sceneResource() const { return inFrame_ ? sceneResource_ : rg::kNoResource; }

    /** Declares this camera's chain onto the frame's graph. The frame runs it. */
    void declareChain();
    /** Closes the capture once the graph has run it. */
    void chainDone();

    /**
     * @brief Whether this frame's chain holds a temporal effect.
     *
     * @details An effect is temporal when its shader declares a `u_history` texture:
     *          the engine then keeps the pass's last output for it and shifts the
     *          picture by a sub-pixel amount each frame. The pass list is the
     *          answer, so there is no flag to disagree with it.
     */
    bool temporalActive();

    /**
     * @brief Whether an enabled pass reads how far each moving surface travelled (`u_velocity`).
     *
     * @details The frame then draws its moving meshes a second time into a target of its own, so a
     *          temporal effect can follow an object by its own displacement instead of the camera's.
     */
    bool velocityWanted();

    /// What a temporal view would be given by its NEXT begin: the sub-pixel shift and last frame's camera.
    struct TemporalView {
        glm::vec2 jitter{0.0f};
        glm::mat4 previous{1.0f};
        /// The shift the previous frame was drawn with.
        glm::vec2 previousJitter{0.0f};
    };
    /// Read before the scene is drawn, because the motion pass is collected with the scene and the shift
    /// is only applied when it is drawn. Changes nothing: beginTemporalView still takes the same step.
    TemporalView peekTemporalView(const glm::mat4& viewProjection, u64 key) const;

    /**
     * @brief The motion pass's target for this frame, declared in the graph (kNoResource when it cannot be made).
     *
     * @details RGBA32F: xy = how far the surface moved in uv, z = its window depth, w = 1 where something wrote.
     *          Depth in a float because the reader compares it with the scene's, and a half cannot tell two
     *          surfaces apart near the far plane.
     */
    rg::ResourceId declareVelocity();

    /**
     * @brief Whether an enabled pass reads what stands over each place (`u_rainCover`).
     *
     * @details The frame then draws the scene from straight above, depth only, around the camera: a map of the highest
     *          surface at each spot, so an effect can tell open ground from ground under an awning.
     */
    bool coverWanted();
    /// How far from the camera, in world units, that map reaches each way (the effect's `u_shelterRange`).
    f32 coverRange();
    /// The map's target for this frame, declared in the graph (kNoResource when it cannot be made).
    rg::ResourceId declareCover(u32 size);
    /// The matrix the map was drawn through, for the effect to put a world point in it.
    void setCoverMatrix(const glm::mat4& viewProjection) { cover_matrix_ = viewProjection; }

    /**
     * @brief Whether this frame's scene target carries a second attachment for the surface's material.
     *
     * @details Decided when the capture opens, from the passes: an effect whose shader says
     *          `#pragma gbuffer` reads what a surface IS (normal, roughness, metalness), which the
     *          scene's own shaders write beside the colour. A frame with no such effect makes none, so
     *          the cost is paid only by the project that asked for it.
     */
    bool sceneHasGBuffer() const { return inFrame_ && scene_gbuffer_; }

    /**
     * @brief The frame's environment atlas, for an effect that reflects it (`u_environment`).
     *
     * @details Handed over by the frame that bound it for the scene: the same atlas the meshes
     *          reflect, so a reflection an effect adds where the scene's own ray found nothing is the
     *          sky the surface already shows. 0 = none this frame.
     */
    void setEnvironmentTexture(u32 glTextureId) { environment_texture_ = glTextureId; }

    /**
     * @brief The frame's shadow atlas, for an effect that asks whether a point of air is in the sun (`#pragma lights`).
     *
     * @details The atlas is a graph resource the scene pass names as a dependency; an effect that reads it names it
     *          too, or the graph would hand it back to the pool before the effect ran. 0 / kNoResource = no map.
     */
    void setShadowAtlas(u32 glTextureId, rg::ResourceId resource) {
        shadow_texture_ = glTextureId;
        shadow_resource_ = resource;
    }

    /**
     * @brief Starts a frame of the temporal view @p key, and answers how far to shift it.
     *
     * @param key Names the view whose history this is — two cameras must not
     *        blend into one history. 0 for the screen.
     * @return The shift in clip-square units, to hand to the camera constants.
     */
    glm::vec2 beginTemporalView(const glm::mat4& viewProjection, u64 key);

    /**
     * @brief Checks if pipeline is initialized
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Whether the scene goes through the graph or straight to the surface.
     *
     * @details Four things engage it: effects to run, the linear pipeline (whose
     *          final pass carries an encode a WebGL2 canvas framebuffer cannot do
     *          for itself), an output transform, or a present that scales. One
     *          predicate because everyone asks at both ends of a frame, and two
     *          copies of it is one edit away from a capture that is opened and
     *          never resolved.
     */
    bool isEngaged() const {
        // `initialized_` leads, and that is load-bearing: init refuses when the
        // blit shader will not compile, so a chain that cannot present degrades
        // to drawing straight at the surface rather than to a black frame.
        return initialized_ && ((!bypass_ && !passes_.empty()) || linear_output_
                                || output_transform_ != OutputTransform::None
                                || view_exposure_ != 0.0f
                                || presentScales() || present_required_);
    }

    /**
     * @brief Whether the chain's own size differs from the rect it lands in.
     *
     * @details Inferred rather than flagged: the chain size and the output rect
     *          are already two separate calls, so "they disagree" needs no third
     *          piece of state to go stale. A scene rendered at one resolution and
     *          presented at another is a scale, and a scale needs the blit.
     */
    bool presentScales() const {
        return output_vp_w_ > 0 && output_vp_h_ > 0
            && (output_vp_w_ != width_ || output_vp_h_ != height_);
    }

    /**
     * @brief The caller has decided this frame needs a present.
     *
     * @details A DECISION, not a rect — which is why it is set rather than
     *          inferred like presentScales(). A 1x letterbox and a split-screen
     *          viewport are the same geometry, same size and offset, and differ
     *          only in intent; the two rects cannot say which is which.
     */
    void setPresentRequired(bool required) { present_required_ = required; }

    /**
     * @brief Whether the present is a whole-multiple upscale of the chain.
     *
     * @details Inferred from the two rects, for the reason presentScales() is:
     *          the rect is the one authority, and a filter beside it is a second
     *          one to disagree with. A whole multiple copies exactly, and
     *          interpolating it blurs a picture that needed no resampling.
     */
    bool presentIsWholeMultiple() const {
        if (!presentScales() || width_ == 0 || height_ == 0) return false;
        if (output_vp_w_ % width_ || output_vp_h_ % height_) return false;
        return output_vp_w_ / width_ == output_vp_h_ / height_;
    }

    /**
     * @brief Skip the EFFECTS, not the chain.
     *
     * @details It gates the authored passes and nothing else. The linear encode,
     *          the output transform and a scaling present all still engage —
     *          none of them is an effect, they are how the image reaches the
     *          screen, and a camera with no stack still needs them.
     */
    void setBypass(bool bypass) { bypass_ = bypass; }

    /**
     * @brief Linear-light mode: sRGB-format intermediates (hardware linear
     *        blending) and an always-engaged capture+blit whose final pass
     *        carries the linear->sRGB encode. Overrides bypass.
     */
    void setLinearOutput(bool linear) { linear_output_ = linear; }

    /**
     * @brief What this frame's intermediates were asked to be and allowed to be.
     *
     * @details The committed decision, not a re-derivation: an editor explaining
     *          why a linear project is running at 8-bit has to agree with the
     *          targets the frame actually made.
     */
    const HdrFormatDecision& hdrFormat() const { return frame_format_; }

    /**
     * @brief Whether the scene target needs a depth attachment.
     *
     * @details A depth buffer is per-frame memory and clear bandwidth (≈8MB at 1080p),
     *          which a project with no depth layer should not pay for a feature it does
     *          not use. A flag and nothing more: the scene target is declared to the
     *          graph at every begin(), so the next frame asks the pool for the shape
     *          this answer describes and the old one is simply never handed out again.
     */
    void setSceneNeedsDepth(bool needs) { scene_needs_depth_ = needs; }
    bool linearOutput() const { return linear_output_; }

    /**
     * @brief The curve the final pass applies to scene values.
     *
     * @details Costs nothing when the chain is already engaged — the blit was
     *          always going to run — so this is a variant of that shader rather
     *          than a pass of its own.
     */
    void setOutputTransform(OutputTransform transform) { output_transform_ = transform; }
    /// The editor view's exposure in stops, applied by the blit. Engages the blit when
    /// non-zero, since only the blit carries it; the value rides the frame's time block.
    void setViewExposure(f32 ev);
    OutputTransform outputTransform() const { return output_transform_; }

    /**
     * @brief Checks if bypass mode is enabled
     */
    /**
     * @brief Clears all passes
     */
    void clearPasses();

    /**
     * @brief Sets the output target for the final blit (Default = screen)
     */
    void setOutputTarget(FramebufferHandle target);

    /**
     * @brief Sets the output viewport for the final blit
     */
    void setOutputViewport(u32 x, u32 y, u32 w, u32 h);

    /**
     * @brief Begins screen-level capture (all camera output goes into screen FBO)
     */
    void beginScreenCapture();

    /**
     * @brief Ends screen-level capture
     */
    void endScreenCapture();

    /**
     * @brief Executes screen-level post-process passes on captured output
     */
    void executeScreenPasses();

    /**
     * @brief Adds a screen-level post-process pass
     */
    u32 addScreenPass(const std::string& name, resource::ShaderHandle shader);

    /**
     * @brief Clears all screen-level passes
     */
    void clearScreenPasses();

    /**
     * @brief Sets a float uniform for a screen-level pass
     */
    void setScreenPassUniformFloat(const std::string& passName, const std::string& uniform, f32 value);

    /**
     * @brief Sets a vec4 uniform for a screen-level pass
     */
    void setScreenPassUniformVec4(const std::string& passName, const std::string& uniform, const glm::vec4& value);

    /**
     * @brief Gets the screen pass count
     */
    u32 getScreenPassCount() const { return static_cast<u32>(screenPasses_.size()); }

    /**
     * @brief Checks if screen capture is active
     */
    bool isScreenCaptureActive() const { return screenCaptureActive_; }

    /** @brief The surface the scene is currently rendering into: the screen-capture
     *         FBO when the screen stack is live, the per-camera capture when
     *         in-frame, else the default target. The main-pass load-op clear must
     *         land HERE — rebinding the default target mid-capture breaks the stack. */
    FramebufferHandle currentSceneFBO() const;

private:
    PostProcessPass* findPass(const std::string& name);
    /** Intermediate/capture attachment format for the active pipeline mode. */
    GfxPixelFormat interFormat() const;
    void commitFormat();
    /** The shape of every target in a chain, the scene target included. */
    rg::TargetDesc chainTarget(bool withDepth) const;
    rg::TargetDesc blitSourceTarget(bool withDepth) const;
    void ensureGraph();
    void ensureScreenQuad();
    void drawScreenQuad();
    void applyPassPipeline(const Shader& shader);
    void renderPass(PostProcessPass& pass, const rg::PassContext& ctx);
    /// Declares one chain onto an already-begun graph and runs it, ending in the
    /// output target. @p scene is the resource the first effect reads.
    void runChain(std::vector<PostProcessPass>& passes, rg::ResourceId scene);
    /// The chain's last pass: the output transform, then the copy into the
    /// output target's viewport.
    void blitPass();
    /// The blit variant the current output transform needs, compiled on demand.
    resource::ShaderHandle outputShader();
    /// One variant of blit.esshader, by feature.
    resource::ShaderHandle compileBlit(const std::vector<std::string>& features);
    /// Frees a pass's GPU-side param UBO (clearPasses/shutdown).
    void releasePassResources(PostProcessPass& pass);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resourceManager_;

    /// The frame's graph when one was given; `ownedGraph_` otherwise.
    rg::RenderGraph* graph_ = nullptr;
    Unique<rg::RenderGraph> ownedGraph_;
    VertexLayoutHandle screen_quad_layout_ = VertexLayoutHandle::Invalid;
    BufferHandle screen_quad_vbo_ = BufferHandle::Invalid;
    resource::ShaderHandle blitShader_;
    /// The ES_TONEMAP variant of the same file. Invalid until a chain asks for it.
    resource::ShaderHandle tonemapShader_;
    resource::ShaderHandle neutralShader_;

    std::vector<PostProcessPass> passes_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
    bool bypass_ = false;
    bool linear_output_ = false;
    /// The format this frame committed to; see commitFormat().
    HdrFormatDecision frame_format_{};
    /// What screenFBO_ was created with, so a policy change can be noticed.
    GfxPixelFormat screenFBOFormat_ = GfxPixelFormat::RGBA8;
    bool scene_needs_depth_ = false;
    /// What the PROJECT asked for (policy). 4 matches what a browser gives its
    /// own drawing buffer, which is the quality a chain-less frame always had.
    u32 requested_samples_ = 4;
    /// What the scene target actually rasterises with: the request clamped by
    /// the device's ceiling. Never read the ceiling as if it were the answer.
    u32 scene_samples_ = 1;
    void applySampleRequest();
    OutputTransform output_transform_ = OutputTransform::None;
    f32 view_exposure_ = 0.0f;
    /// The graph resource the scene is drawn into, live between begin() and end().
    rg::ResourceId sceneResource_ = rg::kNoResource;
    TextureHandle sceneTexture_ = TextureHandle::Invalid;

    FramebufferHandle output_target_fbo_ = FramebufferHandle::Default;
    u32 output_vp_x_ = 0;
    u32 output_vp_y_ = 0;
    bool present_required_ = false;
    u32 output_vp_w_ = 0;
    u32 output_vp_h_ = 0;

    /// What a temporal pass remembers of one view between frames.
    struct TemporalState {
        glm::mat4 current{1.0f};
        glm::mat4 previous{1.0f};
        u32 frame = 0;
        /// The frame whose chain last wrote the history; a gap means the history
        /// is of a picture this one no longer follows.
        u32 writtenFrame = 0;
        Unique<Framebuffer> history[2];
        u32 readIndex = 0;
        bool valid = false;
        u32 width = 0;
        u32 height = 0;
        GfxPixelFormat format = GfxPixelFormat::RGBA8;
    };
    std::unordered_map<u64, TemporalState> temporal_;
    u64 temporalKey_ = 0;
    bool passIsTemporal(const PostProcessPass& pass);
    bool passUsesLights(const PostProcessPass& pass);
    /// Some enabled pass of the chain reads the surface record.
    bool passesWantGBuffer();
    bool scene_gbuffer_ = false;
    u32 environment_texture_ = 0;
    u32 shadow_texture_ = 0;
    rg::ResourceId shadow_resource_ = rg::kNoResource;
    /// The motion pass's target, kept across frames for its size, and whether this frame drew into it.
    Unique<Framebuffer> cover_fbo_;
    rg::ResourceId cover_resource_ = rg::kNoResource;
    bool cover_active_ = false;
    glm::mat4 cover_matrix_{1.0f};
    Unique<Framebuffer> velocity_fbo_;
    rg::ResourceId velocity_resource_ = rg::kNoResource;
    bool velocity_active_ = false;
    bool passHasTexture(const PostProcessPass& pass, const char* name);
    /// A history made (or kept) at @p w x @p h, or null when it cannot be.
    TemporalState* prepareHistory(TemporalState& state, u32 w, u32 h, GfxPixelFormat format);
    /// The pass writes a measurement, so its target is a float one where the device has them.
    bool passIsHighPrecision(const PostProcessPass& pass);
    /// Per pass, per view: what a `u_feedback` pass remembers.
    std::unordered_map<u64, TemporalState> feedback_;
    u64 feedbackKey(const std::string& passName) const;

    Unique<Framebuffer> screenFBO_;
    bool screenFBOCreated_ = false;
    bool screenCaptureActive_ = false;
    std::vector<PostProcessPass> screenPasses_;

    PostProcessPass* findScreenPass(const std::string& name);
    void ensureScreenFBO();
};

}  // namespace esengine
