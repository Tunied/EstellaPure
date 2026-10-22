import { Transform, MeshRenderer, Text } from 'esengine';
import type { World } from 'esengine';

export function entity(w:World,name:string) {
  const id=w.findEntityByName(name);
  if(id===null)throw new Error(`Missing scene contract: ${name}`);
  return id;
}
export function label(w:World,name:string,content:string) {
  const id=entity(w,name),data=w.get(id,Text);
  if(data.content!==content)w.insert(id,Text,{...data,content});
}
export function move(w:World,name:string,x:number,y:number,z:number,yaw=0) {
  const id=entity(w,name),data=w.get(id,Transform);
  w.insert(id,Transform,{...data,position:{x,y,z},rotation:{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}});
}
export function meshVisible(w:World,name:string,enabled:boolean) {
  const id=entity(w,name),data=w.get(id,MeshRenderer);
  if(data.enabled!==enabled)w.insert(id,MeshRenderer,{...data,enabled});
}
