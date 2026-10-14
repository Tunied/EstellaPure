// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Compiler diagnostics when present; otherwise preserve process/filesystem failures. */
export function exampleFailureLines(error) {
    const all = [...new Set([error?.message, error?.stderr?.toString(), error?.stdout?.toString()]
        .filter(Boolean).flatMap(text => text.split(/\r?\n/)).map(line => line.trim()).filter(Boolean))];
    const typed = all.filter(line => line.includes('error TS'));
    return typed.length ? typed : all.length ? all : ['Example check failed without diagnostics.'];
}
