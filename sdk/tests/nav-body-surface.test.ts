// SPDX-License-Identifier: Apache-2.0
import { it,expect,vi } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { Entity } from '../src/types';
import { NavAgent } from '../src/ai/nav/NavAgent';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { stepNavigation,type NavWorldView,type AgentRuntime } from '../src/ai/nav/NavPlugin';
import { avoidVelocity } from '../src/ai/nav/avoidance';

it('checks continuous disk clearance at tile faces, corners and map bounds',()=>{
    const grid=new NavGrid({width:5,height:5,cellSize:10});grid.setWalkable(2,2,false);
    expect(grid.isNavigable({x:13,y:20})).toBe(true);
    expect(grid.isNavigable({x:13,y:20},{radius:3})).toBe(false);
    expect(grid.isNavigable({x:12,y:20},{radius:3})).toBe(true);
    expect(grid.isNavigable({x:13,y:13},{radius:3})).toBe(false);
    expect(grid.isNavigable({x:12,y:12},{radius:3})).toBe(true);
    expect(grid.isNavigable({x:-4,y:0},{radius:2})).toBe(false);
    expect(grid.isNavigable({x:-3,y:0},{radius:2})).toBe(true);
});

it('plans fractional radii against tile faces rather than blocked cell centres',()=>{
    const grid=new NavGrid({width:11,height:9,cellSize:1});
    for(let y=0;y<9;y++)if(y!==4)grid.setWalkable(5,y,false);
    const from={x:2,y:4},to={x:8,y:4};
    expect(grid.queryWorldPath(from,to,{radius:.5}).status).toBe('complete');
    expect(grid.queryWorldPath(from,to,{radius:.6})).toMatchObject({status:'partial',reason:'insufficient-clearance'});
    expect(grid.isNavigable({x:5,y:4},{radius:.6})).toBe(false);
});

it('checks the forecast segment even without other bodies',()=>{
    const canStand=(x:number,z:number)=>!(x>=4&&x<=6&&Math.abs(z)<1);
    const v=avoidVelocity({x:0,z:0,vx:0,vz:0,radius:1},{x:20,z:0},[],{maxSpeed:20,horizon:1,canStand});
    expect(Number.isFinite(v.x)&&Number.isFinite(v.z)).toBe(true);
    for(let i=1;i<=4;i++)expect(canStand(v.x*.4*i/4,v.z*.4*i/4)).toBe(true);
});

it('replans a deviated body route before it cuts through a blocked tile',()=>{
    const e=1 as Entity,grid=new NavGrid({width:12,height:12,cellSize:32}),nav=new Navigation();
    grid.setWalkable(5,5,false);nav.setSurface(grid);nav.planningBudgetMs=0;
    const data=new Map<string,unknown>([
        ['NavAgent',NavAgent.create({hasTarget:true,targetX:256,targetY:256,radius:8,speed:0,arriveRadius:3,repathInterval:0})],
        ['Transform',{position:{x:127,y:130,z:0}}],
    ]);
    const world={getEntitiesWithComponents:()=>[e],has:(_e:Entity,c:{_name:string})=>data.has(c._name),
        get:(_e:Entity,c:{_name:string})=>structuredClone(data.get(c._name)),
        set:(_e:Entity,c:{_name:string},v:unknown)=>{data.set(c._name,v);}} as NavWorldView;
    const runtimes=new Map<Entity,AgentRuntime>(),query=vi.spyOn(nav,'queryWorldPath');
    stepNavigation(world,nav,1/60,runtimes);
    const rt=runtimes.get(e)!;rt.waypoints=[{x:127,y:130,z:0},{x:192,y:192,z:0}];rt.index=1;
    const agent=world.get(e,NavAgent);agent.speed=120;world.set(e,NavAgent,agent);
    for(let i=0;i<300;i++){
        stepNavigation(world,nav,1/60,runtimes);
        expect(grid.isNavigable(world.get(e,Transform).position,{radius:8})).toBe(true);
    }
    expect(query.mock.calls.length).toBeGreaterThan(1);
    expect(world.get(e,NavAgent).arrived).toBe(true);
});
