// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.minigame.ts
 * @brief   ESEngine SDK — mini-game family entry point, for a vendor the engine
 *          does not ship (or one you are bringing up yourself).
 *
 *          Unlike `esengine/wechat`, this entry does NOT auto-install a
 *          platform: there is no host until you name one. Boot shape:
 *
 *            import {
 *              installMiniGamePlatform, initMiniGameRuntime,
 *            } from 'esengine/minigame';
 *
 *            const profile = {
 *              id: 'myvendor',
 *              hostLabel: 'MyVendor',
 *              get global() { return myHostGlobal; },   // wx-shaped host API
 *            };
 *            installMiniGamePlatform(profile);
 *            await initMiniGameRuntime({
 *              engineFactory, engineWasmPath: 'wasm/esengine.wasm',
 *              sceneNames, firstScene, sideModuleFactories,
 *            });
 *
 *          The profile is DATA. Audio, sockets, video, fs, fetch, canvas, input,
 *          storage and subpackages all come from the normalized host global, so
 *          a vendor whose API matches WeChat's shape and whose wasm is standard
 *          `WebAssembly` writes no methods at all. Override `instantiateWasm`
 *          only if the host insists on its own loader (as WeChat does).
 *
 * @beta    Pre-1.0: the profile contract may still gain fields as vendors beyond
 *          WeChat are brought up against real devices.
 */
// Installs every optional subsystem on the apps this entry builds; `index.minigame.lean`
// is the same base without it.
import { installOptionalPlugins } from './runtime/optionalPlugins';
import { installMiniGameEntry } from './runtime/minigameEntry';

installMiniGameEntry();
installOptionalPlugins();

export * from './index.minigame.base';
