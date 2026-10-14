// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {runElectron} from './lib/electronRun.mjs';
if(!process.env.CI)throw Error('This editor acceptance check runs only in CI; local verification must not launch the editor.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output/gizmo-hover-ci');fs.mkdirSync(out,{recursive:true});
const project=fs.mkdtempSync(path.join(out,'project-'));fs.mkdirSync(path.join(project,'assets/scenes'),{recursive:true});fs.mkdirSync(path.join(project,'src'));
fs.writeFileSync(path.join(project,'project.esproject'),JSON.stringify({formatVersion:'1',name:'Hover acceptance',defaultScene:'assets/scenes/main.esscene',spineVersion:'none'}));
fs.writeFileSync(path.join(project,'assets/scenes/main.esscene'),JSON.stringify({version:'1.0',name:'Main',entities:[{id:1,name:'Subject',parent:null,children:[],visible:true,components:[{type:'Transform',data:{position:{x:0,y:0,z:0}}},{type:'Sprite',data:{size:{x:60,y:60},color:{r:1,g:0,b:1,a:1}}}]}]}));
fs.writeFileSync(path.join(project,'src/main.ts'),'export {};');fs.writeFileSync(path.join(project,'src/components.ts'),'export {};');
const records=[];
const read="(() => { const s=document.querySelector('.viewport__stage'); return {hover:s?.dataset.gizmoHover,cursor:s?.style.cursor,scene:JSON.stringify(window.__estellaEditor.surface.serializeScene())}; })()";
try{
 for(const c of [{mode:'move',x:30,y:0,id:'move.x',cursor:'move'},{mode:'scale',x:30,y:0,id:'scale.x',cursor:'ew-resize'},{mode:'rotate',x:42,y:0,id:'rotate.z',cursor:'grab'}]){
  const run=runElectron(['.'],{via:'npx',encoding:'utf8',cwd:path.join(root,'desktop'),timeout:180000,env:{
   ESTELLA_SHOT:path.join(out,c.mode+'.png'),ESTELLA_SHOT_PROJECT:project,ESTELLA_SHOT_SCENE:'assets/scenes/main.esscene',
   ESTELLA_SHOT_EVAL:`(async () => {const e=window.__estellaEditor;e.runCommand('mode.scene');e.runCommand('view.resetOrbit');e.surface.setGizmoDisplay({show:true,selectedOnly:true,iconSize:16,types:{}});e.surface.select(1);e.frame([1]);await new Promise(resolve=>setTimeout(resolve,750));e.runCommand('tool.${c.mode}');return true;})()`,
   ESTELLA_SHOT_EDITOR_DRAG:JSON.stringify({selector:'.viewport__stage canvas',ox:c.x,oy:c.y,steps:1,hoverOnly:true,read})}});
  assert.equal(run.status,0,run.stderr);const line=run.stdout.split('\n').find(line=>line.startsWith('[editorDrag] '));assert(line,'Missing trusted hover observation');
  const result=JSON.parse(line.slice('[editorDrag] '.length));assert.equal(result.after.hover,c.id);assert.equal(result.after.cursor,c.cursor);assert.equal(result.after.scene,result.before.scene,'Hover edited the scene');
  assert(fs.existsSync(path.join(out,c.mode+'.png')),'Missing editor screenshot');records.push({mode:c.mode,...result});
 }
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({status:'checks-passed',mode:'CI-editor-trusted-hover',records},null,2));
 console.log('Gizmo hover CI: move/scale/rotate preselection and cursors pass; scene unchanged');
}finally{if(!project.startsWith(out+path.sep))throw Error('Unexpected cleanup root');fs.rmSync(project,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
