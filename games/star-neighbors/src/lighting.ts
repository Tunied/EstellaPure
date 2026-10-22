import { defineSystem,GetWorld,Res,Input,UIEvents,Light,MeshRenderer } from 'esengine';
import { StudyState } from './state';
import { entity,move,meshVisible } from './scene-access';

export const lightingSystem=defineSystem([GetWorld(),Res(Input),Res(UIEvents),Res(StudyState)],(w,input,events,s)=>{
  if(w.findEntityByName('Camera')===null)return;
  if(input.isKeyPressed('KeyN')||events.query('click').some(c=>c.target===entity(w,'Light button'))){
    s.night=!s.night;
    for(const [name,day,night] of [['Sky',.55,.11],['Sun',1.4,.18]] as const){
      const id=entity(w,name),d=w.get(id,Light);w.insert(id,Light,{...d,intensity:s.night?night:day});
    }
    const id=entity(w,'Sun'),d=w.get(id,Light);w.insert(id,Light,{...d,color:s.night?{r:.38,g:.57,b:1,a:1}:{r:1,g:.96,b:.9,a:1}});
    const sky=entity(w,'Sky dome__sky'),skyData=w.get(sky,MeshRenderer);
    w.insert(sky,MeshRenderer,{...skyData,color:s.night?{r:.009,g:.018,b:.055,a:1}:{r:.23,g:.48,b:.70,a:1}});
    meshVisible(w,'Sky dome__star',s.night);
  }
  move(w,'Robot',.1,1.65+Math.sin(s.elapsed*1.7)*.12,.1,Math.sin(s.elapsed*.4)*.2);
},{name:'StudyLighting'});
