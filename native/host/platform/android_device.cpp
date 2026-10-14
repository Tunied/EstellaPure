// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "platform/android_device.hpp"
#include <android/looper.h>
#include <android/window.h>
#include <algorithm>
#include <jni.h>

namespace eshost {
namespace {
struct JavaEnv {
    JavaVM* vm = nullptr;
    JNIEnv* env = nullptr;
    bool attached = false;
    bool frame = false;
    explicit JavaEnv(ANativeActivity* activity) {
        vm = activity ? activity->vm : nullptr;
        if (!vm) return;
        const int status = vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
        if (status == JNI_EDETACHED) {
            attached = vm->AttachCurrentThread(&env, nullptr) == JNI_OK;
            if (!attached) env = nullptr;
        } else if (status != JNI_OK) env = nullptr;
        if (env) { frame = env->PushLocalFrame(24) == JNI_OK; if (!frame) env->ExceptionClear(); }
    }
    ~JavaEnv() {
        if (env) { if (env->ExceptionCheck()) env->ExceptionClear(); if (frame) env->PopLocalFrame(nullptr); }
        if (attached) vm->DetachCurrentThread();
    }
    explicit operator bool() const { return env && frame; }
};
jobject vibrator(JNIEnv* env, ANativeActivity* activity) {
    jclass cls = env->GetObjectClass(activity->clazz);
    jmethodID get = env->GetMethodID(cls, "getSystemService", "(Ljava/lang/String;)Ljava/lang/Object;");
    if (!get || env->ExceptionCheck()) return nullptr;
    return env->CallObjectMethod(activity->clazz, get, env->NewStringUTF("vibrator"));
}
int vibrationFlags(ANativeActivity* activity) {
    JavaEnv java(activity); if (!java) return 0;
    JNIEnv* env = java.env;
    jobject motor = vibrator(env, activity); if (!motor || env->ExceptionCheck()) return 0;
    jclass cls = env->GetObjectClass(motor);
    jmethodID has = env->GetMethodID(cls, "hasVibrator", "()Z");
    if (!has || env->ExceptionCheck() || !env->CallBooleanMethod(motor, has)) return 0;
    jmethodID amplitude = env->GetMethodID(cls, "hasAmplitudeControl", "()Z");
    if (!amplitude || env->ExceptionCheck()) return 4;
    return 4 | (env->CallBooleanMethod(motor, amplitude) ? 16 : 0);
}
}
AndroidDevice::~AndroidDevice() { stop(); }
ASensorManager* AndroidDevice::manager() const {
    JavaEnv java(activity); if (!java) return nullptr;
    JNIEnv* env = java.env;
    jclass cls = env->GetObjectClass(activity->clazz);
    jmethodID get = env->GetMethodID(cls, "getPackageName", "()Ljava/lang/String;");
    if (!get || env->ExceptionCheck()) return nullptr;
    auto name = static_cast<jstring>(env->CallObjectMethod(activity->clazz, get));
    if (!name || env->ExceptionCheck()) return nullptr;
    const char* chars = env->GetStringUTFChars(name, nullptr);
    if (!chars) return nullptr;
    ASensorManager* result = ASensorManager_getInstanceForPackage(chars);
    env->ReleaseStringUTFChars(name, chars);
    return result;
}
int AndroidDevice::capabilities() const {
    int flags = activity ? 8 : 0;
    if (auto* m = manager()) {
        if (ASensorManager_getDefaultSensor(m, ASENSOR_TYPE_ACCELEROMETER)) flags |= 1;
        if (ASensorManager_getDefaultSensor(m, ASENSOR_TYPE_GYROSCOPE)) flags |= 2;
    }
    return flags | vibrationFlags(activity);
}
bool AndroidDevice::start(bool acceleration, bool gyroscope, int intervalMs) {
    stop();
    auto* m = manager(); auto* looper = ALooper_forThread();
    if (!m || !looper || (!acceleration && !gyroscope)) return false;
    acceleration_ = acceleration ? ASensorManager_getDefaultSensor(m, ASENSOR_TYPE_ACCELEROMETER) : nullptr;
    gyroscope_ = gyroscope ? ASensorManager_getDefaultSensor(m, ASENSOR_TYPE_GYROSCOPE) : nullptr;
    if ((acceleration && !acceleration_) || (gyroscope && !gyroscope_)) return false;
    manager_ = m;
    queue_ = ASensorManager_createEventQueue(m, looper, ALOOPER_POLL_CALLBACK, receive, this);
    if (!queue_) return false;
    for (const ASensor* sensor : { acceleration_, gyroscope_ }) {
        if (!sensor) continue;
        const int rate = std::max(std::max(1, intervalMs) * 1000, ASensor_getMinDelay(sensor));
        if (ASensorEventQueue_enableSensor(queue_, sensor) < 0
            || ASensorEventQueue_setEventRate(queue_, sensor, rate) < 0) { stop(); return false; }
    }
    return true;
}
void AndroidDevice::stop() {
    if (queue_) {
        if (acceleration_) ASensorEventQueue_disableSensor(queue_, acceleration_);
        if (gyroscope_) ASensorEventQueue_disableSensor(queue_, gyroscope_);
        if (manager_) ASensorManager_destroyEventQueue(manager_, queue_);
    }
    queue_ = nullptr; manager_ = nullptr; acceleration_ = nullptr; gyroscope_ = nullptr;
    sample_ = {}; fresh_ = false;
}
int AndroidDevice::receive(int, int, void* data) {
    auto& self = *static_cast<AndroidDevice*>(data);
    ASensorEvent event{};
    while (self.queue_ && ASensorEventQueue_getEvents(self.queue_, &event, 1) > 0) {
        float* target = nullptr;
        if (event.type == ASENSOR_TYPE_ACCELEROMETER) { target = self.sample_.acceleration; self.sample_.hasAcceleration = true; }
        if (event.type == ASENSOR_TYPE_GYROSCOPE) { target = self.sample_.gyroscope; self.sample_.hasGyroscope = true; }
        if (!target) continue;
        for (int i = 0; i < 3; ++i) target[i] = event.data[i];
        self.sample_.timestamp = static_cast<double>(event.timestamp) / 1000000.0;
        self.fresh_ = true;
    }
    return 1;
}
bool AndroidDevice::poll(MotionState& out) {
    if (!fresh_) return false;
    out = sample_; fresh_ = false; return true;
}
bool AndroidDevice::vibrate(int durationMs, int intensity) {
    JavaEnv java(activity); if (!java) return false;
    JNIEnv* env = java.env;
    jobject motor = vibrator(env, activity); if (!motor || env->ExceptionCheck()) return false;
    jclass cls = env->GetObjectClass(motor);
    jmethodID has = env->GetMethodID(cls, "hasVibrator", "()Z");
    if (!has || env->ExceptionCheck() || !env->CallBooleanMethod(motor, has)) return false;
    jclass effectClass = env->FindClass("android/os/VibrationEffect");
    if (!effectClass || env->ExceptionCheck()) return false;
    jmethodID create = env->GetStaticMethodID(effectClass, "createOneShot", "(JI)Landroid/os/VibrationEffect;");
    jmethodID trigger = env->GetMethodID(cls, "vibrate", "(Landroid/os/VibrationEffect;)V");
    if (!create || !trigger || env->ExceptionCheck()) return false;
    const int amplitude = intensity <= 1 ? 64 : intensity >= 3 ? 255 : 128;
    jobject effect = env->CallStaticObjectMethod(effectClass, create, static_cast<jlong>(std::max(1, durationMs)), amplitude);
    if (!effect || env->ExceptionCheck()) return false;
    env->CallVoidMethod(motor, trigger, effect);
    return !env->ExceptionCheck();
}
bool AndroidDevice::keepScreenOn(bool enabled) {
    if (!activity) return false;
    ANativeActivity_setWindowFlags(activity, enabled ? AWINDOW_FLAG_KEEP_SCREEN_ON : 0,
        enabled ? 0 : AWINDOW_FLAG_KEEP_SCREEN_ON);
    return true;
}
}
