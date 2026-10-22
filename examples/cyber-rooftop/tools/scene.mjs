import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(path.join(root,p),'utf8'));
const write = (p,v) => writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const rgba=(r,g,b,a=1)=>({r,g,b,a}); const vec=([x,y,z])=>({x,y,z});
const entities=[];
function add(name,components,parent=null) {
  const id=entities.length; entities.push({id,name,parent,children:[],visible:true,components});
  if(parent!==null) entities[parent].children.push(id); return id;
}
const tr=(p=[0,0,0],extra={})=>({type:'Transform',data:{position:vec(p),...extra}});
const c=(type,data)=>({type,data});
function rotation(yaw,pitch=0) {
  return {x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)};
}
const camera=add('Camera',[
  tr([6,2.5,13.5],{rotation:rotation(.26,-.035)}),
  c('Camera',{projectionType:0,fov:64,nearPlane:.06,farPlane:350,isActive:true,priority:0,clearFlags:3}),
  c('PostProcessVolume',{isGlobal:true,weight:1,priority:0,effects:[
    {type:'ssao',enabled:true,uniforms:{u_radius:.6,u_intensity:.8,u_bias:.04,u_power:1.2}},
    {type:'bloom',enabled:true,uniforms:{u_threshold:1.1,u_intensity:.42,u_radius:1.1}},
    {type:'distanceFog',enabled:true,uniforms:{u_fogNear:12,u_fogFar:110,u_intensity:.72},colors:{u_fogColor:rgba(.20,.31,.44)}},
    {type:'colorGrade',enabled:true,uniforms:{u_exposure:.1,u_contrast:1.03,u_saturation:.85}},
    {type:'vignette',enabled:true,uniforms:{u_intensity:.16,u_softness:.8}},
    {type:'fxaa',enabled:true,uniforms:{}},
  ]}),
]);
const prefab=read('assets/models/rooftop.esprefab'); const ids=new Map();
// Scene-specific wetness tuning lives here so re-importing the model is repeatable.
const deckMat=read('assets/models/rooftop_m0.esmaterial');
Object.assign(deckMat.properties,{u_roughness:.85,u_metallic:.15,u_specular:.35,u_normalMap:'../textures/roof-normal.png',u_metallicRoughnessMap:'../textures/roof-orm.png'});
write('assets/models/rooftop_m0.esmaterial',deckMat);
for(const e of prefab.entities) {
  const parent=e.name==='Tool'?camera:(e.parent===null?null:ids.get(e.parent));
  const comps=structuredClone(e.components);
  if(e.name==='Ghost') comps.find(x=>x.type==='Transform').data.position=vec([4,.06,9.5]);
  if(e.name==='World_puddle') comps.push(c('PlanarReflection',{axis:1,clipOffset:.025,resolutionScale:.5,maxSize:1024,enabled:true}));
  // The deck origin is below its upper face; lift the receiver's transform and mesh together.
  if(e.name==='Tool') Object.assign(comps.find(x=>x.type==='Transform').data,{position:vec([.12,-.07,-.70]),scale:vec([.78,.78,.78]),rotation:rotation(-.22,.08)});
  ids.set(e.prefabEntityId,add(e.name,comps,parent));
}
const ghostEntity=entities.find(e=>e.name==='Ghost_cyan');
const badGhost=structuredClone(ghostEntity.components);
const ghostMaterial=badGhost.find(c=>c.type==='MeshRenderer').data.material;
const invalidMaterial=read(ghostMaterial);
invalidMaterial.properties.u_emissive=rgba(4,.06,.10);
write('assets/models/invalid-placement.esmaterial',invalidMaterial);
Object.assign(badGhost.find(c=>c.type==='MeshRenderer').data,{material:'assets/models/invalid-placement.esmaterial',enabled:false});
add('Ghost_invalid',badGhost,ghostEntity.parent);
add('City ambient',[tr(),c('Light',{type:2,color:rgba(.70,.83,1),intensity:4.5,enabled:true,environment:'assets/env/night.esenv',drawEnvironment:true})]);
add('Moon fill',[tr([0,0,0],{rotation:rotation(-.3,-.65)}),c('Light',{type:1,color:rgba(.55,.72,1),intensity:1.4,enabled:true,meshShadows:true,shadowExtent:45,shadowStrength:.65})]);
const point=(name,p,col,power,radius,parent=null)=>add(name,[tr(p),c('Light',{type:0,color:col,intensity:power,radius,innerRadius:.4,falloff:1.2,enabled:true})],parent);
point('Warm entrance',[.2,3,-2],rgba(1,.58,.25),2.4,14);
point('Grow bay pink',[-10,3,-1],rgba(1,.12,.42),1.2,15);
point('Upper grow pink',[-11,5.1,-2],rgba(1,.12,.45),.9,12);
point('Water plant cyan',[6,2,-2],rgba(.30,.72,1),1.4,13);
point('Rooftop neon bounce',[2,4,8],rgba(.55,.68,.85),2.0,18);
point('Street magenta spill',[-15,3,8],rgba(1,.08,.4),1.8,15);
point('Billboard spill',[13,8,-12],rgba(.03,.42,1),2.5,20);
point('Tool fill',[.2,.1,-.3],rgba(.85,.88,1),1.2,2.5,camera);

