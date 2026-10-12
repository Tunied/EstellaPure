// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import{Draw,initDrawAPI,shutdownDrawAPI}from'../src/render/draw';
import{Material,initMaterialAPI,shutdownMaterialAPI}from'../src/render/material';
import{BlendMode}from'../src/render/blend';
import type{ESEngineModule}from'../src/wasm';
describe('legacy Draw with real material instances',()=>{
  let core:ReturnType<typeof makeCore>;
  function makeCore(){let address=128;return{HEAPF32:new Float32Array(4096),_malloc:(bytes:number)=>{const p=address;address+=bytes;return p;},_free:vi.fn(),
    material_define:vi.fn(),material_setUniform:vi.fn(),material_setTexture:vi.fn(),material_undefine:vi.fn(),material_compileEsshader:()=>1,
    draw_meshWithMaterial:vi.fn(()=>false),draw_mesh:vi.fn(),draw_meshWithUniforms:vi.fn(),draw_setBlendMode:vi.fn(),draw_setDepthTest:vi.fn()};}
  beforeEach(()=>{core=makeCore();initMaterialAPI(core as never);initDrawAPI(core as unknown as ESEngineModule);});
  afterEach(()=>{shutdownDrawAPI();shutdownMaterialAPI();});
  const stream=()=>{const call=core.draw_meshWithUniforms.mock.calls.at(-1)!;return Array.from(core.HEAPF32.subarray(call[3]/4,call[3]/4+call[4]));};
  it('inherits parent uniforms and state without writing local overrides',()=>{
    const parent=Material.create({shader:7,blendMode:BlendMode.Additive,depthTest:true,uniforms:{u_color:{x:1,y:0,z:0,w:1}}});
    const child=Material.createInstance(parent);Draw.drawMeshWithMaterial(1,child);
    expect(core.draw_meshWithUniforms).toHaveBeenCalled();
    expect(stream()).toEqual([4,1,1,0,0,1]);
    expect(core.draw_setBlendMode).toHaveBeenCalledWith(BlendMode.Additive);
    expect(core.draw_setDepthTest).toHaveBeenCalledWith(true);
    expect(Material.get(child)!.uniforms.size).toBe(0);
  });
  it('updates cached inheritance after parent edits and resets, preserving child overrides',()=>{
    const parent=Material.create({shader:7,uniforms:{u_color:{x:1,y:0,z:0,w:1}}}),child=Material.createInstance(parent);
    Draw.drawMeshWithMaterial(1,child);Material.setUniform(parent,'u_color',{x:0,y:1,z:0,w:1});
    Draw.drawMeshWithMaterial(1,child);expect(stream()).toEqual([4,1,0,1,0,1]);
    Material.setUniform(child,'u_color',{x:0,y:0,z:1,w:1});Draw.drawMeshWithMaterial(1,child);
    expect(stream()).toEqual([4,1,0,0,1,1]);Material.applyState(child,{});Draw.drawMeshWithMaterial(1,child);
    expect(stream()).toEqual([4,1,0,1,0,1]);
  });
  it('inherits texture refs and reuses the encoded stream on warm draws',()=>{
    const parent=Material.create({shader:7,uniforms:{u_texture0:Material.tex(42,2)}}),child=Material.createInstance(parent);
    const read=vi.spyOn(Material,'getUniforms');Draw.drawMeshWithMaterial(1,child);
    expect(stream()).toEqual([10,14,2,42]);const cached=Material.get(child)!.cachedBuffer_;
    Draw.drawMeshWithMaterial(1,child);expect(Material.get(child)!.cachedBuffer_).toBe(cached);expect(read).toHaveBeenCalledTimes(1);read.mockRestore();
  });
});
