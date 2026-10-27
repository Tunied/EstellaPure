// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    acceptWebSocket.ts
 * @brief   Hand a server-side WebSocket to a {@link SessionHost}. Written against
 *          the surface of the `ws` package rather than importing it: the game's
 *          server owns its `ws` install, listener, TLS and proxy settings, and
 *          this is only the seam between that socket and a session.
 */
import type { AcceptedConnection, SessionHost, SessionContext } from './SessionHost';

/** The part of a `ws` WebSocket this adapter uses. */
export interface WebSocketLike {
    on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    on(event: 'error', listener: (err: unknown) => void): unknown;
    send(data: string | ArrayBufferLike | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    /** Bytes accepted by `send` but not yet written to the network. */
    readonly bufferedAmount?: number;
    terminate?(): void;
}

export interface AcceptWebSocketOptions {
    /** A client this far behind on reading is dropped rather than buffered for. Default 4 MiB. */
    maxBufferedBytes?: number;
}

/** Close code for a client too slow to keep up (RFC 6455 "try again later"). */
const TOO_SLOW = 1013;

export function acceptWebSocket<Ctx extends SessionContext>(
    host: SessionHost<Ctx>,
    socket: WebSocketLike,
    options: AcceptWebSocketOptions = {},
): void {
    const maxBuffered = options.maxBufferedBytes ?? 4 * 1024 * 1024;
    const messageHandlers = new Set<(d: string | ArrayBuffer) => void>();
    const closeHandlers = new Set<() => void>();
    let closed = false;

    const finish = (): void => {
        if (closed) return;
        closed = true;
        for (const h of [...closeHandlers]) h();
        closeHandlers.clear();
        messageHandlers.clear();
    };

    socket.on('message', (data, isBinary) => {
        if (closed) return;
        const frame = isBinary ? toArrayBuffer(data) : String(data);
        for (const h of [...messageHandlers]) h(frame);
    });
    socket.on('close', finish);
    // `ws` follows an error with a close; the listener only keeps it from being thrown.
    socket.on('error', () => {});

    const connection: AcceptedConnection = {
        transport: {
            send(data) {
                if (closed) return;
                if ((socket.bufferedAmount ?? 0) > maxBuffered) {
                    connection.close(TOO_SLOW, 'client too slow');
                    return;
                }
                try { socket.send(data); } catch { connection.close(1011, 'send failed'); }
            },
            on(_event, handler) {
                messageHandlers.add(handler);
                return () => messageHandlers.delete(handler);
            },
        },
        close(code, reason) {
            if (closed) return;
            try { socket.close(code, reason); } catch { socket.terminate?.(); }
            // `ws` reports the close only after the peer answers; do not wait on a dead peer.
            finish();
        },
        onClose(handler) {
            if (closed) { queueMicrotask(handler); return () => {}; }
            closeHandlers.add(handler);
            return () => closeHandlers.delete(handler);
        },
    };
    host.accept(connection);
}

function toArrayBuffer(data: unknown): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
        const copy = new Uint8Array(data.byteLength);
        copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        return copy.buffer;
    }
    if (Array.isArray(data)) {
        const total = data.reduce((n: number, part: ArrayBufferView) => n + part.byteLength, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const part of data as ArrayBufferView[]) {
            out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), at);
            at += part.byteLength;
        }
        return out.buffer;
    }
    return new ArrayBuffer(0);
}
