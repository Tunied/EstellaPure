// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "Host.hpp"
#include <android/native_activity.h>
#include <android/sensor.h>

namespace eshost {
class AndroidDevice {
public:
    ANativeActivity* activity = nullptr;
    ~AndroidDevice();
    int capabilities() const;
    bool start(bool acceleration, bool gyroscope, int intervalMs);
    void stop();
    bool poll(MotionState& out);
    bool vibrate(int durationMs, int intensity);
    bool keepScreenOn(bool enabled);
private:
    ASensorManager* manager() const;
    ASensorManager* manager_ = nullptr;
    ASensorEventQueue* queue_ = nullptr;
    const ASensor* acceleration_ = nullptr;
    const ASensor* gyroscope_ = nullptr;
    MotionState sample_{};
    bool fresh_ = false;
    static int receive(int, int, void* data);
};
}
