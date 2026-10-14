// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "platform/ios_device.hpp"
#import <CoreMotion/CoreMotion.h>
#import <CoreHaptics/CoreHaptics.h>
#import <AudioToolbox/AudioToolbox.h>
#import <UIKit/UIKit.h>
#include <algorithm>

namespace eshost {
IOSDevice::IOSDevice() = default;
IOSDevice::~IOSDevice() { stop(); [manager_ release]; }
int IOSDevice::capabilities() const {
    if (!manager_) manager_ = [[CMMotionManager alloc] init];
    int flags = 8;
    if (manager_.accelerometerAvailable) flags |= 1;
    if (manager_.gyroAvailable) flags |= 2;
    if ([CHHapticEngine capabilitiesForHardware].supportsHaptics) flags |= 4 | 16;
    return flags;
}
bool IOSDevice::start(bool acceleration, bool gyroscope, int intervalMs) {
    stop();
    if (!manager_) (void)capabilities();
    if ((!acceleration && !gyroscope) || (acceleration && !manager_.accelerometerAvailable)
        || (gyroscope && !manager_.gyroAvailable)) return false;
    const double interval = std::max(1, intervalMs) / 1000.0;
    if (acceleration) { manager_.accelerometerUpdateInterval = interval; [manager_ startAccelerometerUpdates]; }
    if (gyroscope) { manager_.gyroUpdateInterval = interval; [manager_ startGyroUpdates]; }
    return true;
}
void IOSDevice::stop() {
    [manager_ stopAccelerometerUpdates]; [manager_ stopGyroUpdates]; timestamp_ = 0;
}
bool IOSDevice::poll(MotionState& out) {
    CMAccelerometerData* acceleration = manager_.accelerometerActive ? manager_.accelerometerData : nil;
    CMGyroData* gyroscope = manager_.gyroActive ? manager_.gyroData : nil;
    const double timestamp = std::max(acceleration ? acceleration.timestamp : 0, gyroscope ? gyroscope.timestamp : 0);
    if (timestamp <= timestamp_) return false;
    timestamp_ = timestamp; out = {}; out.timestamp = timestamp * 1000;
    if (acceleration) {
        out.hasAcceleration = true;
        // CoreMotion measures gravitational acceleration; Device's including-
        // gravity channel follows the accelerometer's proper-acceleration sign.
        out.acceleration[0] = static_cast<float>(-acceleration.acceleration.x * 9.80665);
        out.acceleration[1] = static_cast<float>(-acceleration.acceleration.y * 9.80665);
        out.acceleration[2] = static_cast<float>(-acceleration.acceleration.z * 9.80665);
    }
    if (gyroscope) {
        out.hasGyroscope = true;
        out.gyroscope[0] = static_cast<float>(gyroscope.rotationRate.x);
        out.gyroscope[1] = static_cast<float>(gyroscope.rotationRate.y);
        out.gyroscope[2] = static_cast<float>(gyroscope.rotationRate.z);
    }
    return true;
}
bool IOSDevice::vibrate(int durationMs, int intensity) {
    if (!([CHHapticEngine capabilitiesForHardware].supportsHaptics)) return false;
    if (durationMs >= 400) { AudioServicesPlaySystemSound(kSystemSoundID_Vibrate); return true; }
    const UIImpactFeedbackStyle style = intensity <= 1 ? UIImpactFeedbackStyleLight
        : intensity >= 3 ? UIImpactFeedbackStyleHeavy : UIImpactFeedbackStyleMedium;
    UIImpactFeedbackGenerator* feedback = [[UIImpactFeedbackGenerator alloc] initWithStyle:style];
    [feedback prepare]; [feedback impactOccurred]; [feedback release]; return true;
}
bool IOSDevice::keepScreenOn(bool enabled) {
    [UIApplication sharedApplication].idleTimerDisabled = enabled; return true;
}
}
