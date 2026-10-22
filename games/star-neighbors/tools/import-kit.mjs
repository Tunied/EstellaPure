import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.resolve(root,'../..');
const read=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
const write=(p,v)=>writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const catalog=read('art/source/asset-catalog.json');
mkdirSync(path.join(root,'assets/materials'),{recursive:true});
for(const asset of catalog) {
  const out=path.join(root,'assets/models',asset.id);mkdirSync(out,{recursive:true});
  const result=spawnSync(process.execPath,[path.join(repo,'pipeline/bin/estella.mjs'),'import-model',path.join(root,asset.glb),out,'--project',root],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error(result.stderr+result.stdout);
  const prefabPath=`assets/models/${asset.id}/${asset.id}.esprefab`;
  const prefab=read(prefabPath), importedMaterials=new Set();
  for(const entity of prefab.entities) {
    const mr=entity.components.find(c=>c.type==='MeshRenderer')?.data;
    if(!mr)continue;
    const paletteId=entity.name.split('__')[1];
    if(!paletteId)throw new Error(`Missing semantic material name: ${entity.name}`);
    const material=read(mr.material);importedMaterials.add(mr.material);
    mr.material=`assets/materials/${paletteId}.esmaterial`;
    write(mr.material,material);
    mr.cullBackfaces=false;
  }
  write(prefabPath,prefab);
  // Only remove the importer outputs just consumed; preserve meshes and stable metas.
  for(const file of importedMaterials){
    unlinkSync(path.join(root,file));
    if(existsSync(path.join(root,file+'.meta')))unlinkSync(path.join(root,file+'.meta'));
  }
  console.log(`${asset.id}: ${asset.triangles} triangles, ${asset.materialSlots} shared materials`);
}
