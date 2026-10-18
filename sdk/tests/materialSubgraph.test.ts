// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
  compileMaterialGraph, flattenSubgraphs, subgraphInputs, subgraphRefs, validateSubgraph, newMaterialSubgraph, connect,
  type MaterialGraph, type SubgraphResolver,
} from '../src/render/materialGraph';

// wind(time, strength) = sin(time) * strength
const wind: MaterialGraph = {
  kind: 'subgraph', name: 'Wind', output: 'out',
  nodes: [
    { id: 'time', type: 'subInput', params: { name: 'time', type: 'float', default: 0 } },
    { id: 'strength', type: 'subInput', params: { name: 'strength', type: 'float', default: 0.5 } },
    { id: 'sin', type: 'sin', inputs: { x: 'time' } },
    { id: 'mul', type: 'multiply', inputs: { a: 'sin', b: 'strength' } },
    { id: 'out', type: 'subOutput', inputs: { value: 'mul' } },
  ],
};
const libs: Record<string, MaterialGraph> = { 'wind.esmatsub': wind };
const resolve: SubgraphResolver = (ref) => libs[ref] ?? null;

const user = (over: Partial<MaterialGraph['nodes'][number]> = {}): MaterialGraph => ({
  name: 'Leaf', output: 'out',
  nodes: [
    { id: 't', type: 'time' },
    { id: 'w', type: 'subgraph', params: { ref: 'wind.esmatsub' }, inputs: { time: 't' }, ...over },
    { id: 'out', type: 'output', inputs: { color: 'w' } },
  ],
});

describe('subgraphs', () => {
  it('lists a subgraph\'s inputs with their defaults', () => {
    expect(subgraphInputs(wind)).toEqual([
      { name: 'time', type: 'float', default: 0 }, { name: 'strength', type: 'float', default: 0.5 },
    ]);
  });

  it('inlines the subgraph: a connected input is the wire, an unconnected one its default', () => {
    const src = compileMaterialGraph(user(), resolve);
    expect(src).toContain('sin(u_time.x)');
    expect(src).toContain('0.5000');
  });

  it('lets the using node override an unconnected input', () => {
    const src = compileMaterialGraph(user({ params: { ref: 'wind.esmatsub', in_strength: 0.9 } }), resolve);
    expect(src).toContain('0.9000');
    expect(src).not.toContain('0.5000');
  });

  it('makes independent copies when used twice — their param names do not collide', () => {
    const tex: MaterialGraph = { kind: 'subgraph', output: 'out', nodes: [
      { id: 'c', type: 'constFloat', params: { name: 'u_amount', value: 1 } },
      { id: 'out', type: 'subOutput', inputs: { value: 'c' } },
    ] };
    const g: MaterialGraph = { output: 'out', nodes: [
      { id: 'a', type: 'subgraph', params: { ref: 'amount.esmatsub' } },
      { id: 'b', type: 'subgraph', params: { ref: 'amount.esmatsub' } },
      { id: 'm', type: 'multiply', inputs: { a: 'a', b: 'b' } },
      { id: 'out', type: 'output', inputs: { color: 'm' } },
    ] };
    const src = compileMaterialGraph(g, (r) => (r === 'amount.esmatsub' ? tex : null));
    expect(src).toContain('#pragma param a_u_amount float');
    expect(src).toContain('#pragma param b_u_amount float');
  });

  it('flattens nested subgraphs', () => {
    const outer: MaterialGraph = { kind: 'subgraph', output: 'out', nodes: [
      { id: 'in', type: 'subInput', params: { name: 'time', type: 'float', default: 0 } },
      { id: 'inner', type: 'subgraph', params: { ref: 'wind.esmatsub' }, inputs: { time: 'in' } },
      { id: 'out', type: 'subOutput', inputs: { value: 'inner' } },
    ] };
    const g: MaterialGraph = { output: 'out', nodes: [
      { id: 't', type: 'time' },
      { id: 'o', type: 'subgraph', params: { ref: 'outer.esmatsub' }, inputs: { time: 't' } },
      { id: 'out', type: 'output', inputs: { color: 'o' } },
    ] };
    const flat = flattenSubgraphs(g, (r) => (r === 'outer.esmatsub' ? outer : libs[r] ?? null));
    expect(flat.nodes.some((n) => n.type === 'subgraph')).toBe(false);
    expect(compileMaterialGraph(g, (r) => (r === 'outer.esmatsub' ? outer : libs[r] ?? null))).toContain('sin(u_time.x)');
  });

  it('refuses a subgraph that contains itself, a missing one, and a graph compiled without a resolver', () => {
    const self: MaterialGraph = { kind: 'subgraph', output: 'out', nodes: [
      { id: 's', type: 'subgraph', params: { ref: 'self.esmatsub' } }, { id: 'out', type: 'subOutput', inputs: { value: 's' } },
    ] };
    const g: MaterialGraph = { output: 'out', nodes: [{ id: 's', type: 'subgraph', params: { ref: 'self.esmatsub' } }, { id: 'out', type: 'output', inputs: { color: 's' } }] };
    expect(() => compileMaterialGraph(g, (r) => (r === 'self.esmatsub' ? self : null))).toThrow(/contains itself/);
    expect(() => compileMaterialGraph(user(), () => null)).toThrow(/not found/);
    expect(() => compileMaterialGraph(user())).toThrow(/needs a resolver/);
  });

  it('validates a subgraph on its own, and rejects one with no value on its output', () => {
    expect(() => validateSubgraph(wind, resolve)).not.toThrow();
    expect(() => validateSubgraph(newMaterialSubgraph(), resolve)).not.toThrow();
    const broken: MaterialGraph = { ...wind, nodes: wind.nodes.map((n) => (n.id === 'out' ? { ...n, inputs: {} } : n)) };
    expect(() => validateSubgraph(broken, resolve)).toThrow();
  });

  it('lists the refs a graph names and connects into a subgraph node by any slot', () => {
    expect(subgraphRefs(user())).toEqual(['wind.esmatsub']);
    const g = connect(user(), 't', 'w', 'strength');
    expect(g.nodes.find((n) => n.id === 'w')!.inputs).toEqual({ time: 't', strength: 't' });
  });
});
