// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** A printed frame or benchmark is only acceptable after a clean host exit. */
export function requireNativeHostSuccess(result, label) {
    const reason = result.error
        ? `${result.error.code ?? 'launch error'}: ${result.error.message}`
        : result.signal
            ? `terminated by ${result.signal}`
            : result.status !== 0
                ? `exit ${result.status ?? 'unknown'}`
                : null;
    if (reason === null) return;
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
    throw new Error(`${label}: native host failed (${reason})${tail ? '\n' + tail : ''}`);
}
