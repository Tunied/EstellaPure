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
