// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureCook.ts
 * @brief   What one texture becomes when it is compressed — for a build and the editor alike.
 *
 * @details The build and the editor ask for the same bytes: the editor shows a
 *          texture as the game will draw it, and both read and write the same
 *          cook cache, so whichever compresses a texture first pays for it once.
 */
import { readTextureCookSettings } from '../project/importSettings';
import { decodePngImage, encodeRgbaPng, downscaleRgba } from './atlasPacker';
import {
  decideTextureCook, cookIntentDefeated, explainTextureCook, downscaledSize,
  type TextureCookDecision,
} from './textureCookDecision';
import { joinMipLevels, halveCoverage } from './ktx2Mips';
import { cookCachedAt, cookCacheFile, cookCacheHitAt, encoderIdentity } from './cookCache';

/** Targets the KTX2 the cook emits can transcode to at runtime (UASTC + ETC1S). */
export const COMPRESSED_TARGETS = ['astc-4x4', 'etc2-rgba8', 's3tc-dxt5'];

/** The slice of the vendored Basis encoder (build-tools/basis/encoder.mjs, a JS
 *  module) the cook uses. Typed locally so the per-texture format/srgb path stays
 *  type-checked without a hand-written `.d.ts`. */
export interface BasisEncoderModule {
  encodePngToKtx2(png: Uint8Array, opts?: { mode?: string; srgb?: boolean }): Promise<Uint8Array>;
  encodeToKtx2(
    source: { type: string; data: Uint8Array; width?: number; height?: number },
    opts?: {
      mode?: string; srgb?: boolean; mipmaps?: boolean; yFlip?: boolean;
      supercompress?: boolean; uastcLevel?: number;
    },
  ): Promise<Uint8Array>;
  transcodeKtx2ToRgba(ktx2: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }>;
  ImageType: { PNG: string; JPG: string; RGBA: string };
  ENCODER_WASM: string;
  ENCODER_PARALLELISM: number;
}

/**
 * A cutout's UASTC chain: level 0 as authored, and each level below it holding as alpha the share of the image's texels the cut at
 * @p cutoff keeps (halveCoverage), the coverage a minified cut-out is drawn with.
 */
async function encodeCoverageChain(enc: BasisEncoderModule, img: { rgba: Uint8Array; width: number; height: number },
                                   srgb: boolean, cutoff: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let level = img;
  let first = true;
  for (;;) {
    parts.push(await enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: level.rgba, width: level.width, height: level.height },
      { mode: 'uastc', srgb, mipmaps: false, supercompress: true }));
    if (level.width === 1 && level.height === 1) break;
    level = halveCoverage(level.rgba, level.width, level.height, srgb, first ? cutoff : null);
    first = false;
  }
  return joinMipLevels(parts);
}

/** A loaded encoder and the identity its outputs are cached under. */
export interface TextureEncoder {
  module: BasisEncoderModule;
  id: string;
}

let encoder: Promise<TextureEncoder> | null = null;

/** The vendored Basis encoder, loaded once. By dynamic import, so the Electron-main
 *  bundle keeps it external rather than inlining a module that resolves its wasm
 *  via import.meta.url. */
export function loadTextureEncoder(): Promise<TextureEncoder> {
  encoder ??= (import('../../../build-tools/basis/encoder.mjs') as Promise<unknown>).then((m) => {
    const module = m as BasisEncoderModule;
    return { module, id: encoderIdentity(module.ENCODER_WASM) };
  });
  return encoder;
}

/** PNG width/height from the IHDR (big-endian u32 at byte offsets 16 / 20) —
 *  a header peek, so the `maxSize` cap can skip decoding textures already in range. */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function safePngDimensions(png: Uint8Array): { width: number; height: number } | null {
  try {
    return pngDimensions(png);
  } catch {
    return null;
  }
}

export interface TextureCookInput {
  root: string;
  /** Project-relative path, for messages. */
  path: string;
  /** The source file's bytes. */
  data: Uint8Array;
  /** The source's extension, with its dot. */
  ext: string;
  importer?: Record<string, unknown>;
  platform?: string;
  /** Null when this cook compresses nothing — the decision is still taken. */
  encoder: TextureEncoder | null;
  compressTextures: boolean;
  /** Apply authored Max Size while shipping raw PNGs, without a KTX2 encoder. */
  resizeTextures?: boolean;
  atlasTextures: boolean;
  /** A mesh draws this texture (texturesDrawnIn3D) — what Auto compression resolves by. */
  drawnIn3D: boolean;
  /** Answer only from the cook cache: an encode it would have to run is left
   *  undone, and the output says `pending` instead. */
  cachedOnly?: boolean;
}