// A small reusable build pool keeps all assets in the normal scene loading path.
for(let i=0;i<12;i++) {
  const root=add(`Built ${i}`,[tr()]);
  const piece=(name,p,s,mesh,color)=>add(`Built ${i} ${name}`,[tr(p,{scale:vec(s.map(v=>v/100))}),c('MeshRenderer',{mesh,lit:true,opaque:true,enabled:false,color})],root);
  piece('platform',[0,.18,0],[5.8,.32,3.4],'builtin:cube',rgba(.26,.34,.39));
  for(const x of [-2.8,2.8]) for(const z of [-1.6,1.6]) piece(`leg ${x} ${z}`,[x,.15,z],[.18,.30,.18],'builtin:cube',rgba(.5,.6,.65));
  piece('filter',[0,1.0,0],[.8,1.7,.8],'builtin:cylinder',rgba(.44,.56,.61));
  piece('control',[.6,.55,.1],[.5,.9,.7],'builtin:cube',rgba(.1,.18,.23));
}

// Rain and vent steam are actual runtime emitters.
const emitter=(name,p,config)=>add(name,[tr(p),c('ParticleEmitter',{texture:'assets/textures/soft.png',enabled:true,looping:true,playOnStart:true,simulationSpace:0,...config})]);
emitter('Rain',[0,13,-2],{shape:2,shapeSize:{x:34,y:1,z:28},rate:400,maxParticles:900,lifetimeMin:1.2,lifetimeMax:1.5,speedMin:0,speedMax:0,gravity:vec([1,-18,0]),startColor:rgba(.38,.69,1,.24),endColor:rgba(.38,.69,1,.04),startSizeMin:.018,startSizeMax:.028,endSizeMin:.018,endSizeMax:.028,trailEnabled:true,trailWidth:.015,trailPoints:3,trailMinDistance:.12,blendMode:1});
for(const [x,z] of [[10,-13],[-15,-5],[17,3]]) emitter('Steam '+x,[x,.5,z],{shape:3,shapeRadius:.22,shapeAngle:12,rate:9,maxParticles:70,lifetimeMin:3,lifetimeMax:5,speedMin:.35,speedMax:.7,gravity:vec([.06,.18,0]),startColor:rgba(.32,.48,.62,.13),endColor:rgba(.35,.5,.7,0),startSizeMin:.6,startSizeMax:1,endSizeMin:2.2,endSizeMax:3.1,blendMode:0});

