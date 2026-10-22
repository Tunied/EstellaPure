import { defineSystem,GetWorld,Res,Input,UIEvents } from 'esengine';
import { StudyState } from '../state';
import { entity,move,meshVisible } from '../scene-access';
import { modules,placementReason } from './rules';

export const constructionSystem=defineSystem([GetWorld(),Res(Input),Res(UIEvents),Res(StudyState)],(w,input,events,s)=>{
  if(w.findEntityByName('Camera')===null)return;
  const clicks=events.query('click');
  const clicked=(name:string)=>clicks.some(c=>c.target===entity(w,name));
  if(input.isKeyPressed('KeyB')||clicked('Build button'))s.building=!s.building;
  if(input.isKeyPressed('Escape'))s.building=false;
  for(let i=0;i<modules.length;i++)if(input.isKeyPressed(`Digit${i+1}`)||clicked(`Module ${i}`)){s.selected=i;s.building=true;}
  if(s.building){
    s.cursor.x+=2*(Number(input.isKeyPressed('ArrowRight'))-Number(input.isKeyPressed('ArrowLeft')));
    s.cursor.z+=2*(Number(input.isKeyPressed('ArrowDown'))-Number(input.isKeyPressed('ArrowUp')));
    s.cursor.x=Math.max(-10,Math.min(10,s.cursor.x));s.cursor.z=Math.max(2,Math.min(10,s.cursor.z));
    if(input.isKeyPressed('KeyR'))s.cursor.rotation=(s.cursor.rotation+1)%4;
  }
  const p={...s.cursor,kind:s.selected};let reason=placementReason(p,s.placed);
  if(s.building&&(input.isKeyPressed('Enter')||clicked('Place button'))){
    if(reason)s.message=reason;
    else{s.placed.push(p);s.message=`${modules[p.kind].title}已放好。可以继续组合，也可以撤回重摆。`;}
  }
  if(input.isKeyPressed('Backspace')||clicked('Undo button')){
    const previous=s.placed.pop();s.message=previous?'已收回最后一个部件。':'庭院里还没有新部件。';
  }
  reason=placementReason(p,s.placed);s.valid=!reason;
  for(let i=0;i<8;i++)for(let k=0;k<modules.length;k++){
    const placed=s.placed[i],enabled=!!placed&&placed.kind===k;
    if(enabled)move(w,`Built ${i} ${k}`,placed.x,0,placed.z,placed.rotation*Math.PI/2);
    for(const part of modules[k].parts)meshVisible(w,`Built ${i} ${k}__${part}`,enabled);
  }
  move(w,'Placement cursor',s.cursor.x,.035,s.cursor.z,s.cursor.rotation*Math.PI/2);
  meshVisible(w,'Cursor valid',s.building&&s.valid);meshVisible(w,'Cursor blocked',s.building&&!s.valid);
},{name:'StudyConstruction'});
