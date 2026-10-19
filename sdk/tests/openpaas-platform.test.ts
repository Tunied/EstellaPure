// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenPaaSProfile, openpaasProfile, type OpenPaaSEnvironment, type OpenPaaSHost } from '../src/openpaas';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { InputState, inputEventCallbacks } from '../src/input/input';
import type { MiniGameTouchEvent } from '../src/platform/minigame/api';
import { polyfillFetch } from '../src/platform/minigame/fetch';

class XHR {
    static last: XHR;
    responseType = ''; response = new ArrayBuffer(0); responseText = ''; status = 0; timeout = 0;
    onload?: () => void; onerror?: () => void; onabort?: () => void; ontimeout?: () => void;
    headers: Record<string, string> = {};
    open = vi.fn(); send = vi.fn();
    constructor() { XHR.last = this; }
    setRequestHeader(key: string, value: string) { this.headers[key] = value; }
    getAllResponseHeaders() { return 'Content-Type: application/json\r\nX-Trace: a:b\r\n'; }
}

class Socket {
    static last: Socket;
    binaryType = ''; onopen?: () => void; onerror?: (err: unknown) => void;
    onmessage?: (event: { data: string | ArrayBuffer }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    send = vi.fn(); close = vi.fn();
    constructor(readonly url: string, readonly protocols?: string[]) { Socket.last = this; }
}

function fixture() {
    const handlers = new Map<string, Set<Function>>();
    const on = (name: string) => (cb: Function) => {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name)!.add(cb);
    };
    const off = (name: string) => (cb: Function) => { handlers.get(name)?.delete(cb); };
    const fs = {
        readFileSync: vi.fn(() => new ArrayBuffer(8)), readFile: vi.fn(), access: vi.fn(),
        accessSync: vi.fn(), writeFile: vi.fn(), rename: vi.fn(),
    };
    const sud: OpenPaaSHost = {
        env: { USER_DATA_PATH: 'sudfile://usr' },
        createCanvas() {
            expect(this).toBe(sud);
            return { width: 1, height: 1, getContext: () => null };
        },
        createImage: vi.fn() as never, createInnerAudioContext: vi.fn() as never,
        getSystemInfoSync: () => ({ windowWidth: 320, windowHeight: 240, pixelRatio: 2 }),
        getFileSystemManager: () => fs,
        onTouchStart: on('start'), offTouchStart: off('start'),
        onTouchMove: on('move'), offTouchMove: off('move'),
        onTouchEnd: on('end'), offTouchEnd: off('end'),
        onTouchCancel: on('cancel'), offTouchCancel: off('cancel'),
        onHide: on('hide'), offHide: off('hide'), onShow: on('show'), offShow: off('show'),
    };
    const data = new Map<string, string>();
    const env: OpenPaaSEnvironment = {
        sud, XMLHttpRequest: XHR as unknown as typeof XMLHttpRequest,
        WebSocket: Socket as unknown as typeof WebSocket,
        localStorage: {
            getItem: key => data.get(key) ?? null, setItem: (k, v) => { data.set(k, v); },
            removeItem: key => { data.delete(key); }, key: i => [...data.keys()][i] ?? null,
            get length() { return data.size; },
        },
        WebAssembly: { instantiateFromFile: vi.fn() },
    };
    const profile = createOpenPaaSProfile(env);
    const adapter = new MiniGamePlatformAdapter(profile);
    const emit = (name: string, event?: unknown) => { for (const cb of handlers.get(name) ?? []) cb(event); };
    return { env, profile, adapter, fs, emit, handlers, data };
}

afterEach(() => vi.unstubAllGlobals());

