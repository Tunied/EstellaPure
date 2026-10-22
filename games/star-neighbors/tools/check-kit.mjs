import assert from 'node:assert/strict';
import { readFileSync,existsSync,readdirSync,statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
const catalog=read('art/source/asset-catalog.json');
const names=new Set(catalog.map(a=>a.id));assert.equal(names.size,catalog.length);
const ids=new Set();let meshes=0;
for(const asset of catalog){
  assert.ok(existsSync(path.join(root,asset.glb)));
  const p=read(`assets/models/${asset.id}/${asset.id}.esprefab`);
  const roots=p.entities.filter(e=>e.parent===null);assert.equal(roots.length,1);
  assert.ok(!roots[0].components.find(c=>c.type==='Transform').data.position,'Reusable prefab root must stay at origin');
  for(const e of p.entities)for(const c of e.components)if(c.type==='MeshRenderer'){
    assert.ok(c.data.material.startsWith('assets/materials/'));
    assert.ok(existsSync(path.join(root,c.data.mesh)));assert.ok(existsSync(path.join(root,c.data.material)));meshes++;
  }
}
for(const item of read('art/source/sample-layout.json'))assert.ok(names.has(item.asset));
const scene=read('assets/scenes/art-sample.esscene');
for(const e of scene.entities){assert.ok(!ids.has(e.id));ids.add(e.id);}
for(const e of scene.entities){
  if(e.parent!==null)assert.ok(scene.entities.find(p=>p.id===e.parent).children.includes(e.id));
  for(const c of e.components)for(const key of ['mesh','material','environment']){
    const value=c.data[key];if(typeof value==='string'&&value.startsWith('assets/'))assert.ok(existsSync(path.join(root,value)),value);
  }
}
const metas=new Set();let assetBytes=0;
function walk(dir){for(const name of readdirSync(dir)){const f=path.join(dir,name);if(statSync(f).isDirectory())walk(f);else if(name.endsWith('.meta')){
  const meta=JSON.parse(readFileSync(f,'utf8'));assert.ok(existsSync(f.slice(0,-5)),`Orphan meta: ${f}`);assert.ok(!metas.has(meta.uuid));metas.add(meta.uuid);
}else assetBytes+=statSync(f).size;}}
walk(path.join(root,'assets'));
console.log(JSON.stringify({assets:catalog.length,meshes,sharedMaterials:readdirSync(path.join(root,'assets/materials')).filter(f=>f.endsWith('.esmaterial')).length,instances:read('art/source/sample-layout.json').length,entities:scene.entities.length,assetBytes,stableAssetIds:metas.size},null,2));
