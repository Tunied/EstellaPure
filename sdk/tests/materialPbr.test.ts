// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { compileMaterialGraph, type MaterialGraph } from '../src/render/materialGraph';

const pbrGraph = (extra: Record<string, string> = {}, outParams?: Record<string, unknown>): MaterialGraph => ({
  name: 'Metal',
  output: 'out',
  nodes: [
    { id: 'alb', type: 'textureSample', params: { name: 'u_albedo', default: 'white' } },
    { id: 'nrm', type: 'normalMap', params: { name: 'u_normal' } },
    { id: 'mr', type: 'textureSample', params: { name: 'u_mr', default: 'white', data: true } },
    { id: 'm', type: 'channel', params: { channel: 'b' }, inputs: { v: 'mr' } },
    { id: 'r', type: 'channel', params: { channel: 'g' }, inputs: { v: 'mr' } },
    { id: 'out', type: 'output', params: outParams, inputs: { color: 'alb', normal: 'nrm', metallic: 'm', roughness: 'r', ...extra } },
  ],
});

describe('standard-material surface', () => {
  const src = compileMaterialGraph(pbrGraph());

  it('compiles in the Lit domain and lights through applyLightingPBR in both languages', () => {
    expect(src).toContain('#pragma domain Lit');
    expect(src.match(/applyLightingPBR\(/g)).toHaveLength(2);
    expect(src).toContain('perturbNormal(sN, v_worldXYZ, v_texCoord,');
    expect(src).toContain('perturbNormal(sN, v.v_worldXYZ, v.v_texCoord,');
    expect(src).toContain('@builtin(front_facing) front : bool');
  });

  it('reads the normal map and the packed metal / rough map as data, not colour', () => {
    expect(src).toContain('#pragma param u_normal texture default(flatnormal) texel(data)');
    expect(src).toContain('#pragma param u_mr texture default(white) texel(data)');
    expect(src).toContain('#pragma param u_albedo texture default(white)\n');
    expect(src).toContain('sampleNormal(u_normal, v_texCoord)');
  });

  it('takes metal from B and roughness from G, and defaults the rest like the standard material', () => {
    expect(src).toMatch(/float n\d = n\d\.b;/);
    expect(src).toMatch(/float n\d = n\d\.g;/);
    expect(src).toContain(', 1.0, 1.0000);'); // specular 1, occlusion 1
    expect(src).toContain('vec3(0.0), 1.0000)'); // no emission, opaque
  });

  it('adds emission after the light and takes alpha from its port', () => {
    const g = pbrGraph({ emission: 'alb', alpha: 'm' });
    const out = compileMaterialGraph(g);
    expect(out).toMatch(/fragColor = vec4\(lit \+ n\d\.rgb, n\d\);/);
  });

  it('turns on from a literal alone, and leaves a graph with no PBR port exactly as it was', () => {
    const legacy: MaterialGraph = { name: 'L', output: 'out', nodes: [{ id: 'c', type: 'constColor', params: { name: 'u_c', value: [1, 0, 0, 1] } }, { id: 'out', type: 'output', inputs: { color: 'c' } }] };
    const plain = compileMaterialGraph(legacy);
    expect(plain).toContain('#pragma domain Unlit');
    expect(plain).not.toContain('applyLightingPBR');
    expect(plain).toContain('fragColor = u_c;');
    const lit = compileMaterialGraph({ ...legacy, nodes: legacy.nodes.map((n) => (n.id === 'out' ? { ...n, params: { lit_roughness: 0.3 } } : n)) });
    expect(lit).toContain('#pragma domain Lit');
    expect(lit).toContain('0.3000');
  });

  it('keeps an unlit graph\'s alpha port working without the lighting path', () => {
    const g: MaterialGraph = { name: 'A', output: 'out', nodes: [
      { id: 'c', type: 'constColor', params: { name: 'u_c', value: [1, 1, 1, 1] } },
      { id: 'a', type: 'constFloat', params: { name: 'u_a', value: 0.5 } },
      { id: 'out', type: 'output', inputs: { color: 'c', alpha: 'a' } },
    ] };
    const out = compileMaterialGraph(g);
    expect(out).toContain('#pragma domain Unlit');
    expect(out).toContain('fragColor = vec4((u_c).rgb, u_a);');
  });

  it('refuses a channel the value does not have', () => {
    const g = pbrGraph();
    g.nodes.push({ id: 'uv', type: 'uv' }, { id: 'bad', type: 'channel', params: { channel: 'b' }, inputs: { v: 'uv' } });
    g.nodes.find((n) => n.id === 'out')!.inputs!.occlusion = 'bad';
    expect(() => compileMaterialGraph(g)).toThrow(/takes \.b of a vec2/);
  });
});

describe('vertex offset', () => {
  const wind = (extra: Partial<MaterialGraph['nodes'][number]> = {}): MaterialGraph => ({
    name: 'Wind', output: 'out',
    nodes: [
      { id: 'c', type: 'constColor', params: { name: 'u_c', value: [1, 1, 1, 1] } },
      { id: 'time', type: 'time' },
      { id: 'amt', type: 'constFloat', params: { name: 'u_bend', value: 0.5 } },
      { id: 's', type: 'sin', inputs: { x: 'time' } },
      { id: 'm', type: 'multiply', inputs: { a: 's', b: 'amt' } },
      { id: 'out', type: 'output', inputs: { color: 'c', vertexOffset: 'm' }, ...extra },
    ],
  });

  it('compiles the offset into a hook in both languages, ahead of the fragment', () => {
    const src = compileMaterialGraph(wind());
    expect(src).toContain('#pragma vertexoffset\n');
    expect(src).toContain('#pragma vertexoffset wgsl\n');
    expect(src).toContain('void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {');
    expect(src).toContain('fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {');
    expect(src.indexOf('#pragma vertexoffset')).toBeLessThan(src.indexOf('#pragma fragment'));
  });

  it('moves a scalar along the normal, and a vec2 / vec3 as a displacement', () => {
    const along = compileMaterialGraph(wind());
    expect(along).toContain('local += localNormal * n');
    expect(along).toContain('*local = *local + (*localNormal) * n');
    const g = wind();
    g.nodes.push({ id: 'uv', type: 'uv' });
    g.nodes.find((n) => n.id === 'out')!.inputs!.vertexOffset = 'uv';
    expect(compileMaterialGraph(g)).toContain('local += vec3(uv, 0.0);');
  });

  it('shares the material\'s params with the fragment, declaring each once', () => {
    const src = compileMaterialGraph(wind());
    expect(src.match(/#pragma param u_bend/g)).toHaveLength(1);
    expect(src).toContain('u_bend');
    expect(src).toContain('mc.u_bend');
    expect(src).toContain('u_time.x');
  });

  it('writes the bounds expansion only when one is typed', () => {
    expect(compileMaterialGraph(wind())).not.toContain('#pragma vertexbounds');
    expect(compileMaterialGraph(wind({ params: { lit_vertexBounds: 12.5 } }))).toContain('#pragma vertexbounds 12.5\n');
  });

  it('leaves a graph with no offset exactly as before', () => {
    const g = wind();
    delete g.nodes.find((n) => n.id === 'out')!.inputs!.vertexOffset;
    const src = compileMaterialGraph(g);
    expect(src).not.toContain('vertexoffset');
    expect(src).not.toContain('esMaterialVertex');
  });

  it('refuses what only a fragment has: a texture, the screen, the vertex colour', () => {
    for (const bad of [
      { id: 'x', type: 'textureSample' as const, params: { name: 'u_t', default: 'white' } },
      { id: 'x', type: 'screenUV' as const },
      { id: 'x', type: 'vertexColor' as const },
    ]) {
      const g = wind();
      g.nodes.push(bad);
      g.nodes.find((n) => n.id === 'out')!.inputs!.vertexOffset = 'x';
      expect(() => compileMaterialGraph(g)).toThrow(/vertex offset cannot/);
    }
  });

  it('lets the fragment keep sampling textures while the vertex pass runs', () => {
    const g = wind();
    g.nodes.push({ id: 'tex', type: 'textureSample', params: { name: 'u_albedo', default: 'white' } });
    g.nodes.find((n) => n.id === 'out')!.inputs!.color = 'tex';
    expect(compileMaterialGraph(g)).toContain('texture(u_albedo, v_texCoord)');
  });
});

describe('static switch', () => {
  const g = (feature = 'ES_FANCY', extra: Record<string, unknown> = {}): MaterialGraph => ({
    name: 'Var', output: 'out',
    nodes: [
      { id: 'a', type: 'constColor', params: { name: 'u_a', value: [1, 0, 0, 1] } },
      { id: 'b', type: 'constColor', params: { name: 'u_b', value: [0, 0, 1, 1] } },
      { id: 'sw', type: 'switch', params: { feature, ...extra }, inputs: { on: 'a', off: 'b' } },
      { id: 'out', type: 'output', inputs: { color: 'sw' } },
    ],
  });

  it('declares the switch and picks a side with #ifdef in both languages', () => {
    const src = compileMaterialGraph(g());
    expect(src).toContain('#pragma switch ES_FANCY\n');
    expect(src.match(/#ifdef ES_FANCY/g)).toHaveLength(2);
    expect(src).toMatch(/n\d = u_a;/);
    expect(src).toMatch(/n\d = mc\.u_b;/);
  });

  it('can start on, and declares a shared switch once', () => {
    expect(compileMaterialGraph(g('ES_FANCY', { default: true }))).toContain('#pragma switch ES_FANCY default(on)');
    const twin = g();
    twin.nodes.push({ id: 'sw2', type: 'switch', params: { feature: 'ES_FANCY' }, inputs: { on: 'a', off: 'b' } });
    expect(compileMaterialGraph(twin).match(/#pragma switch ES_FANCY/g)).toHaveLength(1);
  });

  it('refuses a name a #define cannot be', () => {
    expect(() => compileMaterialGraph(g('fancy'))).toThrow(/needs a name in capitals/);
  });
});

describe('tiling and offset', () => {
  it('scales then shifts the UV', () => {
    const g: MaterialGraph = { name: 'T', output: 'out', nodes: [
      { id: 't', type: 'uvTransform', params: { tileX: 4, tileY: 2, offsetX: 0.5 } },
      { id: 'tex', type: 'textureSample', params: { name: 'u_a', default: 'white' }, inputs: { uv: 't' } },
      { id: 'out', type: 'output', inputs: { color: 'tex' } },
    ] };
    const src = compileMaterialGraph(g);
    expect(src).toContain('v_texCoord * vec2(4.0000, 2.0000) + vec2(0.5000, 0.0000)');
    expect(src).toContain('v.v_texCoord * vec2f(4.0000, 2.0000) + vec2f(0.5000, 0.0000)');
  });
});
