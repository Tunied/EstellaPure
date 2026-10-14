// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDevice } from '../src/device/web';
import { MiniGameDevice, type MiniGameDeviceHost } from '../src/device/minigame';
import { NativeDevice } from '../src/device/native';
import { DeviceEvents, emptyMotion, unavailableDevice } from '../src/device/core';
import type { MotionSample } from '../src/device/types';

afterEach(() => vi.useRealTimers());
function web(options: { permission?: string; wake?: unknown } = {}) {
    const win = new EventTarget() as EventTarget & Record<string, unknown>;
    const permission = vi.fn(() => Promise.resolve(options.permission ?? 'granted'));
    win.DeviceMotionEvent = { requestPermission: permission };
    win.DeviceOrientationEvent = { requestPermission: permission };
    const doc = new EventTarget() as EventTarget & Record<string, unknown>;
    doc.hidden = false; doc.fullscreenElement = null; doc.pointerLockElement = null;
    const element = {
        requestFullscreen: vi.fn(async () => { doc.fullscreenElement = element; doc.dispatchEvent(new Event('fullscreenchange')); }),
        requestPointerLock: vi.fn(() => { doc.pointerLockElement = element; doc.dispatchEvent(new Event('pointerlockchange')); }),
    };
    doc.documentElement = element;
    doc.exitFullscreen = vi.fn(async () => { doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); });
    doc.exitPointerLock = vi.fn(() => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); });
    const nav = { vibrate: vi.fn(() => true), wakeLock: options.wake };
    const device = new WebDevice(win as unknown as Window, doc as unknown as Document, nav as unknown as Navigator);
    const dispatchMotion = () => {
        const event = new Event('devicemotion');
        Object.assign(event, { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 1, y: 2, z: 9 },
            rotationRate: { alpha: 180, beta: 90, gamma: 0 } }); win.dispatchEvent(event);
    };
    return { device, win, doc, nav, element, permission, dispatchMotion };
}
function mini() {
    const handlers = new Set<(v: { x: number; y: number; z: number }) => void>();
    const gyros = new Set<(v: { x: number; y: number; z: number }) => void>();
    let hide = () => {}, show = () => {};
    const succeed = vi.fn((options: { success?(): void }) => options.success?.());
    const host: MiniGameDeviceHost = {
        startAccelerometer: succeed, stopAccelerometer: succeed, startGyroscope: succeed, stopGyroscope: succeed,
        onAccelerometerChange: h => { handlers.add(h); }, offAccelerometerChange: h => { handlers.delete(h); },
        onGyroscopeChange: h => { gyros.add(h); }, offGyroscopeChange: h => { gyros.delete(h); },
        vibrateShort: succeed, vibrateLong: succeed, setKeepScreenOn: succeed,
        onHide: h => { hide = h; }, offHide: () => { hide = () => {}; },
        onShow: h => { show = h; }, offShow: () => { show = () => {}; },
    };
    const device = new MiniGameDevice(host, () => 1234);
    return { device, host, handlers, gyros, hide: () => hide(), show: () => show(), succeed };
}

