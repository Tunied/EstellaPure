// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The example's scene: Bistro's pieces, a sun that follows the sky, a probe volume and a camera.
 *
 * `pieces.json` holds what the source's hierarchy came to — one entry per mesh the camera can see, with
 * the world transform it ends up at (centimetres, Y up) and the renderer data the import wrote. The scene
 * is FLAT because `estella bake-scene` bakes the document it is given, and a hierarchy is only resolved by
 * the editor. The bake then writes the lightmap, probe grid and reflections beside it:
 *
 *   node examples/bistro/tools/build-scene.mjs
 *   node pipeline/bin/estella.mjs bake-scene examples/bistro/assets/scenes/main.esscene
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pieces = JSON.parse(readFileSync(path.join(ROOT, 'tools/pieces.json'), 'utf8'));

const mul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
/** The rotation that turns a thing facing -Z (a camera, a light) to face `d`. */
const aim = (d) => {
  const len = Math.hypot(d.x, d.y, d.z);
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(d.y / len);
  return mul({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) });
};
const tr = (position, rotation, scale) => ({ type: 'Transform', data: { position, ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) } });
const v3 = ([x, y, z]) => ({ x, y, z });

// The view of NVIDIA's reference picture of the exterior, solved from its landmarks (centimetres).
const EYE = [-2427, 580, -12];
const TARGET = [-760, 190, -30];

const entities = [];
const add = (name, components) => { entities.push({ id: entities.length, name, parent: null, children: [], visible: true, components }); };

add('Camera', [
  tr(v3(EYE), aim({ x: TARGET[0] - EYE[0], y: TARGET[1] - EYE[1], z: TARGET[2] - EYE[2] })),
  { type: 'Camera', data: { projectionType: 0, fov: 35.6, nearPlane: 10, farPlane: 40000, isActive: true, priority: 0 } },
  { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: [
    { type: 'ssao', enabled: true, uniforms: { u_radius: 70, u_intensity: 1, u_bias: 0.12, u_power: 1.5 } },
    { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.9, u_intensity: 0.5, u_radius: 1.2 } },
    { type: 'tonemap', enabled: true, uniforms: { u_exposure: 0 } },
    { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
  ] } },
]);

/** Further views of the same street: what each one looks along is where its camera is aimed. */
const VIEW_POST = cameraPost();
function cameraPost() { return JSON.parse(JSON.stringify(entities[0].components[2])); }
const view = (name, eye, target, fov) => add(name, [
  tr(v3(eye), aim({ x: target[0] - eye[0], y: target[1] - eye[1], z: target[2] - eye[2] })),
  { type: 'Camera', data: { projectionType: 0, fov, nearPlane: 10, farPlane: 40000, isActive: true, priority: 0 } },
]);
view('View · corner', [-1560, 580, 34], [-300, 150, 0], 35.6);
view('View · street', [-1100, 220, 700], [-400, 120, -100], 45);
view('View · overview', [-200, 2600, 3600], [-500, 0, -100], 50);
void VIEW_POST;
// The sun is the sky's own: it follows the direction the panorama's brightest disc is in.
add('Sun', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 6.74, enabled: true,
    followEnvironmentSun: true, environmentRotation: 180,
    meshShadows: true, shadowExtent: 4600, shadowStrength: 1, sourceAngle: 0.5 } },
]);
add('Sky', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Light', data: { type: 2, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 4, enabled: true,
    environment: 'assets/env/san_giuseppe_bridge_4k.esenv', environmentRotation: 180, drawEnvironment: true } },
]);
add('Baked Lighting', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'BakedLighting', data: { atlasSize: 4096, texelsPerUnit: 0.08, bounces: 2, samples: 32, probeSamples: 64 } },
]);
// One grid of probes over the street the camera looks along, for what moves through it.
add('Probes', [
  tr({ x: -600, y: 400, z: -200 }),
  { type: 'LightProbeVolume', data: { halfExtents: { x: 2400, y: 400, z: 1600 }, spacing: 400, enabled: true } },
]);
// What the glass and the wet stone show is the street, not the sky.
add('Reflection · street', [tr({ x: -1000, y: 300, z: -250 }), { type: 'ReflectionProbe', data: { halfExtents: { x: 1800, y: 600, z: 1400 } } }]);
add('Reflection · far', [tr({ x: 1800, y: 300, z: -250 }), { type: 'ReflectionProbe', data: { halfExtents: { x: 1800, y: 600, z: 1400 } } }]);

for (const piece of pieces) {
  entities.push({
    id: entities.length, name: piece.name, parent: null, children: [], visible: true,
    components: [
      tr(v3(piece.p), { w: piece.q[0], x: piece.q[1], y: piece.q[2], z: piece.q[3] }, { x: piece.s, y: piece.s, z: piece.s }),
      { type: 'MeshRenderer', data: piece.mr },
    ],
  });
}

writeFileSync(path.join(ROOT, 'assets/scenes/main.esscene'), JSON.stringify({ version: 4, name: 'Main', entities }, null, 2));
console.log(`wrote ${entities.length} entities`);
