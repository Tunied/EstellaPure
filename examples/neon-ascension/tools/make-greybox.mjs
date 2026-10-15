// Grey-box of the "Neon Ascension" concept target: boxes only, no authored models.
// It exists to answer one question before any art is made — do wet reflections,
// warm/cold light contrast and emissive bloom read the way the concept does?
// Everything is derived from the numbers below; an art note is an edit and a rerun.
//
//   node tools/make-greybox.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = path.join(ROOT, 'assets', 'scenes');
const MATS = path.join(ROOT, 'assets', 'materials');
mkdirSync(SCENES, { recursive: true });
mkdirSync(MATS, { recursive: true });

// A cube is 100 units a side, so scale s covers s*100 units.
const U = 100;

const rgba = (r, g, b, a = 1) => ({ r, g, b, a });

// Deterministic so the skyline is the same every run.
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const materials = {
  wetConcrete: { metallic: 0.5, roughness: 0.06 },
  wetMetal: { metallic: 0.85, roughness: 0.18 },
  darkStone: { metallic: 0.0, roughness: 0.75 },
  water: { metallic: 0.9, roughness: 0.05 },
  warmWindow: { metallic: 0, roughness: 0.5, emissive: rgba(2.2, 1.35, 0.55) },
  coolWindow: { metallic: 0, roughness: 0.5, emissive: rgba(0.9, 1.4, 2.0) },
  cyanStrip: { metallic: 0, roughness: 0.3, emissive: rgba(0.2, 3.2, 4.0) },
  magentaSign: { metallic: 0, roughness: 0.4, emissive: rgba(4.0, 0.25, 2.4) },
  train: { metallic: 0.4, roughness: 0.3, emissive: rgba(1.2, 1.4, 1.6) },
};
for (const [name, m] of Object.entries(materials)) {
  const properties = { u_metallic: m.metallic, u_roughness: m.roughness };
  if (m.emissive) properties.u_emissive = m.emissive;
  writeFileSync(path.join(MATS, `${name}.esmaterial`), JSON.stringify({
    version: '1.0', type: 'material', shader: 'builtin:model',
    blendMode: 0, depthTest: true, depthWrite: true, cull: 1, properties,
  }, null, 2));
}

const entities = [];
let nextId = 0;
const add = (name, components) => {
  const id = nextId++;
  entities.push({ id, name, parent: null, children: [], visible: true, components });
  return id;
};

const transform = (p, s, q) => ({
  type: 'Transform',
  data: {
    position: { x: p[0], y: p[1], z: p[2] },
    ...(s ? { scale: { x: s[0], y: s[1], z: s[2] } } : {}),
    ...(q ? { rotation: q } : {}),
  },
});

// Camera looks along -z by default; yaw/pitch compose into the quaternion.
function lookQuat(yawDeg, pitchDeg) {
  const y = (yawDeg * Math.PI) / 360, p = (pitchDeg * Math.PI) / 360;
  const qy = { x: 0, y: Math.sin(y), z: 0, w: Math.cos(y) };
  const qx = { x: Math.sin(p), y: 0, z: 0, w: Math.cos(p) };
  return {
    x: qy.w * qx.x + qy.x * qx.w,
    y: qy.y * qx.w + qy.w * qx.y,
    z: qy.x * qx.y - qy.y * qx.x + qy.z * qx.w + qy.w * qx.z,
    w: qy.w * qx.w - qy.x * qx.x - qy.y * qx.y - qy.z * qx.z,
  };
}

const box = (name, mat, p, size, color = rgba(1, 1, 1), mesh = 'builtin:cube') => add(name, [
  transform(p, size.map((v) => v / U)),
  { type: 'MeshRenderer', data: {
    mesh, color, lit: true, opaque: true, cullBackfaces: true, enabled: true,
    material: `assets/materials/${mat}.esmaterial`,
  } },
]);

const pointLight = (name, p, color, intensity, radius) => add(name, [
  transform(p),
  { type: 'Light', data: { type: 0, color, intensity, radius, enabled: true } },
]);

// ---- camera: a balcony on the left, looking across the river at the towers ----
add('Camera', [
  transform([-150, 520, 900], null, lookQuat(-10, 0)),
  { type: 'Camera', data: {
    projectionType: 0, fov: 52, nearPlane: 5, farPlane: 40000, isActive: true, priority: 0,
    clearFlags: 1, backgroundColor: rgba(0.02, 0.03, 0.05),
  } },
  { type: 'PostProcessVolume', data: {
    isGlobal: true, priority: 0, weight: 1,
    effects: [
      { type: 'distanceFog', enabled: true,
        uniforms: { u_fogNear: 900, u_fogFar: 16000, u_intensity: 0.55 },
        colors: { u_fogColor: rgba(0.035, 0.05, 0.085) } },
      { type: 'ssao', enabled: true, uniforms: {} },
      { type: 'bloom', enabled: true, uniforms: { u_threshold: 0.8, u_intensity: 1.6, u_radius: 1.4 } },
      { type: 'colorGrade', enabled: true, uniforms: { u_contrast: 1.12, u_saturation: 1.05, u_temperature: -0.08 } },
      { type: 'tonemap', enabled: true, uniforms: {} },
      { type: 'vignette', enabled: true, uniforms: { u_intensity: 0.45, u_softness: 0.6 } },
      { type: 'fxaa', enabled: true, uniforms: {} },
    ],
  } },
]);

