export const rgba=(r,g,b,a=1)=>({r,g,b,a});
export const vec=([x,y,z])=>({x,y,z});
export const component=(type,data)=>({type,data});
export const rotation=(yaw,pitch=0)=>({x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)});
export const transform=(p=[0,0,0],extra={})=>component('Transform',{position:vec(p),...extra});
export function createScene() {
  const entities=[];
  const add=(name,components,parent=null)=>{
    const id=entities.length;entities.push({id,name,parent,children:[],visible:true,components});
    if(parent!==null)entities[parent].children.push(id);return id;
  };
  function instance(prefab,name,p=[0,0,0],yaw=0,scale=1,enabled=true) {
    const ids=new Map();
    for(const e of prefab.entities){
      const root=e.parent===null,comps=structuredClone(e.components);
      if(root)Object.assign(comps.find(c=>c.type==='Transform').data,{position:vec(p),rotation:rotation(yaw),scale:vec([scale,scale,scale])});
      const mr=comps.find(c=>c.type==='MeshRenderer');if(mr)mr.data.enabled=enabled;
      const suffix=e.name.includes('__')?'__'+e.name.split('__')[1]:':'+e.name;
      ids.set(e.prefabEntityId,add(root?name:name+suffix,comps,root?null:ids.get(e.parent)));
    }
  }
  return {entities,add,instance};
}
