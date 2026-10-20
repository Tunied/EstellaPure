// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  minigameEntry.ts — what every mini-game family entry does before it hands the SDK over.
 *
 * A CALL, for the reason wechatEntry is one: as module side effects in the shared base
 * these are dropped from a lean entry. No platform is set here — the game names its host
 * with installMiniGamePlatform(profile) at boot.
 */
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from '../ecs/component';
import { ensureBuiltinAiRegistrations } from '../ai/builtins';

/** Register every engine component / AI name up front so a scene can never silently drop one,
 *  and snapshot the baseline against a later hot-reload. */
export function installMiniGameEntry(): void {
    ensureBuiltinComponentsRegistered();
    ensureBuiltinAiRegistrations();
    markEngineComponentBaseline();
}