// ---- global light: cold moon + dark blue ambient ----
add('Moon', [transform([0, 0, 0]), { type: 'Light', data: {
  type: 1, color: rgba(0.45, 0.55, 0.85), intensity: 0.25,
  direction: { x: -0.4, y: -0.8 }, directionZ: -0.5, meshShadows: true, enabled: true,
} }]);
add('Ambient', [transform([0, 0, 0]), { type: 'Light', data: {
  type: 2, color: rgba(1, 1, 1), intensity: 1.0, enabled: true,
  environment: 'assets/env/night.esenv', drawEnvironment: true,
} }]);

// ---- foreground deck (left): wet floor, parapet, pipes ----
box('Deck', 'wetConcrete', [-300, 190, 300], [1600, 20, 2200]);
for (let i = 0; i < 9; i++) {
  box(`Parapet${i}`, 'darkStone', [-80 + i * 55, 250, 650 - i * 260], [90, 120, 220]);
}
box('PipeLow', 'wetMetal', [-1000, 330, 300], [90, 90, 2000], rgba(0.6, 0.55, 0.45), 'builtin:cylinder');
box('PipeHigh', 'wetMetal', [-900, 560, 0], [60, 60, 1800], rgba(0.5, 0.5, 0.5), 'builtin:cylinder');
box('MachineBlock', 'darkStone', [-950, 400, -250], [500, 450, 600]);
box('MachineWindow', 'warmWindow', [-700, 430, -250], [10, 160, 260]);

// ---- middle ground: street, river, bridge, elevated rail + train ----
box('Street', 'wetConcrete', [1100, -250, -1300], [1200, 20, 3600]);
box('River', 'water', [200, -330, -3000], [9000, 10, 4200], rgba(0.05, 0.08, 0.14));
box('BridgeDeck', 'darkStone', [200, -120, -2500], [4200, 60, 260]);
for (let i = 0; i < 9; i++) box(`BridgePier${i}`, 'darkStone', [-1700 + i * 450, -230, -2500], [60, 230, 120]);
box('RailViaduct', 'darkStone', [350, 70, -1500], [3200, 70, 200]);
for (let i = 0; i < 8; i++) box(`ViaductPier${i}`, 'darkStone', [-1000 + i * 420, -90, -1500], [70, 340, 90]);
box('Train', 'train', [500, 150, -1500], [900, 80, 90]);
box('TrainWindows', 'coolWindow', [500, 160, -1448], [880, 24, 6]);

// ---- right-hand terraced buildings with warm windows ----
for (let i = 0; i < 6; i++) {
  const w = 560 - i * 40, h = 700 + (i % 3) * 260;
  box(`RightBlock${i}`, 'darkStone', [2100 + i * 60, -240 + h / 2, -400 - i * 520], [w, h, 460]);
  box(`RightWindows${i}`, 'warmWindow', [2100 + i * 60 - w / 2 + 6, -240 + h / 2 - 60, -400 - i * 520 + 50],
    [8, h * 0.55, 340]);
}
box('MagentaBannerR', 'magentaSign', [1700, 350, -900], [14, 380, 120]);

// ---- main tower: two tapered shafts, cyan strips, ring ----
const TX = 800, TZ = -5200;
box('TowerL', 'darkStone', [TX - 380, 1500, TZ], [520, 3600, 520], rgba(0.8, 0.8, 0.85));
box('TowerR', 'darkStone', [TX + 380, 1500, TZ], [520, 3600, 520], rgba(0.8, 0.8, 0.85));
box('TowerBaseL', 'darkStone', [TX - 380, 100, TZ], [820, 700, 820]);
box('TowerBaseR', 'darkStone', [TX + 380, 100, TZ], [820, 700, 820]);
box('CyanStripL', 'cyanStrip', [TX - 120, 1500, TZ + 270], [24, 3400, 14]);
box('CyanStripR', 'cyanStrip', [TX + 120, 1500, TZ + 270], [24, 3400, 14]);
box('RingBridge', 'wetMetal', [TX, 3350, TZ], [1500, 70, 140], rgba(0.7, 0.75, 0.8));
box('Pod', 'coolWindow', [TX, 2100, TZ + 100], [440, 90, 300]);

