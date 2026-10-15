// SPDX-License-Identifier: Apache-2.0
import {it,expect} from 'vitest';
import type {Entity,Vec3} from '../src/types';
import {Transform} from '../src/ecs/component';
import {NavAgent} from '../src/ai/nav/NavAgent';
import {NavGrid} from '../src/ai/nav/NavGrid';
import {Navigation} from '../src/ai/nav/Navigation';
import {stepNavigation,type NavWorldView,type AgentRuntime} from '../src/ai/nav/NavPlugin';
import {applyObstaclesToGrid} from '../src/ai/nav/navObstacles';

it.each([1/60,1/50,1/120,1/30,1/15,1/10])('delivers an eight-agent courtyard around a warehouse at dt=%s',dt=>{
    const grid=new NavGrid({width:23,height:13,cellSize:32,origin:{x:-352,y:-192}}),nav=new Navigation();
    for(let y=0;y<13;y++)for(let x=0;x<23;x++)if(x===0||x===22||y===0||y===12||(x===11&&(y<5||y>7)))grid.setWalkable(x,y,false);
    applyObstaclesToGrid(grid,[{center:{x:-160,y:0,z:0},halfExtents:{x:46,y:46,z:32},rotation:{x:0,y:0,z:0,w:1}}]);
    nav.setSurface(grid);nav.planningBudgetMs=0;
    const entities=Array.from({length:8},(_,i)=>(i+1) as Entity);
    const data=entities.map((_,i)=>new Map<string,unknown>([
        ['Transform',{position:{x:-288+(i%3)*32,y:-96+Math.floor(i/3)*32,z:0}}],
        ['NavAgent',NavAgent.create({speed:78,radius:8,arriveRadius:5,repathInterval:0,hasTarget:true,targetX:64+(i%5)*64,targetY:-128+Math.floor(i/5)*64})],
    ]));
    const world={getEntitiesWithComponents:()=>entities,has:(e:Entity,c:{_name:string})=>data[e-1].has(c._name),
        get:(e:Entity,c:{_name:string})=>structuredClone(data[e-1].get(c._name)),
        set:(e:Entity,c:{_name:string},v:unknown)=>{
            if(c._name==='Transform'){
                const pose=v as {position:Vec3};
                for(const axis of ['x','y','z'] as const)pose.position[axis]=Math.fround(pose.position[axis]);
            }
            data[e-1].set(c._name,structuredClone(v));
        }} as NavWorldView;
    const runtimes=new Map<Entity,AgentRuntime>();
    for(let i=0;i<Math.ceil(15/dt);i++){
        stepNavigation(world,nav,dt,runtimes);
        for(const e of entities)expect(grid.isNavigable(world.get(e,Transform).position,{radius:8})).toBe(true);
    }
    const state=entities.map((e,i)=>({agent:data[i].get('NavAgent'),pose:data[i].get('Transform'),runtime:runtimes.get(e)}));
    expect(state.filter(s=>(s.agent as {arrived:boolean}).arrived),JSON.stringify(state)).toHaveLength(8);
});