describe('device capability results', () => {
    it('an unsupported platform returns unavailable without throwing', async () => {
        const device = unavailableDevice();
        expect(Object.values(device.capabilities()).every(v => !v)).toBe(true);
        for (const result of await Promise.all([device.startMotion(), device.vibrate(), device.keepScreenOn(true), device.fullscreen(true), device.pointerLock(true)])) {
            expect(result.status).toBe('unavailable');
        }
    });
    it('filters gravity and wrapped orientation without mixing angular units', () => {
        const events = new DeviceEvents(); const samples: MotionSample[] = [];
        events.onMotion(s => samples.push(s)); events.update({ motionActive: true });
        events.emit({ ...emptyMotion(), accelerationIncludingGravity: { x: 0, y: 0, z: 10 }, orientation: { x: 0, y: 0, z: 359 } });
        events.emit({ ...emptyMotion(), accelerationIncludingGravity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 1 } });
        expect(samples[1].gravity!.z).toBeCloseTo(8.5); expect(samples[1].orientation!.z).toBeCloseTo(359.3);
    });
});
describe('Web device lifecycle and gesture requests', () => {
    it('requests iOS permissions from the original synchronous gesture and reports denial', async () => {
        const w = web({ permission: 'denied' });
        const pending = w.device.startMotion({ orientation: true });
        expect(w.permission).toHaveBeenCalledTimes(2);
        expect((await pending).status).toBe('denied'); expect(w.device.state().motionActive).toBe(false);
        w.device.dispose();
    });
    it('normalizes gyro degrees, stops on background, and resumes without a second permission prompt', async () => {
        const w = web(); const samples: MotionSample[] = []; w.device.onMotion(s => samples.push(s));
        expect((await w.device.startMotion()).status).toBe('ok'); w.dispatchMotion();
        expect(samples[0].gyroscope!.z).toBeCloseTo(Math.PI);
        w.doc.hidden = true; w.doc.dispatchEvent(new Event('visibilitychange')); w.dispatchMotion();
        expect(samples).toHaveLength(1); expect(w.device.state().motionActive).toBe(false);
        w.doc.hidden = false; w.doc.dispatchEvent(new Event('visibilitychange'));
        expect(w.device.state().motionActive).toBe(true); expect(w.permission).toHaveBeenCalledTimes(1);
        w.device.dispose(); w.dispatchMotion(); expect(samples).toHaveLength(1);
    });
    it('stopping during an outstanding permission request prevents late sensor activation', async () => {
        const w = web(); let grant!: (value: string) => void;
        w.win.DeviceMotionEvent = { requestPermission: () => new Promise<string>(resolve => { grant = resolve; }) };
        const pending = w.device.startMotion(); await w.device.stopMotion(); grant('granted');
        expect((await pending).status).toBe('failed'); expect(w.device.state().motionActive).toBe(false); w.device.dispose();
    });
    it('observes fullscreen and pointer lock exits and reports denied pointer requests', async () => {
        const w = web(); const changed = vi.fn(); w.device.onStateChange(changed);
        expect((await w.device.fullscreen(true)).status).toBe('ok'); expect(w.device.state().fullscreen).toBe(true);
        expect((await w.device.fullscreen(false)).status).toBe('ok');
        expect((await w.device.pointerLock(true)).status).toBe('ok'); expect(w.device.state().pointerLocked).toBe(true);
        w.doc.pointerLockElement = null; w.doc.dispatchEvent(new Event('pointerlockchange'));
        expect(w.device.state().pointerLocked).toBe(false);
        w.element.requestPointerLock.mockImplementation(() => { w.doc.dispatchEvent(new Event('pointerlockerror')); });
        expect((await w.device.pointerLock(true)).status).toBe('denied'); expect(changed).toHaveBeenCalled(); w.device.dispose();
    });
    it('releases a wake request which resolves after background or disable', async () => {
        let resolve!: (value: unknown) => void;
        const sentinel = { released: false, release: vi.fn(async () => {}), addEventListener: vi.fn() };
        const w = web({ wake: { request: () => new Promise(r => { resolve = r; }) } });
        const pending = w.device.keepScreenOn(true); await w.device.keepScreenOn(false); resolve(sentinel);
        expect((await pending).status).toBe('failed'); expect(sentinel.release).toHaveBeenCalledTimes(1);
        expect(w.device.state().screenOn).toBe(false); w.device.dispose();
    });
});
describe('mini-game device contract (WeChat and Douyin family)', () => {
    it('uses SI acceleration and host gyro radians, retains listeners until stop', async () => {
        const m = mini(); const samples: MotionSample[] = []; m.device.onMotion(s => samples.push(s));
        expect((await m.device.startMotion({ rate: 'ui' })).status).toBe('ok');
        for (const h of m.handlers) h({ x: 1, y: 0, z: 0 });
        for (const h of m.gyros) h({ x: 0, y: 2, z: 0 });
        expect(samples[0].accelerationIncludingGravity!.x).toBeCloseTo(9.80665); expect(samples[1].gyroscope!.y).toBe(2);
        await m.device.stopMotion(); expect(m.handlers.size + m.gyros.size).toBe(0); m.device.dispose();
    });
    it('cleans up partially started sensors when the second channel fails', async () => {
        const m = mini(); m.host.startGyroscope = options => options.fail?.({ errMsg: 'permission denied' });
        expect((await m.device.startMotion()).status).toBe('denied');
        expect(m.handlers.size + m.gyros.size).toBe(0); expect(m.device.state().motionActive).toBe(false); m.device.dispose();
    });
    it('never reactivates a sensor whose start callback arrives after backgrounding', async () => {
        const m = mini(); let success!: () => void;
        m.host.startAccelerometer = options => { success = options.success!; };
        const pending = m.device.startMotion({ gyroscope: false });
        await vi.waitFor(() => expect(success).toBeTypeOf('function')); m.hide(); success();
        expect((await pending).status).toBe('failed'); expect(m.device.state().motionActive).toBe(false);
        m.device.dispose();
    });
    it('reports a host unsupported response as unavailable', async () => {
        const m = mini(); m.host.vibrateShort = options => options.fail?.({ errMsg: 'vibrateShort:fail not supported on PC' });
        expect((await m.device.vibrate()).status).toBe('unavailable'); m.device.dispose();
    });
    it('a late wake callback cannot overwrite a newer disable request', async () => {
        const m = mini(); let finish!: () => void;
        m.host.setKeepScreenOn = options => { if (options.keepScreenOn) finish = options.success!; else options.success?.(); };
        const pending = m.device.keepScreenOn(true); await m.device.keepScreenOn(false); finish();
        expect((await pending).status).toBe('failed'); expect(m.device.state().screenOn).toBe(false); m.device.dispose();
    });
    it('selects short strength/long vibration and reports missing channels', async () => {
        const m = mini(); expect((await m.device.vibrate({ intensity: 'heavy' })).status).toBe('ok');
        expect(m.succeed).toHaveBeenCalledWith(expect.objectContaining({ type: 'heavy' }));
        expect((await m.device.vibrate({ duration: 'long' })).status).toBe('ok');
        m.host.startGyroscope = undefined; expect((await m.device.startMotion()).status).toBe('unavailable');
        expect((await m.device.fullscreen(true)).status).toBe('unavailable'); m.device.dispose();
    });
});
describe('native device bridge', () => {
    it('polls real host-shaped samples, cancels timers on hide, and restores requested state', async () => {
        vi.useFakeTimers(); let hide = () => {}, show = () => {};
        const poll = vi.fn(() => ({ timestamp: 16, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, gyroscope: null }));
        const stop = vi.fn(), wake = vi.fn(() => true);
        const device = new NativeDevice({ es_deviceCapabilities: () => 31, es_startMotion: () => true,
            es_stopMotion: stop, es_pollMotion: poll, es_vibrate: () => true, es_keepScreenOn: wake },
        { onHide: h => { hide = h; return () => {}; }, onShow: h => { show = h; return () => {}; } });
        expect((await device.startMotion()).status).toBe('ok'); await device.keepScreenOn(true); hide();
        const count = poll.mock.calls.length; await vi.advanceTimersByTimeAsync(200);
        expect(poll).toHaveBeenCalledTimes(count); expect(device.state().screenOn).toBe(false);
        show(); await Promise.resolve(); expect(device.state().motionActive).toBe(true); expect(device.state().screenOn).toBe(true);
        device.dispose(); expect(vi.getTimerCount()).toBe(0); expect(stop).toHaveBeenCalled();
    });
    it('an old host or a desktop without sensors remains explicitly unavailable', async () => {
        const device = new NativeDevice({ es_deviceCapabilities: () => 0 });
        expect((await device.startMotion()).status).toBe('unavailable'); expect((await device.vibrate()).status).toBe('unavailable'); device.dispose();
    });
});
