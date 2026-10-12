#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/animation/TweenSystem.hpp"
#include "esengine/ecs/components/Transform.hpp"

using namespace esengine;
using namespace esengine::ecs;
using namespace esengine::animation;

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
