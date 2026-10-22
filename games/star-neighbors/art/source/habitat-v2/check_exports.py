"""Headless art QA: import every delivered GLB and rebuild its review assembly."""
from pathlib import Path
import bpy, json, math, struct, hashlib, argparse, sys
from mathutils import Vector, Matrix

parser=argparse.ArgumentParser()
parser.add_argument('--kit',default='habitat-v2')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
HERE=Path(__file__).resolve().parent.parent/args.kit
PROJECT=HERE.parents[2]
REVIEW=PROJECT/'art/reviews'/args.kit
manifest=json.loads((HERE/'asset-catalog.json').read_text(encoding='utf-8'))
catalog=manifest['assets']+manifest.get('dependencies',[])
layout=json.loads((HERE/'assembly.json').read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(HERE/(args.kit+'.blend')))
scene=bpy.context.scene
for collection in scene.collection.children:
    if collection.name.startswith('ASSEMBLY /'):collection.hide_render=True
imports=bpy.data.collections.new('QA / imported GLB library');scene.collection.children.link(imports)
assembled=bpy.data.collections.new('QA / imported GLB assembly');scene.collection.children.link(assembled)
results=[];cache={}
for entry in catalog:
    path=PROJECT/entry['glb'];raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<III',raw,0)
    assert magic==0x46546c67 and version==2 and length==len(raw),path
    jsonlength,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    doc=json.loads(raw[20:20+jsonlength])
    assert all('uri' not in x for x in doc.get('images',[])),path
    assert all('uri' not in x for x in doc.get('buffers',[])),path
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objs=list(set(bpy.data.objects)-before)
    meshes=[o for o in objs if o.type=='MESH']
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
    dims=[max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
    if 'sourceDimensionsXYZ' in entry:
        assert all(abs(a-b)<.002 for a,b in zip(dims,entry['sourceDimensionsXYZ'])),(path,dims,entry['sourceDimensionsXYZ'])
    triangles=0;zero_area=0
    for o in meshes:
        assert o.data.uv_layers,path
        assert all(math.isfinite(c) for v in o.data.vertices for c in v.co),path
        assert all(math.isfinite(c) for layer in o.data.uv_layers for uv in layer.data for c in uv.uv),path
        o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
        zero_area+=sum(t.area<1e-12 for t in o.data.loop_triangles)
    if 'triangles' in entry:assert triangles==entry['triangles'],(path,triangles,entry['triangles'])
    if 'drawMeshes' in entry:assert len(meshes)==entry['drawMeshes'],(path,len(meshes),entry['drawMeshes'])
    # Fonts contain tiny faces; reject genuinely collapsed triangles only.
    if any(m.get('name','').startswith('07 • smoked teal glass') for m in doc.get('materials',[])):
        assert 'KHR_materials_transmission' in doc.get('extensionsUsed',[]),path
    cache[entry['id']]=[(o,o.matrix_world.copy()) for o in meshes]
    for o in objs:
        for c in list(o.users_collection):c.objects.unlink(o)
        imports.objects.link(o);o.hide_render=True;o.hide_set(True)
    results.append({'asset':entry['id'],'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
        'meshes':len(meshes),'triangles':triangles,'collapsedTriangles':zero_area,'dimensionsZUp':[round(d,4) for d in dims],
        'embeddedImages':len(doc.get('images',[])),'uvFinite':True})
collapsed=[(r['asset'],r['collapsedTriangles']) for r in results if r['collapsedTriangles']]
assert not collapsed,collapsed
for item in layout:
    root=bpy.data.objects.new('QA / '+item['asset'],None);assembled.objects.link(root)
    root.location=item['positionZUp'];root.rotation_euler.z=math.radians(item['yawZ'])
    for original,local in cache[item['asset']]:
        o=original.copy();o.data=original.data;assembled.objects.link(o)
        o.parent=root;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_basis=local
        o.hide_render=False;o.hide_set(False)
scene.render.filepath=str(REVIEW/'04-export-roundtrip.png')
scene.cycles.samples=80
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
bpy.ops.render.render(write_still=True)
report={'status':'passed','scope':'Background Blender GLB import, geometry/UV/bounds checks and reassembled render; not engine acceptance',
        'blender':bpy.app.version_string,'assets':len(manifest['assets']),'dependencies':len(manifest.get('dependencies',[])),'assemblyInstances':len(layout),
        'trianglesUniqueKit':sum(x['triangles'] for x in results),'bytesGLB':sum(x['bytes'] for x in results),
        'results':results}
(REVIEW/'asset-check.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='results'}))
