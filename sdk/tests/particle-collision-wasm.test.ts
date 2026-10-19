// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {afterEach,beforeAll,describe,it,expect} from 'vitest';
import {App} from '../src/app/app';
import {Transform,ParticleEmitter} from '../src/ecs/component';
import {Particle,ParticlePlugin} from '../src/particle';
import {ParticleCollisionEvent,type ParticleCollisionEventPayload} from '../src/particle/collision';
import {EventReader,type EventReaderInstance} from '../src/ecs/event';
import {defineSystem,Schedule} from '../src/ecs/system';
import {Physics2DPlugin} from '../src/physics/Physics2DPlugin';
import {Physics2DRuntime} from '../src/physics/Physics2DRuntime';
import {RigidBody2D,BoxCollider2D,BodyType} from '../src/physics/PhysicsComponents';
import type {PhysicsWasmModule} from '../src/physics/PhysicsModuleLoader';
import {Physics3DPlugin,Physics3DRuntime} from '../src/physics3d/Physics3DPlugin';
import {RigidBody3D,BoxCollider3D} from '../src/physics3d/Physics3DComponents';
import type {Physics3DWasmModule} from '../src/physics3d/Physics3DModule';
import type {ESEngineModule} from '../src/wasm';
import {HAS_WASM,hasSideModule,loadSideModule,loadWasmModule} from './helpers/loadWasm';
let engine:ESEngineModule;const apps:App[]=[];
afterEach(()=>{for(const app of apps.splice(0))app.quit()});
describe.skipIf(!HAS_WASM||!hasSideModule('physics')||!hasSideModule('physics3d'))('particle scene collision through actual core / Box2D / Jolt WASM',()=>{
 beforeAll(async()=>{engine=await loadWasmModule()});
 it.each([1,2])('casts fast particles across a thin wall and publishes world-unit events (mode=%i)',async mode=>{
  const app=App.new();apps.push(app);app.connectCpp(new engine.Registry(),engine,{ownedRegistry:true});
  if(mode===1){const module=await loadSideModule<PhysicsWasmModule>('physics');app.addPlugin(new Physics2DPlugin('',{gravity:{x:0,y:0}},async()=>module));await app.getResource(Physics2DRuntime).initPromise;}
  else{const module=await loadSideModule<Physics3DWasmModule>('physics3d');app.addPlugin(new Physics3DPlugin('',{gravity:{x:0,y:0,z:0}},async()=>module));await app.getResource(Physics3DRuntime).initPromise;}
  app.addPlugin(new ParticlePlugin());const world=app.world,wall=world.spawn();world.insert(wall,Transform,{position:{x:100,y:0,z:0}});
  if(mode===1){world.insert(wall,RigidBody2D,{bodyType:BodyType.Static});world.insert(wall,BoxCollider2D,{halfExtents:{x:.05,y:2}});}
  else{world.insert(wall,RigidBody3D,{bodyType:0});world.insert(wall,BoxCollider3D,{halfExtents:{x:5,y:200,z:200}});}
  const received:ParticleCollisionEventPayload[]=[];
  app.addSystemToSchedule(Schedule.Update,defineSystem([EventReader(ParticleCollisionEvent)],(reader:EventReaderInstance<ParticleCollisionEventPayload>)=>{for(const hit of reader)received.push(hit)},{name:'ReadParticleContacts'}));
  await app.stepFrames(2,1/30);
  const emitter=world.spawn();world.insert(emitter,Transform,{rotation:{x:0,y:0,z:-Math.SQRT1_2,w:Math.SQRT1_2}});
  world.insert(emitter,ParticleEmitter,{shape:0,angleSpreadMin:90,angleSpreadMax:90,rate:0,burstCount:1,burstInterval:100,maxParticles:4,lifetimeMin:2,lifetimeMax:2,speedMin:60000,speedMax:60000,gravity:{x:0,y:0,z:0},collisionEnabled:true,collisionMode:mode,collisionFallback:1,collisionEvents:true,collisionBounce:1,collisionMask:65535});
  await app.stepFrames(3,1/60);
  const hit=received.find(h=>h.emitter===emitter);expect(hit).toBeDefined();expect(hit!.body).toBe(wall);expect(hit!.x).toBeCloseTo(95,1);expect(hit!.normalX).toBeLessThan(-.99);expect(hit!.velocityX).toBeCloseTo(60000,0);expect(hit!.mode).toBe(mode);
  expect(app.getResource(Particle).collisionError).toBeNull();
 });
});