describe('SUD OpenPaaS host contract (not device acceptance)', () => {
    it('imports without sud and reports a useful error only when selected', () => {
        vi.stubGlobal('sud', undefined);
        expect(openpaasProfile.id).toBe('openpaas');
        expect(() => openpaasProfile.global).toThrow('requires the sud runtime');
    });

    it('loads a real wasm instance through the package-path API, including an iOS result without module', async () => {
        const { env, adapter } = fixture();
        const bytes = Uint8Array.from([0,97,115,109,1,0,0,0]);
        const result = await WebAssembly.instantiate(bytes, {});
        env.WebAssembly.instantiateFromFile = vi.fn(async () => ({ instance: result.instance }));
        const imports = { env: { memory: new WebAssembly.Memory({ initial: 1 }) } };
        const loaded = await adapter.instantiateWasm('./wasm/../wasm/core.wasm', imports);
        expect(loaded.instance).toBeInstanceOf(WebAssembly.Instance);
        expect(loaded.module).toBeUndefined();
        expect(env.WebAssembly.instantiateFromFile).toHaveBeenCalledWith('wasm/core.wasm', imports);
        await expect(adapter.instantiateWasm(bytes.buffer, {})).rejects.toThrow('package file path');
        await expect(adapter.instantiateWasm('../escape.wasm', {})).rejects.toThrow('escapes');
    });

    it('reports unavailable loaders and native wasm failures without hanging', async () => {
        const { env, adapter } = fixture();
        env.WebAssembly.instantiateFromFile = undefined;
        await expect(adapter.instantiateWasm('core.wasm', {})).rejects.toThrow('missing WebAssembly.instantiateFromFile');
        env.WebAssembly.instantiateFromFile = vi.fn(async () => { throw new Error('unsupported import'); });
        await expect(adapter.instantiateWasm('core.wasm', {})).rejects.toThrow('unsupported import');
    });

    it('normalizes package paths but preserves user-data aliases and does not use a network fetch for files', async () => {
        const { adapter, fs } = fixture();
        await adapter.readFile('./assets/./model.glb');
        expect(fs.readFileSync).toHaveBeenLastCalledWith('assets/model.glb', undefined);
        await adapter.readFile('sudfile://usr/cache.bin');
        expect(fs.readFileSync).toHaveBeenLastCalledWith('sudfile://usr/cache.bin', undefined);
        await expect(adapter.readFile('../secret')).rejects.toThrow('escapes');
    });

    it('preserves persistent empty values and clears only a requested namespace', () => {
        const { adapter, profile, data } = fixture();
        adapter.setStorageItem('game:empty', ''); adapter.setStorageItem('other', '0');
        const restarted = new MiniGamePlatformAdapter(profile);
        expect(restarted.getStorageItem('game:empty')).toBe('');
        expect(restarted.getStorageItem('missing')).toBeNull();
        restarted.clearStorage('game:');
        expect(data.has('game:empty')).toBe(false);
        expect(restarted.getStorageItem('other')).toBe('0');
    });

    it('maps HTTP method, body, timeout, headers and non-2xx responses without swallowing failures', async () => {
        const { adapter } = fixture();
        const pending = adapter.fetch('https://game.example/api', {
            method: 'POST', body: 'payload', headers: { Authorization: 'test' }, timeout: 1234,
        });
        const xhr = XHR.last;
        expect(xhr.open).toHaveBeenCalledWith('POST', 'https://game.example/api', true);
        expect(xhr.send).toHaveBeenCalledWith('payload'); expect(xhr.timeout).toBe(1234);
        expect(xhr.headers.Authorization).toBe('test');
        xhr.status = 404; xhr.responseText = '{"message":"missing"}'; xhr.onload!();
        const response = await pending;
        expect(response.ok).toBe(false); expect(response.status).toBe(404);
        expect(response.headers['x-trace']).toBe('a:b');
        expect(await response.json()).toEqual({ message: 'missing' });
        for (const event of ['onerror', 'ontimeout', 'onabort'] as const) {
            const failed = adapter.fetch('https://game.example/fail');
            XHR.last[event]!();
            await expect(failed).rejects.toThrow('OpenPaaS');
        }
    });

    it('keeps binary resource responses intact', async () => {
        const { adapter } = fixture();
        const pending = adapter.fetch('https://game.example/model.glb', { responseType: 'arraybuffer' });
        const buffer = Uint8Array.from([0, 255, 2, 0]).buffer;
        XHR.last.status = 200; XHR.last.response = buffer; XHR.last.onload!();
        expect(await (await pending).arrayBuffer()).toBe(buffer);
    });

    it('provides fetch response headers when the native host has neither fetch nor Headers', async () => {
        const { profile } = fixture();
        vi.stubGlobal('fetch', undefined); vi.stubGlobal('Headers', undefined);
        polyfillFetch(profile.global);
        const pending = fetch('https://game.example/resource');
        XHR.last.status = 200; XHR.last.responseText = 'ok'; XHR.last.onload!();
        const response = await pending;
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('missing')).toBeNull();
        expect(response.headers.has('X-Trace')).toBe(true);
        expect(await response.text()).toBe('ok');
    });

    it('bridges native WebSocket events, binary messages and queued sends', () => {
        const { adapter } = fixture();
        const socket = adapter.createSocket({ url: 'wss://game.example', protocols: ['game'] });
        const opened = vi.fn(), received = vi.fn(), closed = vi.fn();
        socket.on('open', opened); socket.on('message', received); socket.on('close', closed);
        socket.send('queued'); socket.connect();
        expect(Socket.last.protocols).toEqual(['game']); expect(Socket.last.binaryType).toBe('arraybuffer');
        Socket.last.onopen!(); expect(opened).toHaveBeenCalledOnce();
        expect(Socket.last.send).toHaveBeenCalledWith('queued');
        const bytes = new ArrayBuffer(4); Socket.last.onmessage!({ data: bytes });
        expect(received).toHaveBeenCalledWith(bytes);
        socket.close(1000, 'done'); expect(Socket.last.close).toHaveBeenCalledWith(1000, 'done');
        Socket.last.onclose!({ code: 1000, reason: 'done' });
        expect(socket.readyState).toBe('closed'); expect(closed).toHaveBeenCalledWith(1000, 'done');
    });

    it('sizes the primary canvas and cancels held input on hide with removable listeners', () => {
        const { adapter, emit, handlers } = fixture();
        const canvas = adapter.createScreenCanvas();
        expect([canvas.width, canvas.height]).toEqual([640, 480]);
        const input = new InputState(); adapter.bindInputEvents(inputEventCallbacks(input));
        emit('start', { changedTouches: [{ identifier: 7, clientX: 20, clientY: 30 }] } satisfies MiniGameTouchEvent);
        expect(input.touches.size).toBe(1);
        emit('hide'); expect(input.touches.size).toBe(0);
        adapter.unbindInputEvents();
        expect([...handlers.values()].every(set => set.size === 0)).toBe(true);
        expect(adapter.canPay()).toBe(false); expect(adapter.canSignIn()).toBe(false);
    });
});
