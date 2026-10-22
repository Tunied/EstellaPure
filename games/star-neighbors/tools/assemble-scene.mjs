import { readFileSync,writeFileSync,mkdirSync,copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene,rgba,vec,rotation,transform as tr,component as c } from './scene-helpers.mjs';
import { addHUD } from './hud-layout.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
const prefab=id=>read(`assets/models/${id}/${id}.esprefab`);
const scene=createScene(),{add,instance}=scene;
mkdirSync(path.join(root,'assets/scenes'),{recursive:true});mkdirSync(path.join(root,'assets/env'),{recursive:true});
for(const file of ['sky.esenv','sky_env.png','sky_sky.png'])copyFileSync(path.resolve(root,'../../examples/lighting-3d/assets/env',file),path.join(root,'assets/env',file));
add('Camera',[tr([14,9,20],{rotation:rotation(.614,-.302)}),c('Camera',{projectionType:0,fov:46,nearPlane:.1,farPlane:350,isActive:true,priority:0,clearFlags:3}),c('PostProcessVolume',{isGlobal:true,weight:1,priority:0,effects:[
  {type:'ssao',enabled:true,uniforms:{u_radius:.5,u_intensity:.7,u_bias:.035,u_power:1.1}},
  {type:'bloom',enabled:true,uniforms:{u_threshold:1.4,u_intensity:.12,u_radius:1}},
  {type:'fxaa',enabled:true,uniforms:{}},
]})]);
for(const item of read('art/source/sample-layout.json'))instance(prefab(item.asset),item.name,item.position,item.yaw*Math.PI/180,item.scale);
for(const e of scene.entities){
  const mr=e.components.find(c=>c.type==='MeshRenderer')?.data;
  if(mr&&e.name.startsWith('Sky dome__')){mr.lit=false;mr.material='';if(e.name.endsWith('__star'))mr.enabled=false;}
}
add('Sky',[tr(),c('Light',{type:2,color:rgba(1,1,1),intensity:.55,enabled:true,environment:'assets/env/sky.esenv',drawEnvironment:false})]);
add('Sun',[tr([0,0,0],{rotation:rotation(-.7,-.75)}),c('Light',{type:1,color:rgba(1,.96,.9),intensity:1.4,enabled:true,meshShadows:true,shadowExtent:42,shadowStrength:.85})]);
add('Porch light',[tr([-3,2,1]),c('Light',{type:0,color:rgba(1,.61,.22),intensity:2,radius:7,innerRadius:.4,falloff:1.2,enabled:true})]);
add('Gate glow',[tr([6.3,2.5,-1]),c('Light',{type:0,color:rgba(.12,.7,1),intensity:2,radius:7,innerRadius:.5,falloff:1.2,enabled:true})]);
for(let i=0;i<8;i++)for(const [k,id] of ['floor-2m','planter','crate'].entries())instance(prefab(id),`Built ${i} ${k}`,[0,0,0],0,1,false);
const cursor=add('Placement cursor',[tr([2,.035,4])]);
// Imported frame meshes share one transform; the two colours never render together.
for(const [name,color] of [['Cursor valid',rgba(.12,.85,.58,.55)],['Cursor blocked',rgba(1,.39,.08,.55)]]){
  add(name,[tr([0,.01,0],{scale:vec([.0202,.0002,.0202])}),c('MeshRenderer',{mesh:'builtin:cube',color,lit:false,opaque:false,enabled:false})],cursor);
}
addHUD(scene);
writeFileSync(path.join(root,'assets/scenes/art-sample.esscene'),JSON.stringify({version:4,name:'星邻计划 · 模块化样区',entities:scene.entities},null,2)+'\n');
console.log(`Assembled ${scene.entities.length} entities from independent kit prefabs.`);
