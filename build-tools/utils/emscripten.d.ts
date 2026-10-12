// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for the part of emscripten.js a TypeScript gate consumes.

/** The `emcc` to run, or null where no activated emsdk was found. */
export function emccPath(): string | null;
export function runCommand(command: string, args: readonly string[], options?: {
    cwd?: string;
    silent?: boolean;
    env?: Record<string, string | undefined>;
}): Promise<{ stdout: string; stderr: string; code: number }>;

export const NO_EMCC: string;
export function proveEmcc(suite: string): void;
