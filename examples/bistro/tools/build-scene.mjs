// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The example's scene: the Bistro prefab, a sun, a sky and a camera.
 *
 * The prefab is Amazon Lumberyard's Bistro exterior, imported with the engine's own FBX import and
 * then cut to what the camera sees (everything within 25 m of the point it looks at) and its images
 * shrunk to 1024 so the project fits in a repository. The cut is described in README.md.
 *
 *   node examples/bistro/tools/build-scene.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const tr = (position, rotation) => ({ type: 'Transform', data: { position, ...(rotation ? { rotation } : {}) } });

const entities = [
  { id: 0, name: 'Camera', parent: null, children: [], visible: true, components: [
    // The view Bistro's authors framed: the corner of the bistro, down the street.
    tr({ x: 913, y: 268, z: -2613 }, { w: -0.161483506, x: 0.00561383802, y: -0.986263651, z: -0.0342866248 }),
    { type: 'Camera', data: { projectionType: 0, fov: 50, nearPlane: 10, farPlane: 30000, isActive: true, priority: 0 } },
    { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: [
      { type: 'ssao', enabled: true, uniforms: { u_radius: 80, u_intensity: 1, u_bias: 0.12, u_power: 1.5 } },
      { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.9, u_intensity: 0.8, u_radius: 1.3 } },
      { type: 'colorGrade', enabled: true, uniforms: { u_exposure: 0, u_contrast: 1.06, u_saturation: 1.08, u_temperature: 0.06, u_tint: 0 } },
      { type: 'tonemap', enabled: true, uniforms: { u_exposure: 0.1 } },
      { type: 'vignette', enabled: true, uniforms: { u_intensity: 0.35, u_softness: 0.6 } },
      { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
    ] } },
  ] },
  { id: 1, name: 'Sun', parent: null, children: [], visible: true, components: [
    tr({ x: 0, y: 0, z: 0 }, aim({ x: -0.4, y: -0.28, z: 0.87 })),
    { type: 'Light', data: { type: 1, color: { r: 1, g: 0.72, b: 0.46, a: 1 }, intensity: 1.9, enabled: true,
      meshShadows: true, shadowExtent: 2600, shadowStrength: 0.85, shadowSoftness: 0.3 } },
  ] },
  { id: 2, name: 'Sky', parent: null, children: [], visible: true, components: [
    tr({ x: 0, y: 0, z: 0 }),
    { type: 'Light', data: { type: 2, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 0.8, enabled: true,
      environment: 'assets/env/the_sky_is_on_fire_2k.esenv', drawEnvironment: true } },
  ] },
  // One centimetre of the source is one engine unit, which the import's own 0.016 turns back into 1/62.5.
  { id: 3, parent: null, prefab: 'assets/models/BistroExterior.esprefab', overrides: [
    { prefabEntityId: 'n1', type: 'property', componentType: 'Transform', propertyName: 'scale', value: { x: 62.5, y: 62.5, z: 62.5 } },
  ], added: [], removed: [] },
];
writeFileSync(path.join(ROOT, 'assets/scenes/main.esscene'), JSON.stringify({ version: 4, name: 'Main', entities }, null, 2));
console.log('wrote scene');
