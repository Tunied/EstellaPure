// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A colour lookup table dropped into a project is adopted as the data it is: no compression, no mips, no sRGB decode.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adoptOrphan, lutStripImporter } from '../src/assets/assetMeta';
import { solidPng } from './fixtures/solidPng.mjs';

let dir = '';
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'estella-lut-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

const write = (name: string, w: number, h: number): string => {
  const file = path.join(dir, name);
  writeFileSync(file, solidPng(w, h, [128, 128, 128, 255]));
  return file;
};
const importerOf = (file: string) => JSON.parse(readFileSync(`${file}.meta`, 'utf8')).importer as Record<string, unknown>;

describe('a lookup-table strip', () => {
  it('is recognised by its shape: N slices of N by N, N squared wide and N high', async () => {
    for (const n of [16, 32, 64]) expect(await lutStripImporter(write(`lut${n}.png`, n * n, n))).not.toBeNull();
    for (const [w, h] of [[512, 512], [1024, 64], [1024, 31], [32, 1024]]) expect(await lutStripImporter(write(`other-${w}x${h}.png`, w, h))).toBeNull();
  });

  it('is adopted as data, and any other image keeps the defaults', async () => {
    const lut = write('warm.png', 1024, 32);
    expect(await adoptOrphan(lut)).toBe('adopted');
    expect(importerOf(lut)).toMatchObject({ compress: 'off', mipmaps: false, sRGB: false, wrapMode: 'clamp', filterMode: 'linear' });
    const picture = write('picture.png', 512, 512);
    await adoptOrphan(picture);
    expect(importerOf(picture)).toMatchObject({ mipmaps: true, sRGB: true, wrapMode: 'repeat' });
  });

  it('gives way to what an importing source asked for, and to a file that already has a meta', async () => {
    const lut = write('asked.png', 1024, 32);
    await adoptOrphan(lut, { wrapMode: 'repeat' });
    expect(importerOf(lut)).toMatchObject({ wrapMode: 'repeat', mipmaps: false });
    expect(await adoptOrphan(lut)).toBe('has-meta');
  });

  it('is not a PNG, or not a readable file: nothing', async () => {
    const notPng = path.join(dir, 'x.jpg');
    writeFileSync(notPng, Buffer.alloc(40));
    expect(await lutStripImporter(notPng)).toBeNull();
    expect(await lutStripImporter(path.join(dir, 'missing.png'))).toBeNull();
  });
});