export interface TextureCookOutput {
  data: Uint8Array;
  ext: string;
  cook: TextureCookDecision;
  /** GPU formats the output transcodes to, when it is compressed. */
  compressedFormats?: string[];
  warnings: string[];
  /** Asked to compress, and its source format is one the encoder does not take. */
  defeatedByFormat: boolean;
  /** `cachedOnly`, and the encode this texture asks for has not been run. */
  pending?: boolean;
  /** The cook-cache file the compressed output is kept in. */
  cacheFile?: string;
}

/**
 * One texture as a build ships it: capped at its `maxSize`, then compressed to
 * KTX2 where its Compression and the build ask for it.
 * Encodes go through the cook cache under the source bytes, the settings that
 * shape the output and the encoder's identity.
 */
export async function cookTexture(input: TextureCookInput): Promise<TextureCookOutput> {
  const { root, path, platform } = input;
  let { data, ext } = input;
  const warnings: string[] = [];
  const tex = readTextureCookSettings(input.importer, platform);
  const raster = ext.toLowerCase() === '.png';
  const textureEnc = input.encoder?.module ?? null;
  // maxSize downscale first — it applies even when a texture opts OUT of
  // compression (a huge UI sprite can ship as a smaller raw PNG), and the
  // ENCODED size is what block alignment is judged on.
  const sourceSize = raster ? safePngDimensions(data) : null;
  const scaled = !!((textureEnc || input.resizeTextures) && sourceSize && tex.maxSize > 0 &&
    tex.maxSize < Math.max(sourceSize.width, sourceSize.height));
  const size = scaled ? downscaledSize(sourceSize!.width, sourceSize!.height, tex.maxSize) : sourceSize;
  const scaledImage = () => downscaleRgba(decodePngImage(path, data), tex.maxSize);
  const cook = decideTextureCook({
    compressTextures: input.compressTextures, atlasTextures: input.atlasTextures, inAtlas: false, raster,
    compress: tex.compress, drawnIn3D: input.drawnIn3D, format: tex.format, size,
  });
  let defeatedByFormat = false;
  if (cookIntentDefeated(cook)) {
    // A source format the encoder does not take is a property of the whole
    // project's art, not of one asset — the caller summarizes it once.
    if (cook.reason === 'not-raster') defeatedByFormat = true;
    else warnings.push(`${path}: ${explainTextureCook(cook, size)}`);
  }
  // A texture that ships as an image ships the shrunk one.
  if (cook.selected === 'raw' && scaled) {
    const image = scaledImage();
    data = encodeRgbaPng(image.width, image.height, image.rgba);
  }
  if (cook.selected !== 'raw') {
    // Only a build that encodes can select an encoding, and that is exactly
    // when the encoder was loaded — an absent one here is a broken invariant
    // and should say so rather than silently ship raw.
    const enc = textureEnc!;
    const mode = cook.selected;
    const source = data;
    const coverage = mode === 'uastc' && tex.mipmaps ? tex.mipCoverage : 0;
    const mips = tex.mipmaps ? {} : { mipmaps: false };
    // UASTC levels ship under zstd — the bytes a project's textures cost to move and to store.
    // ETC1S already carries its own supercompression. Part of the key, so an entry cooked
    // before this existed is re-encoded rather than reused.
    const supercompress = mode === 'uastc';
    const key = [source, JSON.stringify({ mode, srgb: tex.srgb, maxSize: tex.maxSize, scaled: scaled ? [size!.width, size!.height] : null,
      // `chain: 2` marks the coverage chain (halveCoverage) that replaced the rescaled one: an entry cooked before it is re-encoded.
      ...(coverage ? { mipCoverage: coverage, chain: 2 } : {}), ...(supercompress ? { supercompress } : {}), ...mips }), input.encoder!.id];
    const produce = (): Promise<Uint8Array> => {
      const image = scaled ? scaledImage() : null;
      return coverage
        ? encodeCoverageChain(enc, image ?? decodePngImage(path, source), tex.srgb, coverage)
        : image
          ? enc.encodeToKtx2({ type: enc.ImageType.RGBA, data: image.rgba, width: image.width, height: image.height }, { mode, srgb: tex.srgb, supercompress, ...mips })
          : enc.encodeToKtx2({ type: enc.ImageType.PNG, data: source }, { mode, srgb: tex.srgb, supercompress, ...mips });
    };
    const file = cookCacheFile(root, key);
    const encoded = input.cachedOnly ? await cookCacheHitAt(file) : (await cookCachedAt(file, produce)).bytes;
    if (!encoded) return { data, ext, cook, warnings, defeatedByFormat, pending: true };
    return { data: encoded, ext: '.ktx2', cook, compressedFormats: COMPRESSED_TARGETS, warnings, defeatedByFormat,
      cacheFile: file };
  }
  return { data, ext, cook, warnings, defeatedByFormat };
}
