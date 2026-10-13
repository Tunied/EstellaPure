// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { encodeMesh, type BakeStep, type BakeLight } from 'esengine';
import { composeTRS, multiply, IDENTITY } from '../../sdk/src/math/mat4';
import { importFbxMeshes } from '../../pipeline/src/assets/fbxImport';
import { applyLightmapUV, type ImportedNode } from '../../pipeline/src/assets/modelImport';
import { prepareModelImages } from '../../pipeline/src/assets/modelImages';
import { bakeSceneLightmapParallel, BakeKernelExecutor, type SceneBakeInput } from '../../pipeline/src/assets/lightmapBake';
import { loadBakeKernel } from '../../build-tools/lightmap/kernel.mjs';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const source = 'https://developer.nvidia.com/orca/amazon-lumberyard-bistro';

export async function prepare(file: string, out: string) {
  const bytes = await readFile(file);
  const model = await importFbxMeshes(bytes, 'BistroExterior', file, 'orm');
  console.log(`Imported ${model.meshes.length} meshes; unwrapping lightmap UVs`);
  const uvWarnings = applyLightmapUV(model.meshes);
  // A diffuse bake reads base colour/coverage; normal and ORM images do not
  // enter this solve. Use the production DDS/alpha conversion for those inputs.
  for (const mesh of model.meshes) if (mesh.material) {
    delete mesh.material.normalTexture; delete mesh.material.metallicRoughnessTexture;
    delete mesh.material.occlusionTexture; delete mesh.material.emissiveTexture;
  }
  prepareModelImages(model, uri => {
    const name = uri.replace(/\\/g, '/').split('/').pop()!;
    try { return readFileSync(path.join(path.dirname(file), 'Textures', name)); }
    catch { return null; }
  }, { alphaFromBaseColor: true });
  await mkdir(path.join(out, 'meshes'), { recursive: true });
  await mkdir(path.join(out, 'textures'), { recursive: true });
  for (const texture of model.textures) await writeFile(path.join(out, 'textures', path.basename(texture.name)), texture.bytes);
  const paths: string[] = [];
  for (const [i, mesh] of model.meshes.entries()) {
    const target = path.join(out, 'meshes', `${i}.esmesh`);
    await writeFile(target, encodeMesh(mesh.data)); paths.push(target);
    if (mesh.material?.alphaCutoff !== undefined) await writeFile(path.join(out, 'meshes', `${i}.esmaterial`),
      JSON.stringify({ version: '1.0', shader: 'builtin:model', properties: { u_alphaCutoff: mesh.material.alphaCutoff } }));
  }
  const surfaces: SceneBakeInput['surfaces'] = [];
  let triangles = 0;
  const walk = (node: ImportedNode, parent: Float32Array) => {
    const [x, y, z] = node.translation, [qx, qy, qz, qw] = node.rotation, [sx, sy, sz] = node.scale;
    const transform = multiply(parent, Float32Array.from(composeTRS({ x, y, z },
      { x: qx, y: qy, z: qz, w: qw }, { x: sx, y: sy, z: sz }))).slice();
    for (const index of node.meshes) {
      const mesh = model.meshes[index], material = mesh.material;
      triangles += mesh.triangleCount;
      surfaces.push({ meshFile: paths[index], label: node.name, transform: Array.from(transform),
        baseColor: material ? material.baseColor.slice(0, 3) as [number, number, number] : undefined,
        baseColorTexture: material?.baseColorTexture ? path.join(out, 'textures', path.basename(material.baseColorTexture.file)) : undefined,
        twoSided: material ? !material.cullBackfaces : false,
        material: material?.alphaCutoff !== undefined ? path.join(out, 'meshes', `${index}.esmaterial`) : undefined,
      });
    }
    for (const child of node.children) walk(child, transform);
  };
  for (const node of model.nodes) walk(node, IDENTITY);
  const input: SceneBakeInput = { surfaces,
    lights: [{ kind: 'directional', direction: [-0.4, -1, -0.3], color: [1, 0.95, 0.9], intensity: 2 }],
    options: { atlasSize: 4096, texelsPerUnit: 3, bounces: 2, samples: 32, ambient: [0.1, 0.1, 0.1] },
  };
  const metadata = { source, attribution: 'Amazon Lumberyard Bistro, ORCA, CC-BY 4.0',
    fbxSha256: digest(bytes), triangles, uniqueTriangles: model.meshes.reduce((n, m) => n + m.triangleCount, 0),
    surfaces: surfaces.length, warnings: [...model.warnings, ...uvWarnings] };
  await copyFile(path.join(path.dirname(file), 'LICENSE.txt'), path.join(out, 'LICENSE.txt'));
  await writeFile(path.join(out, 'input.json'), JSON.stringify(input));
  await writeFile(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({ triangles, surfaces: surfaces.length, options: input.options, warnings: metadata.warnings.length }));
}

export async function measure(file: string, out: string, original?: string) {
  const input = JSON.parse(await readFile(file, 'utf8')) as SceneBakeInput;
  const raw = original ? await (await import(pathToFileURL(original).href)).loadBakeKernel() : await loadBakeKernel();
  const executor = new BakeKernelExecutor(raw);
  const runs = [];
  for (const [index, intensity] of [2, 0.8, 2].entries()) {
    const changed = { ...input, lights: input.lights.map(l => ({ ...l, intensity } as BakeLight)) };
    const stages: Array<{ kind: string; ms: number }> = [];
    const driver = {
      async run(step: BakeStep) {
        const start = performance.now(); await executor.run(step);
        stages.push({ kind: step.job.kind, ms: performance.now() - start });
      },
      textureStats: executor.textureStats.bind(executor),
    };
    const start = performance.now();
    const result = await bakeSceneLightmapParallel(changed, driver);
    const ms = performance.now() - start;
    await writeFile(path.join(out, `bake-${index}.png`), result.atlasBytes);
    const run = { index, intensity, ms, stages, lumels: result.lumels,
      hash: digest(result.atlasBytes), warnings: result.warnings,
      cache: original ? null : raw.cacheStats() };
    runs.push(run); console.log(JSON.stringify(run));
    await writeFile(path.join(out, 'report.json'), JSON.stringify({ source,
      kernel: original ?? 'visibility-cache', threads: executor.threads, cpu: cpus()[0].model,
      inputSha256: digest(await readFile(file)), options: input.options, runs }, null, 2));
  }
  await executor.close();
}
