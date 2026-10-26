// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  plant-lod2.mjs — the third mesh of the trees: a tenth of the first, for the stretch between the art's cheaper mesh and the far cards.
 *
 * The art ships a mesh and a cheaper one at about half its triangles, then crossed cards. Between 60 m and where the cards take over a tree is the
 * cheaper mesh, ten thousand triangles that cover a few hundred pixels: the GPU spends its time on triangles smaller than a pixel. A leaf crown is
 * many separate cards, which the pipeline's border-locked collapse (meshSimplify.ts) cannot merge, so this collapses with the borders free and
 * keeps the normal and the UV as attributes, from the full mesh, never from a cheaper one.
 *
 *   node examples/terrain-water/tools/plant-lod2.mjs [--ratio 0.1] [--error 0.1]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { MeshoptSimplifier } = createRequire(path.join(ROOT, 'pipeline/package.json'))('meshoptimizer');
const { decodeMesh, encodeMesh, MeshChannel, MeshChannelType } = await import(`file:///${path.join(ROOT, 'sdk/dist/index.js').replace(/\\/g, '/')}`);

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const RATIO = flag('ratio', 0.1);
const ERROR = flag('error', 0.1);

/** The prefabs that get a third mesh: the trees. The crowns past the cheaper mesh are what a wood costs. */
export const LOD2_PREFABS = ['tree-oak-dense', 'tree-beech-dense', 'tree-birch', 'tree-willow', 'tree-pine-ridge', 'tree-pine-lakeside'];

/** The meshes a prefab's renderers name, in order. */
const meshesOf = (file) => JSON.parse(readFileSync(file, 'utf8')).entities
  .flatMap((e) => e.components.filter((c) => c.type === 'MeshRenderer').map((c) => c.data.mesh));

const NORMAL_WEIGHT = 0.5, UV_WEIGHT = 1;

function collapse(data) {
  const channel = (semantic, components) => data.channels.find((c) => c.semantic === semantic && c.components >= components && c.type === MeshChannelType.Float32);
  const position = channel(MeshChannel.Position, 3), normal = channel(MeshChannel.Normal, 3), uv = channel(MeshChannel.TexCoord0, 2);
  const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
  const positions = new Float32Array(data.vertexCount * 3);
  const stride = (normal ? 3 : 0) + (uv ? 2 : 0);
  const attributes = new Float32Array(data.vertexCount * stride);
  for (let v = 0; v < data.vertexCount; v++) {
    const at = v * data.vertexStride;
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = view.getFloat32(at + position.offset + k * 4, true);
    let a = v * stride;
    if (normal) for (let k = 0; k < 3; k++) attributes[a++] = view.getFloat32(at + normal.offset + k * 4, true);
    if (uv) for (let k = 0; k < 2; k++) attributes[a++] = view.getFloat32(at + uv.offset + k * 4, true);
  }
  const weights = [...(normal ? [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT] : []), ...(uv ? [UV_WEIGHT, UV_WEIGHT] : [])];
  const triangles = data.indices.length / 3;
  const target = Math.max(1, Math.floor(triangles * RATIO)) * 3;
  const [kept] = MeshoptSimplifier.simplifyWithAttributes(data.indices, positions, 3, attributes, stride, weights, null, target, ERROR, ['Sparse']);
  const remap = new Int32Array(data.vertexCount).fill(-1);
  let used = 0;
  for (const i of kept) if (remap[i] < 0) remap[i] = used++;
  const vertices = new Uint8Array(used * data.vertexStride);
  for (let v = 0; v < data.vertexCount; v++) if (remap[v] >= 0) vertices.set(data.vertices.subarray(v * data.vertexStride, (v + 1) * data.vertexStride), remap[v] * data.vertexStride);
  const indices = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) indices[i] = remap[kept[i]];
  return { ...data, vertexCount: used, vertices, indices };
}

await MeshoptSimplifier.ready;
for (const prefab of LOD2_PREFABS) {
  const base = `assets/plants/models/${prefab}`;
  const prefabFile = path.join(PROJECT, base, `${prefab}.esprefab`);
  if (!existsSync(prefabFile)) { console.log(`${prefab}: no prefab`); continue; }
  for (const mesh of meshesOf(prefabFile)) {
    const data = decodeMesh(new Uint8Array(readFileSync(path.join(PROJECT, mesh))));
    const made = collapse(data);
    const out = path.join(PROJECT, base, 'lod2', path.basename(mesh));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, encodeMesh(made));
    // The export finds a mesh by its meta, which the rules name by path.
    if (!existsSync(`${out}.meta`)) writeFileSync(`${out}.meta`, `${JSON.stringify({ uuid: randomUUID(), version: '2.0', type: 'mesh', importer: {} }, null, 2)}
`);
    console.log(`${path.basename(mesh).padEnd(34)} ${String(data.indices.length / 3).padStart(6)} -> ${String(made.indices.length / 3).padStart(5)} triangles`);
  }
}
