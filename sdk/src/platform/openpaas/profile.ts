// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type {
    MiniGameGlobal, MiniGameProfile, MiniGameRequestOptions, MiniGameSocketTask,
    MiniGameFileSystemManager,
} from '../minigame/api';
import type { WasmInstantiateResult } from '../types';

/** The documented sud surface, before bridging standard Web APIs into the family. */
export type OpenPaaSHost = Pick<MiniGameGlobal,
    'createCanvas' | 'createImage' | 'getFileSystemManager' | 'createInnerAudioContext'
    | 'getSystemInfoSync' | 'onTouchStart' | 'onTouchMove' | 'onTouchEnd'
    | 'offTouchStart' | 'offTouchMove' | 'offTouchEnd'> & Partial<Pick<MiniGameGlobal,
    'env' | 'onTouchCancel' | 'offTouchCancel' | 'onShow' | 'offShow' | 'onHide' | 'offHide'
    | 'onError' | 'offError' | 'onWindowResize' | 'showLoading' | 'hideLoading'>>;

/** Injectable host dependencies; importing the SDK does not touch native globals. */
export interface OpenPaaSEnvironment {
    sud: OpenPaaSHost;
    localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
    XMLHttpRequest: typeof XMLHttpRequest;
    WebSocket: typeof WebSocket;
    WebAssembly: {
        instantiateFromFile?(path: string, imports: WebAssembly.Imports): Promise<WasmInstantiateResult>;
    };
}

/** Package files are rooted at the game directory; user-data aliases stay intact. */
function packagePath(path: string): string {
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path)) return path;
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) throw new Error('OpenPaaS package path escapes the game directory');
            parts.pop();
        } else parts.push(part);
    }
    return parts.join('/');
}

function fileSystem(fs: MiniGameFileSystemManager): MiniGameFileSystemManager {
    return {
        readFileSync: (path, encoding) => fs.readFileSync(packagePath(path), encoding),
        readFile: opts => fs.readFile({ ...opts, filePath: packagePath(opts.filePath) }),
        access: opts => fs.access({ ...opts, path: packagePath(opts.path) }),
        accessSync: path => fs.accessSync(packagePath(path)),
        writeFile: opts => fs.writeFile({ ...opts, filePath: packagePath(opts.filePath) }),
        ...(fs.readdir ? { readdir: (opts: Parameters<NonNullable<typeof fs.readdir>>[0]) =>
            fs.readdir!({ ...opts, dirPath: packagePath(opts.dirPath) }) } : {}),
        ...(fs.stat ? { stat: (opts: Parameters<NonNullable<typeof fs.stat>>[0]) =>
            fs.stat!({ ...opts, path: packagePath(opts.path) }) } : {}),
        ...(fs.unlink ? { unlink: (opts: Parameters<NonNullable<typeof fs.unlink>>[0]) =>
            fs.unlink!({ ...opts, filePath: packagePath(opts.filePath) }) } : {}),
        ...(fs.rename ? { rename: (opts: Parameters<NonNullable<typeof fs.rename>>[0]) =>
            fs.rename!({ ...opts, oldPath: packagePath(opts.oldPath), newPath: packagePath(opts.newPath) }) } : {}),
    };
}

function request(env: OpenPaaSEnvironment, opts: MiniGameRequestOptions): void {
    const xhr = new env.XMLHttpRequest();
    let settled = false;
    const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        opts.fail?.({ errMsg: `OpenPaaS ${message}: ${opts.url}` });
    };
    xhr.open(opts.method ?? 'GET', opts.url, true);
    xhr.responseType = opts.responseType === 'arraybuffer' ? 'arraybuffer' : 'text';
    if (opts.timeout !== undefined) xhr.timeout = opts.timeout;
    for (const [name, value] of Object.entries(opts.header ?? {})) xhr.setRequestHeader(name, value);
    xhr.onload = () => {
        if (settled) return;
        settled = true;
        const header: Record<string, string> = {};
        for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
            const colon = line.indexOf(':');
            if (colon > 0) header[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        opts.success?.({ statusCode: xhr.status, header,
            data: xhr.responseType === 'arraybuffer' ? xhr.response : xhr.responseText });
    };
    xhr.onerror = () => fail('request failed');
    xhr.ontimeout = () => fail('request timed out');
    xhr.onabort = () => fail('request aborted');
    xhr.send(opts.data ?? null);
}

