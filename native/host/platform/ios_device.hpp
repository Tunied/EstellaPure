// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "Host.hpp"
@class CMMotionManager;
namespace eshost {
class IOSDevice {
public:
    IOSDevice();
    ~IOSDevice();
    int capabilities() const;
    bool start(bool acceleration, bool gyroscope, int intervalMs);
    void stop();
    bool poll(MotionState& out);
    bool vibrate(int durationMs, int intensity);
    bool keepScreenOn(bool enabled);
private:
    mutable CMMotionManager* manager_ = nullptr;
    double timestamp_ = 0;
};
}
