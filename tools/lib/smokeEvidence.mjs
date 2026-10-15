// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Preserve a rejected launch before the next capture reuses its filenames. */
export function retainFirstLaunch(result, directory, label) {
    mkdirSync(directory, { recursive: true });
    const prefix = path.join(directory, path.basename(label) + '.first');
    const shot = result.shot && existsSync(result.shot) ? prefix + '.png' : undefined;
    if (shot) copyFileSync(result.shot, shot);
    const logFile = prefix + '.log';
    const { log, ...metadata } = result;
    writeFileSync(logFile, log ?? '');
    const metadataFile = prefix + '.json';
    writeFileSync(metadataFile, JSON.stringify({
        ...metadata, shot: shot ? path.basename(shot) : null,
        logFile: path.basename(logFile),
    }, null, 2) + '\n');
    return { ...result, shot, logFile, metadataFile };
}
