import { defineSystem,GetWorld,Res,Input,Time,Transform } from 'esengine';
import { StudyState,home } from './state';
import { entity } from './scene-access';

export const cameraSystem=defineSystem([GetWorld(),Res(Input),Res(Time),Res(StudyState)],(w,input,time,s)=>{
  if(w.findEntityByName('Camera')===null)return;
  const dt=Math.min(time.delta,.05);s.frame++;s.elapsed+=dt;
  const id=entity(w,'Camera'),t=w.get(id,Transform);
  if(input.isKeyPressed('Home')){s.yaw=home.yaw;s.pitch=home.pitch;t.position={x:home.x,y:home.y,z:home.z};}
  const mouse=input.getMousePosition();
  if(input.isMouseButtonDown(2)&&s.lastMouse){s.yaw-=(mouse.x-s.lastMouse.x)*.003;s.pitch=Math.max(-1.1,Math.min(.2,s.pitch-(mouse.y-s.lastMouse.y)*.003));}
  s.lastMouse=mouse;
  const f=Number(input.isKeyDown('KeyW'))-Number(input.isKeyDown('KeyS'));
  const side=Number(input.isKeyDown('KeyD'))-Number(input.isKeyDown('KeyA'));
  const speed=dt*(input.isKeyDown('ShiftLeft')?10:5)/(Math.hypot(f,side)||1);
  t.position.x=Math.max(-14,Math.min(20,t.position.x+(side*Math.cos(s.yaw)-f*Math.sin(s.yaw))*speed));
  t.position.z=Math.max(-10,Math.min(26,t.position.z+(-side*Math.sin(s.yaw)-f*Math.cos(s.yaw))*speed));
  t.position.y=Math.max(2,Math.min(14,t.position.y+(Number(input.isKeyDown('KeyE'))-Number(input.isKeyDown('KeyQ')))*dt*4));
  t.rotation={x:Math.cos(s.yaw/2)*Math.sin(s.pitch/2),y:Math.sin(s.yaw/2)*Math.cos(s.pitch/2),z:-Math.sin(s.yaw/2)*Math.sin(s.pitch/2),w:Math.cos(s.yaw/2)*Math.cos(s.pitch/2)};
  w.insert(id,Transform,t);
},{name:'StudyCamera'});
