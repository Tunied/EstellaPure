// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DeviceEvents, emptyMotion } from './core';
import { DEVICE_OK, DEVICE_UNAVAILABLE, NO_DEVICE_CAPABILITIES, deviceFailure,
    type DeviceBackend, type DeviceResult, type MotionOptions, type MotionSample, type VibrationOptions } from './types';
export interface NativeDeviceHost {
    es_deviceCapabilities?(): number;
    es_startMotion?(accelerometer: boolean, gyroscope: boolean, intervalMs: number): boolean;
    es_stopMotion?(): void;
    es_pollMotion?(): Pick<MotionSample, 'timestamp' | 'accelerationIncludingGravity' | 'gyroscope'> | null;
    es_vibrate?(durationMs: number, intensity: number): boolean;
    es_keepScreenOn?(enabled: boolean): boolean;
}
export class NativeDevice implements DeviceBackend {
    private readonly events = new DeviceEvents();
    private options: MotionOptions | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private hidden = false;
    private disposed = false;
    private screenWanted = false;
    private readonly releases: (() => void)[] = [];
    constructor(private readonly host: NativeDeviceHost,
        lifecycle: { onHide?(handler: () => void): () => void; onShow?(handler: () => void): () => void } = {}) {
        const hide = lifecycle.onHide?.(this.hide), show = lifecycle.onShow?.(this.show);
        if (hide) this.releases.push(hide); if (show) this.releases.push(show);
    }
    capabilities() {
        let flags = 0; try { flags = this.host.es_deviceCapabilities?.() ?? 0; } catch { /* older host */ }
        const motion = !!(this.host.es_startMotion && this.host.es_stopMotion && this.host.es_pollMotion);
        return { ...NO_DEVICE_CAPABILITIES, accelerometer: motion && !!(flags & 1), gyroscope: motion && !!(flags & 2),
            vibration: !!this.host.es_vibrate && !!(flags & 4), vibrationIntensity: !!(flags & 16),
            keepScreenOn: !!this.host.es_keepScreenOn && !!(flags & 8) };
    }
    state() { return { ...this.events.state }; }
    onMotion(handler: Parameters<DeviceBackend['onMotion']>[0]) { return this.events.onMotion(handler); }
    onStateChange(handler: Parameters<DeviceBackend['onStateChange']>[0]) { return this.events.onStateChange(handler); }
    async startMotion(options: MotionOptions = {}): Promise<DeviceResult> {
        const selected = { accelerometer: true, gyroscope: true, orientation: false, rate: 'game' as const, ...options };
        const caps = this.capabilities();
        if (this.disposed || selected.orientation || (!selected.accelerometer && !selected.gyroscope)
            || (selected.accelerometer && !caps.accelerometer) || (selected.gyroscope && !caps.gyroscope)) return DEVICE_UNAVAILABLE;
        this.options = selected; this.pause(); this.events.reset();
        if (this.hidden) return { status: 'denied', reason: 'App is in the background' };
        try {
            const interval = selected.rate === 'normal' ? 200 : selected.rate === 'ui' ? 60 : 16;
            if (!this.host.es_startMotion!(selected.accelerometer, selected.gyroscope, interval)) return { status: 'failed', reason: 'Host refused sensors' };
            this.events.update({ motionActive: true }); this.poll(); return DEVICE_OK;
        } catch (error) { this.pause(); return deviceFailure(error); }
    }
    async stopMotion(): Promise<DeviceResult> { this.options = null; this.pause(); this.events.reset(); return DEVICE_OK; }
    async vibrate(options: VibrationOptions = {}): Promise<DeviceResult> {
        if (this.disposed || this.hidden || !this.capabilities().vibration) return DEVICE_UNAVAILABLE;
        try { return this.host.es_vibrate!(options.duration === 'long' ? 400 : 15,
            options.intensity === 'light' ? 1 : options.intensity === 'heavy' ? 3 : 2) ? DEVICE_OK : { status: 'failed' }; }
        catch (error) { return deviceFailure(error); }
    }
    async keepScreenOn(enabled: boolean): Promise<DeviceResult> {
        if (this.disposed || !this.capabilities().keepScreenOn) return DEVICE_UNAVAILABLE;
        this.screenWanted = enabled;
        try {
            const on = enabled && !this.hidden;
            if (!this.host.es_keepScreenOn!(on)) return { status: 'failed' };
            this.events.update({ screenOn: on }); return DEVICE_OK;
        } catch (error) { return deviceFailure(error); }
    }
    async fullscreen(_enabled: boolean, _target?: unknown): Promise<DeviceResult> { return DEVICE_UNAVAILABLE; }
    async pointerLock(_enabled: boolean, _target?: unknown): Promise<DeviceResult> { return DEVICE_UNAVAILABLE; }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.options = null; this.pause();
        try { this.host.es_keepScreenOn?.(false); } catch { /* host teardown */ }
        for (const release of this.releases) release(); this.events.dispose();
    }
    private pause(): void {
        if (this.timer !== null) clearTimeout(this.timer); this.timer = null;
        this.events.update({ motionActive: false });
        try { this.host.es_stopMotion?.(); } catch { /* host teardown */ }
    }
    private poll = (): void => {
        if (!this.events.state.motionActive || this.disposed) return;
        try {
            const sample = this.host.es_pollMotion?.();
            if (sample) this.events.emit({ ...emptyMotion(), ...sample });
        } catch { this.pause(); return; }
        const interval = this.options?.rate === 'normal' ? 200 : this.options?.rate === 'ui' ? 60 : 16;
        this.timer = setTimeout(this.poll, interval);
    };
    private hide = (): void => {
        this.hidden = true; this.pause(); this.events.reset();
        try { this.host.es_keepScreenOn?.(false); } catch { /* lifecycle must still proceed */ }
        this.events.update({ screenOn: false });
    };
    private show = (): void => {
        if (this.disposed) return;
        this.hidden = false; if (this.options) void this.startMotion(this.options);
        if (this.screenWanted) void this.keepScreenOn(true);
    };
}
