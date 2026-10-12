// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { isWeChat } from '../../platform';

/** Bind to the current host; revocation also drops the callback on older hosts without offWindowResize. */
export function subscribeSafeAreaResize(onResize: (() => void) | null): () => void {
    const listener = () => onResize?.();
    let detach = () => {};
    if (isWeChat()) {
        const host = (globalThis as unknown as { wx?: {
            onWindowResize?(listener: () => void): void;
            offWindowResize?(listener: () => void): void;
        } }).wx;
        if (host?.onWindowResize) {
            host.onWindowResize(listener);
            detach = () => host.offWindowResize?.(listener);
        }
    } else if (typeof window !== 'undefined') {
        const host = window;
        host.addEventListener('resize', listener);
        detach = () => host.removeEventListener('resize', listener);
    }
    return () => {
        if (onResize === null) return;
        onResize = null;
        detach();
    };
}