// Native 2D Canvas over the 3D world; no DOM or reference screenshot in the game.
const canvas=add('HUD',[tr(),c('Canvas',{designResolution:{x:1672,y:940},scaleMode:2,backgroundColor:rgba(0,0,0,0)}),c('UINode',{})]);
const px=value=>({unit:0,value});
function ui(name,x,y,w,h,components=[],parent=canvas) {
  return add(name,[tr(),c('UINode',{position:1,insetLeft:px(x),insetTop:px(y),width:px(w),height:px(h)}),...components],parent);
}
function art(name,asset,x,y,w,h,parent=canvas) {return ui(name,x,y,w,h,[c('UIVisual',{visualType:2,texture:`assets/textures/${asset}.png`,color:rgba(1,1,1),enabled:true})],parent);}
function rect(name,x,y,w,h,color,parent=canvas) {return ui(name,x,y,w,h,[c('UIVisual',{visualType:1,color,enabled:true})],parent);}
function label(name,text,x,y,w,h=28,size=20,color=rgba(.91,.96,1),bold=false,align=0,parent=canvas) {return ui(name,x,y,w,h,[c('Text',{content:text,fontSize:size,fontFamily:'Microsoft YaHei, sans-serif',color,bold,align,verticalAlign:1,wordWrap:false})],parent);}
const cyan=rgba(.1,.84,1),pink=rgba(1,.08,.6),muted=rgba(.61,.78,.85);
art('Location panel','hud-location',20,20,270,100);
label('Location icon','▥',36,28,36,45,34,cyan);
label('Location','下城避难所',82,26,194,28,22,undefined,true);
label('Day','第 07 天 · 22:16',83,56,195,24,16);
rect('Location divider',28,81,248,1,rgba(.2,.5,.6,.5));
label('Weather','☂  酸雨 · 18°C',36,87,240,27,18,muted);
art('Objectives panel','hud-objectives',20,134,280,112);
label('Objective title','建立安全屋',36,143,250,29,21,undefined,true);
rect('Objective divider',29,176,256,1,rgba(.2,.5,.6,.5));
label('Power objective','☑  接通备用电源',37,183,240,25,18);
label('Water objective','□  建造净水装置  0/1',37,214,256,24,17);
rect('Compass line',508,26,652,1,rgba(.7,.82,.9,.75));
for(const [i,text] of ['W','NW','N','NE','E'].entries()) {const x=548+i*134;label('Compass '+text,text,x,36,50,27,17,undefined,false,1);rect('Compass tick '+i,x+25,24,1,12,muted);}
label('North marker','▼',825,5,30,25,17,undefined,false,1);
label('Waypoint','◇  废料回收站 180 m',928,74,280,28,18,rgba(1,.76,.23));
art('Minimap','hud-map',1400,21,250,194);
art('Map border','hud-location',1398,20,254,198);
// The map is above its backing frame; labels and player marker remain separate.
art('Minimap detail','hud-map',1405,48,240,159);
label('Map title','区域扫描',1414,24,180,25,18,undefined,true);
label('Map north','N',1620,25,22,22,16);
label('Map player','▲',1523,130,30,30,26,cyan,false,1);

art('Vitals panel','hud-vitals',20,740,260,174);
for(const [i,icon,title,value,col] of [[0,'✚','生命','100',rgba(.12,.93,.48)],[1,'◉','义体','82%',cyan],[2,'◈','饮水','64%',cyan],[3,'ϟ','能量','71%',rgba(1,.8,.05)]]) {
 const y=748+i*40;label('Vital icon '+i,icon,34,y,36,29,26,col);
 label('Vital label '+i,title,76,y,95,24,18);label('Vital value '+i,value,210,y,48,24,17,undefined,false,2);
 rect('Vital track '+i,76,y+27,181,8,rgba(.13,.24,.28,.9));
 rect('Vital fill '+i,76,y+27,181*[1,.82,.64,.71][i],8,col);
}
art('Build panel','hud-build',1392,540,260,190);
art('Building icon','hud-item-4',1408,550,67,49);
label('Building title','加固平台',1490,554,148,30,22,undefined,true);
rect('Build divider',1408,604,226,1,muted);
label('Steel label','▰  废钢',1410,619,140,26,20);label('Steel value','24/4',1560,619,76,26,20,undefined,false,2);
label('Circuit label','▧  电子元件',1410,656,150,26,20);label('Circuit value','16/2',1560,656,76,26,20,undefined,false,2);
label('Build status','●  可建造',1410,695,225,26,19,rgba(.22,1,.45),true);
art('Controls frame','hud-hint',622,738,430,40);
label('Controls','鼠标左键 放置   R 旋转   Esc 取消',633,743,408,28,17,undefined,false,1);
for(let i=0;i<8;i++) {
 const x=446+i*98;const slot=art('Slot '+(i+1),'hud-slot',x,802,92,94);
 entities[slot].components.push(c('Interactable',{enabled:true,raycastTarget:true,blockRaycast:true}));
 label('Slot key '+i,String(i+1),x+9,807,22,22,16);
 art('Item '+i,`hud-item-${i+1}`,x+5,825,82,64);
}
const select=ui('Selected slot',740,802,92,94);
rect('Select top',0,0,92,3,cyan,select);rect('Select left',0,0,3,94,cyan,select);rect('Select right',89,0,3,94,cyan,select);rect('Select bottom',0,91,92,3,cyan,select);
label('Navigation hint','WASD 移动 · 按住右键环视 · B 建造 · F 回收 · Home 参考视角',450,908,800,22,14,muted,false,1);
label('Crosshair','·',824,452,24,28,27,undefined,false,1);
label('Toast','',560,672,560,32,21,rgba(.25,1,.85),false,1);
write('assets/scenes/main.esscene',{version:4,name:'下城避难所',entities});
console.log(`Scene: ${entities.length} entities, ${prefab.entities.length} imported model nodes.`);
