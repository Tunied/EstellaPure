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
const SCENE = path.join(ROOT, 'assets/scenes/main.esscene');


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

// How bright the sky is; the sun is the sky's own, so it is scaled back up to keep its strength.
const SKY = Number(process.env.SKY ?? 1.6);
// The cafe corner and the scooter from across the street, at the height of a first-floor window (centimetres).
const EYE = [-300, 570, 1460];
const TARGET = [-250, 175, -40];

const entities = [];
const add = (name, components) => { entities.push({ id: entities.length, name, parent: null, children: [], visible: true, components }); };

add('Camera', [
  tr(v3(EYE), aim({ x: TARGET[0] - EYE[0], y: TARGET[1] - EYE[1], z: TARGET[2] - EYE[2] })),
  { type: 'Camera', data: { projectionType: 0, fov: 33, nearPlane: 10, farPlane: 40000, isActive: true, priority: 0 } },
  { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects: [
    { type: 'skyAtmosphere', enabled: true, uniforms: { u_intensity: 1.1, u_sunBrightness: 40 } },
    { type: 'taa', enabled: true, uniforms: { u_blend: 0.1 } },
    { type: 'ssao', enabled: true, uniforms: { u_radius: 70, u_intensity: 1, u_bias: 0.12, u_power: 1.5 } },
    { type: 'contactShadows', enabled: true, uniforms: { u_intensity: 0.55, u_length: 28, u_thickness: 10 } },
    { type: 'ssgi', enabled: true, uniforms: { u_intensity: 0.9, u_radius: 240, u_thickness: 40, u_maxBounce: 2.5 } },
    { type: 'ssr', enabled: true, uniforms: { u_intensity: 0.6, u_maxDistance: 500, u_thickness: 14, u_floorBias: 1 } },
    { type: 'heightFog', enabled: true, colors: { u_fogColor: { r: 0.72, g: 0.78, b: 0.86, a: 1 }, u_sunColor: { r: 1, g: 0.9, b: 0.7, a: 1 } }, uniforms: { u_density: 4e-05, u_heightFalloff: 0.0008, u_baseHeight: 0, u_inscatter: 0.5, u_sunAzimuth: 40, u_sunElevation: 35, u_skyFog: 0.6, u_volumetric: 0.5, u_volumeRange: 6000 } },
    { type: 'autoExposure', enabled: true, uniforms: { u_bias: 0.15, u_minEV: -2, u_maxEV: 2 } },
    { type: 'colorGrade', enabled: true, uniforms: { u_exposure: 0, u_contrast: 1.08, u_saturation: 1.1, u_temperature: 0, u_tint: 0 } },
    { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.9, u_intensity: 0.5, u_radius: 1.2 } },
    { type: 'fxaa', enabled: true, uniforms: { u_intensity: 1 } },
  ] } },
]);

// The sun is the sky's own: it follows the direction the panorama's brightest disc is in.
add('Sun', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Light', data: { type: 1, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 4 / SKY, enabled: true,
    followEnvironmentSun: true, environmentRotation: 180,
    meshShadows: true, shadowExtent: 4600, shadowStrength: 1, sourceAngle: 0.5 } },
]);
add('Sky', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Light', data: { type: 2, color: { r: 1, g: 1, b: 1, a: 1 }, intensity: SKY, enabled: true,
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

// The weather the street lives under: clear, then mist, rain and clear again, a turn taking ten seconds and each holding eight.
add('Weather', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'Weather', data: { preset: 0, target: -1, progress: 0, duration: 10, sequence: 'clear,mist,rain,clear', hold: 8, drive: 127, soundSource: 0 } },
]);

// The hour the street is shot at, and how the sun walks: Paris in early autumn, the world turned so that noon is behind the camera.
add('Time of Day', [
  tr({ x: 0, y: 0, z: 0 }),
  { type: 'TimeOfDay', data: { hour: 12, daySeconds: 0, latitude: 48.8, declination: 12, north: 180, drive: 31 } },
]);

writeFileSync(SCENE, JSON.stringify({ version: 4, name: 'Main', entities }, null, 2));
console.log(`wrote ${entities.length} entities`);
