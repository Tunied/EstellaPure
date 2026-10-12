// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "Entity.hpp"
#include <tuple>
#include <type_traits>
#include <utility>

namespace esengine::ecs {

// Storage views stay unfiltered for inspection, serialization and hierarchy
// maintenance. Simulation/render consumers explicitly ask for an active view.
template<class V, class R>
class ActiveView {
public:
    class Iterator {
    public:
        Iterator(typename V::Iterator at, typename V::Iterator end, R* registry)
            : at_(at), end_(end), registry_(registry) { skip(); }
        Entity operator*() const { return *at_; }
        Iterator& operator++() { ++at_; skip(); return *this; }
        bool operator!=(const Iterator& other) const { return at_ != other.at_; }
        bool operator==(const Iterator& other) const { return at_ == other.at_; }
    private:
        void skip() { while (at_ != end_ && !registry_->isEntityActive(*at_)) ++at_; }
        typename V::Iterator at_, end_;
        R* registry_;
    };
    ActiveView(V view, R& registry) : view_(std::move(view)), registry_(&registry) {}
    Iterator begin() const { return {view_.begin(), view_.end(), registry_}; }
    Iterator end() const { return {view_.end(), view_.end(), registry_}; }
    template<class T> T& get(Entity e) { return view_.template get<T>(e); }
    decltype(auto) get(Entity e) { return view_.get(e); }
    bool empty() const { return begin() == end(); }
    usize sizeHint() const { return view_.sizeHint(); }
    template<class F> void each(F&& f) {
        view_.each([&](Entity e, auto&... data) {
            if (!registry_->isEntityActive(e)) return;
            invoke(f, e, data...);
        });
    }
    template<class F> void eachLive(F&& f) {
        view_.eachLive([&](Entity e, auto&... data) {
            if (!registry_->isEntityActive(e)) return;
            invoke(f, e, data...);
        });
    }
private:
    template<class F, class... Data>
    static void invoke(F& f, Entity e, Data&... data) {
        if constexpr (std::is_invocable_v<F&, Entity, Data&...>) f(e, data...);
        else if constexpr (std::is_invocable_v<F&, Data&...>) f(data...);
        else f(e);
    }
    V view_;
    R* registry_;
};
} // namespace esengine::ecs
