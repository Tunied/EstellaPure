// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "../core/Types.hpp"
#include "../core/Reflection.hpp"
#include <algorithm>
#include <cmath>
#include <span>
#include <unordered_set>
#include <vector>

namespace esengine::ecs {
ES_CONST()
static constexpr u32 ENTITY_CHANGE_WORDS = 3;
ES_CONST()
static constexpr u32 ENTITY_CHANGE_NO_COMPONENT = 4294967295;
ES_CONST()
static constexpr u32 ENTITY_CHANGE_CAPACITY = 4096;
ES_CONST()
static constexpr u32 ENTITY_CHANGE_SUBTREE = 1;
ES_CONST()
static constexpr u32 ENTITY_CHANGE_RESET = 2;
ES_CONST()
static constexpr u32 ENTITY_CHANGE_REPLACED = 4;

// Component IDs belong to this host's type domain, never to persisted data.
// Entity-level events carry ENTITY_CHANGE_NO_COMPONENT.
struct EntityChangeRow { u32 entity; u32 flags; u32 component; };
static_assert(sizeof(EntityChangeRow) == ENTITY_CHANGE_WORDS * sizeof(u32));

/** Independent cursors share bounded history. Exhausted or invalid cursors must
 * rescan; reading never consumes another observer's rows. No readers means no
 * retained storage or writes. Raw component references require an explicit record. */
class EntityChangeJournal {
public:
    u32 watch() {
        if (readers_.empty()) {
            rows_.resize(ENTITY_CHANGE_CAPACITY);
            sequence_ = 0;
            exhausted_ = false;
        }
        do { ++next_reader_; } while (!next_reader_ || readers_.contains(next_reader_));
        readers_.insert(next_reader_);
        return next_reader_;
    }
    void unwatch(u32 reader) {
        readers_.erase(reader);
        if (readers_.empty()) std::vector<EntityChangeRow>().swap(rows_);
    }
    double sequence() const { return static_cast<double>(sequence_); }
    usize readerCount() const { return readers_.size(); }
    usize retainedRows() const { return rows_.empty() ? 0 : std::min<u64>(sequence_, ENTITY_CHANGE_CAPACITY); }

    void record(u32 entity, u32 flags = 0, u32 component = ENTITY_CHANGE_NO_COMPONENT) {
        if (readers_.empty()) return;
        // Saturation preserves the JS number contract by requiring a rescan.
        if (sequence_ == MAX_SEQUENCE) { exhausted_ = true; return; }
        ++sequence_;
        rows_[sequence_ % ENTITY_CHANGE_CAPACITY] = {entity, flags, component};
    }

    i32 read(double after, std::span<EntityChangeRow> output) const {
        if (rows_.empty() || exhausted_ || !std::isfinite(after) || after < 0
            || after > sequence() || std::floor(after) != after) return -1;
        const auto cursor = static_cast<u64>(after);
        const auto count = sequence_ - cursor;
        if (count > ENTITY_CHANGE_CAPACITY || count > output.size()) return -1;
        for (u64 i = 0; i < count; ++i) output[i] = rows_[(cursor + i + 1) % ENTITY_CHANGE_CAPACITY];
        return static_cast<i32>(count);
    }

private:
    static constexpr u64 MAX_SEQUENCE = (u64{1} << 53) - 1;
    std::vector<EntityChangeRow> rows_;
    std::unordered_set<u32> readers_;
    u64 sequence_ = 0;
    u32 next_reader_ = 0;
    bool exhausted_ = false;
};
} // namespace esengine::ecs
