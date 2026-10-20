// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.minigame.lean.ts
 * @brief   ESEngine SDK - mini-game family entry with no optional subsystems
 *
 * Same engine as index.minigame, minus Spine, DragonBones, physics, 3D physics,
 * tilemaps, script graphs, gameplay AI and replication. A package built on this
 * imports the subpaths its own content needs (`esengine/spine`,
 * `esengine/physics`, …), which is what installs them.
 *
 * A scene that needs one nobody imported loads without it and says so: what a
 * lean build IS, is a build that ships less. It is what keeps a vendor with a 4MB
 * main package from carrying code its game never runs.
 */
import { installMiniGameEntry } from './runtime/minigameEntry';

installMiniGameEntry();

export * from './index.minigame.base';
