// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { ParticleAPI } from '../src/particle/ParticleAPI';
import { particleQueryResolver } from '../src/particle/ParticleCollisionBridge';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import type { CppRegistry } from '../src/wasm';
import type { App } from '../src/app/app';
import type { Entity } from '../src/types';
function engineFixture() {
  const memory=new WebAssembly.Memory({initial:1,maximum:4});let count=1,eventCount=0;
  const engine={get HEAPU8(){return new Uint8Array(memory.buffer)},get HEAPF32(){return new Float32Array(memory.buffer)},
    _malloc:vi.fn(()=>16384),_free:vi.fn(),particle_collisionSetBudget:vi.fn(),particle_update:vi.fn(),
    particle_collisionQueryCount:()=>count,particle_collisionQueries:()=>128,
    particle_collisionEventCount:()=>eventCount,particle_collisionEvents:()=>4096,
    particle_collisionStatsCount:()=>0,particle_collisionStats:()=>8192,
    particle_collisionResolve:vi.fn((_registry:unknown,ptr:number,n:number)=>{
      count=0;if(!ptr||!n)return;
      const u=new Uint32Array(memory.buffer),f=new Float32Array(memory.buffer);const r=ptr/4;
      if(u[r]!==1)return;
      eventCount=1;u.set([0xf0012345,7,u[r+1],2],1024);f.set([f[r+2],f[r+3],f[r+4],f[r+5],f[r+6],f[r+7],10,0,0],1028);u[1037]=1;
    }),
  };
  const u=new Uint32Array(memory.buffer),f=new Float32Array(memory.buffer);
  u.set([0xf0012345,7,2,65535],32);f.set([0,0,0,10,0,0],36);
  return {engine:engine as unknown as EngineApi,raw:engine,memory};
}
it('copies the query batch before providers grow WASM memory and preserves integer IDs',()=>{
  const {engine,raw,memory}=engineFixture();
  const api=new ParticleAPI(engine,{} as CppRegistry,q=>{
    memory.grow(1);expect(q.dx).toBe(10);expect(q.mask).toBe(65535);
    return {body:0xf1234567 as Entity,x:2,y:0,z:0,nx:-1,ny:0,nz:0};
  });
  api.update(.1);expect(raw._free).toHaveBeenCalledWith(16384);
  expect(api.collisionEvents[0]).toMatchObject({emitter:0xf0012345,body:0xf1234567,x:2,normalX:-1,velocityX:10});
});
it('separates a valid miss from an unavailable provider',()=>{
  for(const [hit,status] of [[null,0],[undefined,2]] as const){
    const {engine,raw,memory}=engineFixture();const api=new ParticleAPI(engine,{} as CppRegistry,()=>hit);
    api.update(.1);expect(new Uint32Array(memory.buffer)[4096]).toBe(status);expect(raw.particle_collisionResolve).toHaveBeenCalledOnce();
  }
});
it('records query errors and still completes the batch through authored fallback',()=>{
  const {engine,memory}=engineFixture();const api=new ParticleAPI(engine,{} as CppRegistry,()=>{throw Error('physics offline')});
  api.update(.1);expect(api.collisionError).toContain('physics offline');expect(new Uint32Array(memory.buffer)[4096]).toBe(2);
});
it('rejects recursive update without corrupting the pending batch',()=>{
  const {engine}=engineFixture();const api=new ParticleAPI(engine,{} as CppRegistry,()=>{api.update(.1);return null});
  api.update(.1);expect(api.collisionError).toContain('cannot re-enter');
});
it('cleans up the reply allocation even when the core rejects the resolve',()=>{
  const {engine,raw}=engineFixture();raw.particle_collisionResolve.mockImplementation(()=>{throw Error('reject')});
  const api=new ParticleAPI(engine,{} as CppRegistry,()=>null);expect(()=>api.update(.1)).toThrow('reject');expect(raw._free).toHaveBeenCalledOnce();
});
it('explicitly finishes malformed or unallocatable batches as unavailable',()=>{
  const {engine,raw}=engineFixture();raw._malloc.mockReturnValue(0);
  new ParticleAPI(engine,{} as CppRegistry).update(.1);expect(raw.particle_collisionResolve).toHaveBeenCalledWith({},0,0);
  const malformed=engineFixture();malformed.raw.particle_collisionQueries=()=>65532;
  new ParticleAPI(malformed.engine,{} as CppRegistry).update(.1);
  expect(malformed.raw._malloc).not.toHaveBeenCalled();
  expect(malformed.raw.particle_collisionResolve).toHaveBeenCalledWith({},0,0);
});
it('keeps budgets, contacts and provider state isolated per API',()=>{
  const first=engineFixture(),second=engineFixture();const a=new ParticleAPI(first.engine,{} as CppRegistry),b=new ParticleAPI(second.engine,{} as CppRegistry);
  a.setCollisionBudget({queries:-1,events:Infinity});a.debugNormals=true;a.update(.1);b.update(.1);
  expect(first.raw.particle_collisionSetBudget).toHaveBeenCalledWith(0,0,true);expect(second.raw.particle_collisionSetBudget).toHaveBeenCalledWith(4096,1024,false);
  expect(a.collisionEvents).not.toBe(b.collisionEvents);
});
it('adapts 2D unit-direction/distance and 3D displacement without converting units twice',()=>{
  const ray2=vi.fn(()=>[{entity:5,point:{x:1,y:2},normal:{x:-1,y:0},fraction:.2}]);
  const ray3=vi.fn(()=>({entity:8,x:1,y:2,z:3,normalX:0,normalY:0,normalZ:-1}));
  const app={getResourceByName:(name:string)=>name==='Physics2D'?{raycast:ray2}:{raycast:ray3}} as unknown as App;
  const resolve=particleQueryResolver(app);
  const q={mode:1,mask:3,x:10,y:20,z:17,dx:3,dy:4,dz:5};
  expect(resolve(q)).toMatchObject({body:5,z:17,nz:0});expect(ray2).toHaveBeenCalledWith({x:10,y:20},{x:.6,y:.8},5,3);
  expect(resolve({...q,mode:2})).toMatchObject({body:8,z:3});expect(ray3).toHaveBeenCalledWith({x:10,y:20,z:17},{x:3,y:4,z:5},3);
});
it('supports missing optional physics modules and an explicit empty layer mask',()=>{
  const resolve=particleQueryResolver({getResourceByName:()=>null} as unknown as App);
  const q={mode:1,mask:65535,x:0,y:0,z:0,dx:1,dy:0,dz:0};
  expect(resolve(q)).toBeUndefined();expect(resolve({...q,mode:2})).toBeUndefined();expect(resolve({...q,mask:0})).toBeNull();
});