// ---- skyline: the environment panorama is the skyline; no boxes here ----

// ---- lights: 16 is the engine's per-frame cap, so every one earns its slot ----
const sodium = rgba(1.0, 0.62, 0.25);
pointLight('DeckLamp', [-760, 400, -200], sodium, 0.65, 900);
pointLight('DeckLamp2', [-250, 330, 420], sodium, 0.45, 700);
pointLight('StreetLamp1', [1150, -80, -700], sodium, 0.55, 900);
pointLight('StreetLamp2', [1150, -80, -1500], sodium, 0.55, 900);
pointLight('StreetLamp3', [1150, -80, -2300], sodium, 0.55, 900);
pointLight('BalconyGlowR', [1900, 200, -300], sodium, 0.6, 1200);
pointLight('BalconyGlowR2', [2300, 400, -1300], sodium, 0.6, 1200);
pointLight('MagentaFill', [1550, 360, -800], rgba(1.0, 0.1, 0.65), 0.7, 1100);
pointLight('TrainGlow', [500, 200, -1500], rgba(0.55, 0.8, 1.0), 0.45, 900);
pointLight('TowerCyan', [TX, 1200, TZ + 600], rgba(0.1, 0.8, 1.0), 1.0, 2600);
pointLight('TowerBase', [TX, 100, TZ + 900], sodium, 0.6, 1800);
pointLight('BridgeGlow', [200, 0, -2300], sodium, 0.4, 1400);

// ---- weather: rain streaks and vent steam, all particles on the one soft sprite ----
const SOFT = '@uuid:6d3f8a52-1b7e-4c0a-9e41-5a2c7b90d4e1';
const emitter = (name, p, data) => add(name, [
  transform(p),
  { type: 'ParticleEmitter', data: {
    looping: true, playOnStart: true, enabled: true, simulationSpace: 0,
    texture: SOFT, ...data,
  } },
]);
const rain = (name, p, extent, o) => emitter(name, p, {
  shape: 2, shapeSize: { x: extent[0], y: 1, z: extent[1] },
  speedMin: 0, speedMax: 0, gravity: { x: 120, y: -2600, z: 0 },
  startColor: rgba(0.72, 0.84, 1, o.alpha), endColor: rgba(0.72, 0.84, 1, o.alpha * 0.3),
  startSizeMin: o.size, startSizeMax: o.size, endSizeMin: o.size, endSizeMax: o.size,
  trailEnabled: true, trailWidth: o.size * 0.8, trailPoints: 6, trailMinDistance: 14,
  blendMode: 1, rate: o.rate, maxParticles: o.max, lifetimeMin: o.life, lifetimeMax: o.life,
});
// Kept clear of the camera (z 900): a drop that passes close is a bar across the frame.
rain('RainNear', [150, 1500, -650], [2600, 1000], { alpha: 0.38, size: 3, rate: 1500, max: 2000, life: 1.15 });
rain('RainFar', [700, 2600, -3200], [7000, 5200], { alpha: 0.2, size: 6, rate: 1500, max: 2800, life: 1.7 });

const vent = (name, p) => emitter(name, p, {
  shape: 3, shapeRadius: 22, shapeAngle: 16,
  speedMin: 70, speedMax: 150, gravity: { x: 25, y: 35, z: 0 }, damping: 0.4,
  noiseStrength: 70, noiseFrequency: 0.0025, noiseScrollSpeed: 0.2, noiseOctaves: 2,
  startColor: rgba(0.78, 0.82, 0.92, 0.13), endColor: rgba(0.55, 0.62, 0.8, 0),
  startSizeMin: 90, startSizeMax: 130, endSizeMin: 320, endSizeMax: 460,
  blendMode: 0, rate: 45, maxParticles: 320, lifetimeMin: 3.5, lifetimeMax: 5,
});
vent('SteamDeck', [-560, 215, 150]);
vent('SteamStreet', [1450, -235, -700]);
vent('SteamRight', [1950, -225, -1000]);

const scene = { version: 4, name: 'Main', entities };
writeFileSync(path.join(SCENES, 'main.esscene'), JSON.stringify(scene, null, 2));
writeFileSync(path.join(ROOT, 'project.esproject'), JSON.stringify({
  formatVersion: '1',
  name: 'Neon Ascension',
  description: 'A rain-soaked night city grey-box: reflections, warm/cold light contrast and emissive bloom.',
  tag: '3D',
  version: '0.1.0',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 1920, height: 1080 },
  spineVersion: 'none',
}, null, 2));
console.log(`wrote ${entities.length} entities, ${Object.keys(materials).length} materials`);