function connectSocket(env: OpenPaaSEnvironment, opts: { url: string; protocols?: string[] }): MiniGameSocketTask {
    const socket = opts.protocols?.length
        ? new env.WebSocket(opts.url, opts.protocols) : new env.WebSocket(opts.url);
    socket.binaryType = 'arraybuffer';
    return {
        send: ({ data }) => socket.send(data),
        close: ({ code, reason }) => socket.close(code, reason),
        onOpen: cb => { socket.onopen = cb; },
        onMessage: cb => { socket.onmessage = event => cb({ data: event.data }); },
        onClose: cb => { socket.onclose = event => cb({ code: event.code, reason: event.reason }); },
        onError: cb => { socket.onerror = cb; },
    };
}

/** Bind documented APIs only. Commercial services require their own acceptance. */
function normalize(env: OpenPaaSEnvironment): MiniGameGlobal {
    const sud = env.sud;
    const required = <K extends keyof OpenPaaSHost>(key: K): OpenPaaSHost[K] => {
        const value = sud[key];
        return (typeof value === 'function' ? value.bind(sud) : value) as OpenPaaSHost[K];
    };
    const host: MiniGameGlobal = {
        createCanvas: required('createCanvas'), createImage: required('createImage'),
        createInnerAudioContext: required('createInnerAudioContext'),
        getSystemInfoSync: required('getSystemInfoSync'),
        getFileSystemManager: () => fileSystem(sud.getFileSystemManager()),
        onTouchStart: required('onTouchStart'), onTouchMove: required('onTouchMove'),
        onTouchEnd: required('onTouchEnd'), offTouchStart: required('offTouchStart'),
        offTouchMove: required('offTouchMove'), offTouchEnd: required('offTouchEnd'),
        request: opts => request(env, opts),
        connectSocket: opts => connectSocket(env, opts),
        getStorageSync: key => env.localStorage.getItem(key),
        setStorageSync: (key, value) => env.localStorage.setItem(key, value),
        removeStorageSync: key => env.localStorage.removeItem(key),
        getStorageInfoSync: () => {
            const keys: string[] = [];
            for (let i = 0; i < env.localStorage.length; i++) {
                const key = env.localStorage.key(i);
                if (key !== null) keys.push(key);
            }
            return { keys };
        },
        env: sud.env,
    };
    for (const key of ['onTouchCancel', 'offTouchCancel', 'onShow', 'offShow', 'onHide', 'offHide',
        'onError', 'offError', 'onWindowResize', 'showLoading', 'hideLoading'] as const) {
        const fn = sud[key];
        if (fn) Object.defineProperty(host, key, { value: fn.bind(sud), enumerable: true });
    }
    return host;
}

/** Create a SUD OpenPaaS profile over native APIs or a headless contract fixture. */
export function createOpenPaaSProfile(environment: OpenPaaSEnvironment): MiniGameProfile {
    return {
        id: 'openpaas', hostLabel: 'SUD OpenPaaS',
        global: normalize(environment),
        async instantiateWasm(pathOrBuffer, imports) {
            if (typeof pathOrBuffer !== 'string') {
                throw new Error('OpenPaaS WebAssembly.instantiateFromFile requires a package file path');
            }
            const wasm = environment.WebAssembly;
            if (typeof wasm.instantiateFromFile !== 'function') {
                throw new Error('OpenPaaS runtime is missing WebAssembly.instantiateFromFile');
            }
            try {
                return await wasm.instantiateFromFile(packagePath(pathOrBuffer), imports);
            } catch (error) {
                throw new Error(`OpenPaaS failed to instantiate ${pathOrBuffer}; verify the runtime supports this module's imports, SIMD and BigInt: ${String(error)}`);
            }
        },
    };
}

/** Lazy: safe to bundle on a desktop where `sud` is absent. */
export const openpaasProfile: MiniGameProfile = {
    id: 'openpaas', hostLabel: 'SUD OpenPaaS',
    get global() { return createOpenPaaSProfile(runtimeEnvironment()).global; },
    instantiateWasm(path, imports) { return createOpenPaaSProfile(runtimeEnvironment()).instantiateWasm!(path, imports); },
};

function runtimeEnvironment(): OpenPaaSEnvironment {
    const env = globalThis as unknown as OpenPaaSEnvironment;
    if (!env.sud) throw new Error('SUD OpenPaaS requires the sud runtime (PinK / Hello PinK)');
    return env;
}
