// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `assetExclude`: folders a project keeps beside its content that the asset database must not see — a source-art
 *        repository, docs, a server. Out of the scan, out of orphan adoption (no `.meta` is written into them), out of
 *        the watcher's set of content paths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../src/assets/assetDb';
import { isExcludedByProject, isNonContentPath } from '../src/assets/contentPolicy';
import { parseManifest } from '../src/project/format';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'estella-exclude-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function put(rel: string, body = 'x'): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

describe('the manifest field', () => {
  it('keeps folder names, and drops empty ones and any that climb out of the project', () => {
    const m = parseManifest({ name: 'p', assetExclude: ['art', 'docs/', '', '..', '../x', 'a/../b'] });
    expect(m.assetExclude).toEqual(['art', 'docs']);
  });
  it('is absent when none is given', () => {
    expect(parseManifest({ name: 'p' }).assetExclude).toBeUndefined();
  });
});

describe('the content policy', () => {
  it('excludes a folder and everything under it, and nothing that merely starts with its name', () => {
    expect(isExcludedByProject('art', ['art'])).toBe(true);
    expect(isExcludedByProject('art/models/a.glb', ['art'])).toBe(true);
    expect(isExcludedByProject('artifacts/a.png', ['art'])).toBe(false);
    expect(isNonContentPath('art/a.png', ['art'])).toBe(true);
    expect(isNonContentPath('assets/a.png', ['art'])).toBe(false);
  });
});

describe('the asset scan', () => {
  it('neither indexes nor adopts what an excluded folder holds', async () => {
    writeFileSync(path.join(root, 'project.esproject'), JSON.stringify({ name: 'p', assetExclude: ['art'] }));
    put('assets/textures/a.png', 'PNG');
    put('art/source/b.png', 'PNG');
    await scanAssetDatabase(root, { write: false });
    expect(existsSync(path.join(root, 'assets/textures/a.png.meta'))).toBe(true);
    expect(existsSync(path.join(root, 'art/source/b.png.meta'))).toBe(false);
  });

  it('adopts it when the manifest says nothing', async () => {
    writeFileSync(path.join(root, 'project.esproject'), JSON.stringify({ name: 'p' }));
    put('art/source/b.png', 'PNG');
    await scanAssetDatabase(root, { write: false });
    expect(existsSync(path.join(root, 'art/source/b.png.meta'))).toBe(true);
  });
});
