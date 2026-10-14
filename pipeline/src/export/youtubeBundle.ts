// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MiB = 1024 * 1024;
/** Stored package checks; initial transfer/load time still require runtime measurement.
 * https://developers.google.com/youtube/gaming/playables/certification/requirements_stability */
export function checkYouTubeFiles(files: readonly { path: string; bytes: number }[], initialBytes: number) {
    const errors: string[] = [], warnings: string[] = [];
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    if (total >= 250 * MiB) errors.push('YouTube: total bundle must be less than 250 MiB.');
    if (files.length > 8000) errors.push(`YouTube: bundle has ${files.length} files; at most 8000 are allowed.`);
    for (const file of files) {
        if (file.bytes >= 30 * MiB) errors.push(`YouTube: ${file.path} must be less than 30 MiB.`);
        if (!file.path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part))) {
            errors.push(`YouTube: ${file.path} contains unsupported filename characters; use letters, digits, _, - or .`);
        }
    }
    const large = files.filter(file => file.bytes >= 512 * 1024);
    if (large.length) warnings.push(`YouTube: ${large.length} file(s) exceed the recommended size below 512 KiB: ${large.slice(0, 5).map(file => file.path).join(', ')}.`);
    if (initialBytes >= 15 * MiB) warnings.push(`YouTube: static initial-content estimate is ${(initialBytes / MiB).toFixed(2)} MiB, above the recommendation below 15 MiB. Measure actual compressed transfer through gameReady; it must be below 30 MiB.`);
    warnings.push('YouTube: static bundle checks do not measure actual initial transfer, loading time or peak heap. Verify transfer through gameReady, interactivity under 5 seconds and peak JavaScript heap at most 512 MB in the official Test Suite and target devices.');
    return { errors, warnings };
}

export async function checkYouTubeBundle(root: string, initialBytes: number) {
    const files: { path: string; bytes: number }[] = [];
    async function walk(relative: string): Promise<void> {
        for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(name);
            else if (entry.isFile()) files.push({ path: name, bytes: (await stat(path.join(root, name))).size });
            else throw new Error(`YouTube bundle contains an unsupported filesystem entry: ${name}`);
        }
    }
    await walk('');
    return checkYouTubeFiles(files, initialBytes);
}
