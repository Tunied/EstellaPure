import { defineSystem,GetWorld,Res,Playthrough,Transform } from 'esengine';
import { StudyState } from './state';
import { label,entity } from './scene-access';
import { modules,placementReason } from './construction/rules';

export const hudSystem=defineSystem([GetWorld(),Res(StudyState),Res(Playthrough)],(w,s,telemetry)=>{
  if(w.findEntityByName('Camera')===null)return;
  label(w,'Build label',s.building?'退出建造  B':'开始建造  B');
  label(w,'Light label',s.night?'切换日光  N':'查看夜间灯光  N');
  label(w,'Status',s.building?(placementReason({...s.cursor,kind:s.selected},s.placed)||'位置合适 · Enter 放置'):'在家园中看看，或试着摆几个部件。');
  label(w,'Selection',`${modules[s.selected].title}  ·  2 米网格  ·  ${s.placed.length}/8`);
  label(w,'Message',s.message);
  label(w,'Cursor readout',s.building?`庭院坐标 ${s.cursor.x}, ${s.cursor.z}  ·  ${s.cursor.rotation*90}°`:'美术与拼装试验 · 本地单人');
  const cam=w.get(entity(w,'Camera'),Transform);
  Object.assign(telemetry.facts,{ready:true,frame:s.frame,placed:s.placed.length,building:s.building,selected:s.selected,valid:s.valid,night:s.night,cursorX:s.cursor.x,cursorZ:s.cursor.z,rotation:s.cursor.rotation,cameraX:cam.position.x,cameraZ:cam.position.z});
},{name:'StudyHUD'});
