#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/animation/TweenSystem.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include <limits>

using namespace esengine;
using namespace esengine::ecs;
using namespace esengine::animation;

TEST_CASE("finite looping tween completion resumes its successor") {
    for (auto mode : {LoopMode::None, LoopMode::Restart, LoopMode::PingPong}) {
        Registry r; TweenSystem s;
        auto a = r.create(), b = r.create(); r.emplace<Transform>(a); r.emplace<Transform>(b);
        auto first = s.createTween(r, a, TweenTarget::PositionX, 0, 10, 1);
        auto next = s.createTween(r, b, TweenTarget::PositionX, 0, 20, 10);
        auto& data = r.get<TweenData>(first); data.loop_mode = mode; data.loops_remaining = 2; data.sequence_next = next;
        r.get<TweenData>(next).state = TweenState::Paused;
        s.update(r, 2.25f);
        CHECK_FALSE(r.valid(first));
        CHECK(r.get<TweenData>(next).state == TweenState::Running);
        s.update(r, .25f);
        CHECK(r.get<Transform>(b).position.x > 0);
    }
}

TEST_CASE("tween completion does not revive a cancelled successor") {
    Registry r; TweenSystem s;
    auto a = r.create(), b = r.create(); r.emplace<Transform>(a); r.emplace<Transform>(b);
    auto first = s.createTween(r, a, TweenTarget::PositionX, 0, 10, 1);
    auto next = s.createTween(r, b, TweenTarget::PositionX, 0, 20, 10);
    r.get<TweenData>(first).sequence_next = next;
    r.get<TweenData>(next).state = TweenState::Cancelled;
    s.update(r, 1);
    CHECK_FALSE(r.valid(next));
    CHECK(r.get<Transform>(b).position.x == 0);
}

TEST_CASE("looping tweens retain long frame phase") {
    for (auto mode : {LoopMode::Restart, LoopMode::PingPong}) {
        Registry r; TweenSystem s;
        auto target = r.create(); r.emplace<Transform>(target);
        auto tween = s.createTween(r, target, TweenTarget::PositionX, 0, 10, 1);
        r.get<TweenData>(tween).loop_mode = mode;
        s.update(r, 1.25f);
        CHECK(r.get<Transform>(target).position.x == doctest::Approx(mode == LoopMode::Restart ? 2.5 : 7.5));
        CHECK(r.get<TweenData>(tween).elapsed == doctest::Approx(.25));
        s.update(r, .75f);
        CHECK(r.get<Transform>(target).position.x == doctest::Approx(mode == LoopMode::Restart ? 10 : 0));
    }
}

TEST_CASE("finite loops complete in a long frame at their final endpoint") {
    for (auto mode : {LoopMode::Restart, LoopMode::PingPong}) {
        Registry r; TweenSystem s;
        auto target = r.create(); r.emplace<Transform>(target);
        auto tween = s.createTween(r, target, TweenTarget::PositionX, 0, 10, 1);
        auto& data = r.get<TweenData>(tween); data.loop_mode = mode; data.loops_remaining = 2;
        s.update(r, 10.25f);
        CHECK_FALSE(r.valid(tween));
        CHECK(r.get<Transform>(target).position.x == doctest::Approx(mode == LoopMode::Restart ? 10 : 0));
    }
}

TEST_CASE("looping delay remainder and large time steps stay bounded") {
    Registry r; TweenSystem s;
    auto target = r.create(); r.emplace<Transform>(target);
    auto tween = s.createTween(r, target, TweenTarget::PositionX, 0, 10, 1);
    auto& data = r.get<TweenData>(tween); data.loop_mode = LoopMode::PingPong; data.delay = .5f;
    s.update(r, 1.75f);
    CHECK(r.get<Transform>(target).position.x == doctest::Approx(7.5));
    s.update(r, 1000000.0f);
    CHECK(r.get<Transform>(target).position.x == doctest::Approx(7.5));
    CHECK(r.get<TweenData>(tween).elapsed == doctest::Approx(.25));
}

TEST_CASE("loop elapsed overflow stays finite") {
    Registry r; TweenSystem s;
    auto target = r.create(); r.emplace<Transform>(target);
    const auto duration = std::numeric_limits<f32>::max();
    auto tween = s.createTween(r, target, TweenTarget::PositionX, 0, 10, duration);
    r.get<TweenData>(tween).loop_mode = LoopMode::Restart;
    s.update(r, duration / 2);
    CHECK(r.get<Transform>(target).position.x == doctest::Approx(5));
    s.update(r, duration);
    CHECK(r.get<Transform>(target).position.x == doctest::Approx(10));
    CHECK(r.get<TweenData>(tween).elapsed == 0);
}

TEST_CASE("delay remainder belongs to its own tween") {
    Registry r; TweenSystem s;
    auto a = r.create(), b = r.create();
    r.emplace<Transform>(a); r.emplace<Transform>(b);
    auto delayed = s.createTween(r, a, TweenTarget::PositionX, 0, 10, 1);
    auto immediate = s.createTween(r, b, TweenTarget::PositionX, 0, 10, 1);
    r.get<TweenData>(delayed).delay = 0.05f;
    s.update(r, 0.1f);
    CHECK(r.get<TweenData>(delayed).elapsed == doctest::Approx(0.05));
    CHECK(r.get<TweenData>(immediate).elapsed == doctest::Approx(0.1));
}

TEST_CASE("disabled tweens pause advancement but cancelled tweens are cleaned up") {
    Registry r; TweenSystem s;
    auto target = r.create(); r.emplace<Transform>(target);
    auto tween = s.createTween(r, target, TweenTarget::PositionX, 0, 10, 1);
    r.setEntityEnabled(target, false);
    s.update(r, 0.2f);
    CHECK(r.get<TweenData>(tween).elapsed == 0);
    r.setEntityEnabled(target, true);
    s.update(r, 0.2f);
    CHECK(r.get<TweenData>(tween).elapsed == doctest::Approx(0.2));
    r.setEntityEnabled(tween, false);
    s.update(r, 0.2f);
    CHECK(r.get<TweenData>(tween).elapsed == doctest::Approx(0.2));
    s.cancelAllTweens(r, target);
    s.update(r, 0.2f);
    CHECK_FALSE(r.valid(tween));
}
