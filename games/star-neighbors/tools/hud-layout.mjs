import { rgba,transform as tr,component as c } from './scene-helpers.mjs';

export function addHUD(scene) {
  const {add,entities}=scene;
  const canvas=add('HUD',[tr(),c('Canvas',{designResolution:{x:1600,y:1000},scaleMode:2,backgroundColor:rgba(0,0,0,0)}),c('UINode',{})]);
  const px=value=>({unit:0,value});
  const ui=(name,x,y,w,h,components=[])=>add(name,[tr(),c('UINode',{position:1,insetLeft:px(x),insetTop:px(y),width:px(w),height:px(h)}),...components],canvas);
  const rect=(name,x,y,w,h,color)=>ui(name,x,y,w,h,[c('UIVisual',{visualType:1,color,enabled:true})]);
  const ink=rgba(.13,.20,.21),muted=rgba(.34,.42,.41),paper=rgba(.98,.97,.91,.95),orange=rgba(.84,.35,.10);
  const label=(name,content,x,y,w,h=30,size=20,color=ink,bold=false)=>ui(name,x,y,w,h,[c('Text',{content,fontFamily:'Microsoft YaHei, sans-serif',fontSize:size,color,bold,verticalAlign:1,wordWrap:false})]);
  function button(name,title,x,y,w,labelName=name+' label') {
    const id=rect(name,x,y,w,44,rgba(.18,.30,.29,.96));
    entities[id].components.push(c('Interactable',{enabled:true,raycastTarget:true,blockRaycast:true}));
    label(labelName,title,x+14,y+6,w-24,30,17,rgba(1,.98,.89));
  }
  rect('Location card',28,28,355,108,paper);rect('Location stripe',28,28,5,108,orange);
  label('Project title','星邻计划',48,39,310,38,29,ink,true);
  label('Location subtitle','第一座家园 / 庭院拼装样区',48,82,310,26,18,muted);
  rect('Stage card',1210,28,362,62,paper);
  label('Stage label','美术试作 01 · 本地单人',1230,44,320,30,19,muted);
  rect('Construction card',28,720,354,252,paper);
  label('Panel title','给家园添一点新东西',48,735,314,32,22,ink,true);
  label('Selection','地板 · 2 米网格 · 0/8',48,775,310,27,17,muted);
  for(const [i,title] of ['1 地板','2 种植箱','3 储物箱'].entries())button(`Module ${i}`,title,48+i*105,815,99);
  button('Build button','开始建造  B',48,878,174,'Build label');
  button('Undo button','撤回',236,878,124);
  label('Pool hint','展示部件可自由放置和撤回',48,934,310,24,15,muted);
  rect('Actions card',1210,790,362,182,paper);
  button('Light button','查看夜间灯光  N',1230,808,322,'Light label');
  button('Place button','放置当前部件  Enter',1230,864,322);
  label('Navigation note','Home 回到全景',1230,927,320,24,16,muted);
  rect('Feedback card',416,906,760,66,paper);
  label('Message','欢迎来到你的星球。先看看这片家园。',434,913,724,26,18);
  label('Status','在家园中看看，或试着摆几个部件。',434,943,724,23,15,muted);
  label('Cursor readout','美术与拼装试验 · 本地单人',438,867,720,25,17,rgba(.98,.99,1));
  rect('Controls backing',416,28,760,44,rgba(.12,.22,.22,.85));
  label('Controls','WASD 移动  ·  Q/E 升降  ·  右键环视  ·  方向键移部件  ·  R 旋转',430,34,740,30,16,rgba(1,.98,.9));
}
