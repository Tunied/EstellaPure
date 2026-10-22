import { addPlugin,Playthrough } from 'esengine';
import { StudyState,initialState } from './state';
import { cameraSystem } from './camera';
import { constructionSystem } from './construction/system';
import { lightingSystem } from './lighting';
import { hudSystem } from './hud';

addPlugin({name:'StarNeighborsArtStudy',build(app){
  app.insertResource(StudyState,initialState());
  app.insertResource(Playthrough,{facts:{ready:false}});
  app.addSystem(cameraSystem);app.addSystem(constructionSystem);
  app.addSystem(lightingSystem);app.addSystem(hudSystem);
}});
