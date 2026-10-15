// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { CHUNK_SIZE, type DecodedChunk } from './chunkCodec';

/**
 * Native chunk readback capability.
 * @experimental
 */
export interface ChunkReadCore {
  tilemap_readChunkIndex?(entity: number, rowsPtr: number, capacity: number): number;
  tilemap_readChunkTiles?(entity: number, x: number, y: number, tilesPtr: number, capacity: number): boolean;
  _malloc?(bytes: number): number;
  _free?(ptr: number): void;
  HEAPU8?: Uint8Array;
}
/**
 * Owned cells and their native edit revision.
 * @experimental
 */
export type CollisionChunkSnapshot = DecodedChunk & { revision: number };
const EMPTY_TILES = new Uint16Array(0);

/** Copies changed chunks while retaining independent JS arrays for unchanged ones.
 * Empty chunks share a zero-length marker and do not reach geometry. Temporary
 * buffers belong to this call, so no retired core is kept alive.
 * @experimental
 */
export function readCollisionChunks(core: ChunkReadCore | null, entity: number,
    previous: ReadonlyMap<string, CollisionChunkSnapshot> | null): Map<string, CollisionChunkSnapshot> | null {
  if (!core?.tilemap_readChunkIndex || !core.tilemap_readChunkTiles || !core._malloc || !core._free || !core.HEAPU8) return null;
  const count = core.tilemap_readChunkIndex(entity, 0, 0);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  if (count === 0) return new Map();
  const indexBytes = count * 12, tileBytes = CHUNK_SIZE ** 2 * 2;
  const ptr = core._malloc(indexBytes + tileBytes);
  if (!ptr) return null;
  try {
    if (core.tilemap_readChunkIndex(entity, ptr, count) !== count) return null;
    const rows = new DataView(core.HEAPU8.buffer, ptr, indexBytes);
    // Chunk reads may grow memory and detach this view; own the index first.
    const index = Array.from({ length: count }, (_, i) => ({ x: rows.getInt32(i * 12, true),
      y: rows.getInt32(i * 12 + 4, true), revision: rows.getUint32(i * 12 + 8, true) }));
    const next = new Map<string, CollisionChunkSnapshot>();
    for (const { x, y, revision } of index) {
      const key = `${x},${y}`, old = previous?.get(key);
      if (old?.revision === revision) { next.set(key, old); continue; }
      if (!core.tilemap_readChunkTiles(entity, x, y, ptr + indexBytes, CHUNK_SIZE ** 2)) return null;
      const tiles = new Uint16Array(CHUNK_SIZE ** 2);
      const input = new DataView(core.HEAPU8.buffer, ptr + indexBytes, tileBytes);
      for (let cell = 0; cell < tiles.length; cell++) tiles[cell] = input.getUint16(cell * 2, true);
      next.set(key, { x, y, tiles: tiles.some(tile => tile !== 0) ? tiles : EMPTY_TILES, revision });
    }
    return next;
  } finally { core._free(ptr); }
}
