"""Natural kit static art checks and offline review renders."""
from pathlib import Path
import bpy,json,math,os
from mathutils import Vector,Matrix
HERE=Path(__file__).resolve().parent;PROJECT=HERE.parents[2];REVIEW=PROJECT/'art/reviews/nature-v1'
bpy.ops.wm.open_mainfile(filepath=str(HERE/'nature-v1.blend'))
scene=bpy.context.scene;camera=scene.camera
assembly=next(c for c in scene.collection.children if c.name.startswith('ASSEMBLY /'))
library=scene.collection.children['LIBRARY / Independent modules'];assets={}
for coll in library.children:
    roots=[o for o in coll.objects if o.type=='EMPTY']
    if roots:assets[roots[0].get('module_id',roots[0].name)]=[o for o in coll.objects if o.type=='MESH']
catalog=json.loads((HERE/'asset-catalog.json').read_text(encoding='utf-8'));entries={e['id']:e for e in catalog['assets']}
layout=json.loads((HERE/'assembly.json').read_text(encoding='utf-8'));checks=[]
def check(name,ok,**data):
    assert ok,(name,data);checks.append({'check':name,'passed':True,**data})
def global_socket(item,name):
    return Vector(item['positionZUp'])+Matrix.Rotation(math.radians(item['yawZ']),4,'Z')@Vector(entries[item['asset']]['sourceSockets'][name])
for size in ['mature','young']:
    trunk=entries['tree-trunk-'+size]['sourceSockets'];crown=entries['tree-crown-'+size]['sourceSockets']
    check(size+' trunk and crown anchors',trunk==crown,matchingAnchors=len(trunk))
for name in ['terrain-meadow-4m','terrain-loam-4m']:
    points=[o.matrix_world@v.co for o in assets[name] for v in o.data.vertices]
    edge=[p for p in points if (abs(abs(p.x)-2)<1e-5 or abs(abs(p.y)-2)<1e-5) and p.z>-.10]
    check(name+' top boundary at common datum',bool(edge) and max(abs(p.z) for p in edge)<1e-6,edgeVertices=len(edge))
    check(name+' four metre footprint',abs(entries[name]['sourceDimensionsXYZ'][0]-4)<.001 and abs(entries[name]['sourceDimensionsXYZ'][1]-4)<.001)
tiles=[item for item in layout if item['zone']=='terrain'];pairs=0
for tile in tiles:
    for other in tiles:
        if abs(tile['positionZUp'][1]-other['positionZUp'][1])<.001 and abs(other['positionZUp'][0]-tile['positionZUp'][0]-4)<.001:
            check('Terrain east/west joint '+str(pairs),(global_socket(tile,'east')-global_socket(other,'west')).length<1e-6);pairs+=1
        if abs(tile['positionZUp'][0]-other['positionZUp'][0])<.001 and abs(other['positionZUp'][1]-tile['positionZUp'][1]-4)<.001:
            check('Terrain north/south joint '+str(pairs),(global_socket(tile,'north')-global_socket(other,'south')).length<1e-6);pairs+=1

paths=[item for item in layout if item['zone']=='path'];connections=0;open_ends=[]
for name in ['path-straight-2m','path-turn-2m','path-junction-2m']:
    points=[o.matrix_world@v.co for o in assets[name] for v in o.data.vertices]
    check(name+' edge returns to terrain datum',abs(min(p.z for p in points))<1e-6)
for i,item in enumerate(paths):
    for key in entries[item['asset']]['sourceSockets']:
        point=global_socket(item,key)
        partners=[(j,k) for j,other in enumerate(paths) if j!=i for k in entries[other['asset']]['sourceSockets'] if (point-global_socket(other,k)).length<.0001]
        if partners:connections+=1
        else:open_ends.append([round(v,4) for v in point])
check('Connected straight, turn and T path joints',connections==18,joints=connections//2)
check('Intentional open path ends',len(open_ends)==4,positions=open_ends)
check('All landscape instances at true scale',all(all(abs(v-1)<1e-6 for v in o.scale) for o in assembly.objects if o.type=='EMPTY'))
check('Eight complete trees',sum(i['zone']=='tree-trunk' for i in layout)==8 and sum(i['zone']=='tree-crown' for i in layout)==8)
for item in [i for i in layout if i['zone']=='tree-trunk']:
    counterpart=item['asset'].replace('trunk','crown')
    check('Crown on matching tree '+str(item['positionZUp']),any(i['asset']==counterpart and i['positionZUp']==item['positionZUp'] and i['yawZ']==item['yawZ'] for i in layout))

# Check the center of the walking lanes against low foliage mesh bounds. Tree
# canopies are excluded: they overhang above people rather than block the ground.
rects=[(-5.9,8.0,-11.5,-10.5),(4.5,5.5,-10.0,-8.1),(8.5,9.5,-10.,-8.1)]
bpy.context.view_layer.update()
for n,rect in enumerate(rects):
    x0,x1,y0,y1=rect;blockers=[]
    for root in assembly.objects:
        if root.type!='EMPTY' or root.get('zone') not in ['understory','botanical-detail','rock']:continue
        pts=[o.matrix_world@v.co for o in root.children for v in o.data.vertices]
        if min(p.x for p in pts)<x1 and max(p.x for p in pts)>x0 and min(p.y for p in pts)<y1 and max(p.y for p in pts)>y0:blockers.append(root.name)
    check('Low foliage outside walking lane '+str(n),not blockers,rectangleXYMetres=rect,blockers=blockers)

try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.cycles.samples=72
def camera_at(p,target,lens=48):
    camera.data.type='PERSP';camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
def render(name,w=2200,h=1500):
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.filepath=str(REVIEW/name)
    if os.environ.get('NATURE_CHECKS_ONLY')!='1':bpy.ops.render.render(write_still=True)

camera_at((28,-37,26),(1,-1.5,1),49);render('01-landscaped-home.png',2400,1800)
camera_at((5,-20,6.8),(-.5,-6.5,1.2),46);render('02-garden-arrival.png')
camera_at((11.1,-13.3,3.1),(7.7,-9.6,.35),55);render('05-botanical-detail.png',1920,1440)

assembly.hide_render=True;board=scene.collection.children['REVIEW / natural parts'];board.hide_render=False
ground=bpy.data.objects['Studio backdrop'];sun=bpy.data.objects['Late afternoon sun'];boardlight=bpy.data.objects['Natural catalog fill']
ground.hide_render=True;sun.hide_render=True;boardlight.hide_render=False
camera_at((0,-40,0),(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=24.5
render('03-nature-modules.png',2800,1850)
board.hide_render=True;ground.hide_render=False;sun.hide_render=False;boardlight.hide_render=True

# Tree source anatomy and a 1.78 m adult reference, all at scale one.
study=bpy.data.collections.new('REVIEW / tree assembly');scene.collection.children.link(study);records=[]
def place(name,p):
    root=bpy.data.objects.new(name+' study',None);study.objects.link(root);root.location=p
    for original in assets[name]:
        o=original.copy();o.data=original.data;study.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    records.append({'asset':name,'positionZUp':list(p),'yawZ':0})
for name,p in [('tree-trunk-mature',(-5.5,0,0)),('tree-crown-mature',(-5.5,0,0)),
    ('tree-trunk-mature',(0,0,0)),('tree-crown-mature',(3.4,0,0)),
    ('tree-trunk-young',(7.7,0,0)),('tree-crown-young',(7.7,0,0))]:place(name,p)
def label(body,p):
    cu=bpy.data.curves.new(body,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=.19;cu.extrude=.0005
    o=bpy.data.objects.new(body,cu);study.objects.link(o);o.location=p;cu.materials.append(bpy.data.materials['11 • dark graphic'])
for text,x in [('MATURE / ASSEMBLED',-5.5),('TRUNK',0),('SEPARATE CROWN',3.4),('YOUNG / ASSEMBLED',7.7)]:label(text,(x,-2.3,-.15))
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(PROJECT/'assets/models/scale-mannequin.glb'))
added=list(set(bpy.data.objects)-before);meshes=[o for o in added if o.type=='MESH'];bpy.context.view_layer.update()
points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices];lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
check('Adult height reference',abs(hi.z-lo.z-1.78)<.01,metres=round(hi.z-lo.z,3))
delta=Vector((-8,-.7,-.16))-Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for o in meshes:
    transform=o.matrix_world.copy();transform.translation+=delta
    for c in list(o.users_collection):c.objects.unlink(o)
    study.objects.link(o);o.parent=None;o.matrix_world=transform
for o in added:
    if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
label('1.78 M',(-8,-1.5,-.15))
# Study plants sit on their source root datum; raise the floor from -0.16 to 0.
ground.location.z+=.16
for o in study.objects:
    if o.type=='FONT':o.location.z=.006
for o in meshes:o.location.z+=.16
camera_at((15,-25,15),(1,0,2.2),49);render('06-tree-assembly.png',2400,1500)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'tree-studies.blend'))
(HERE/'tree-studies.json').write_text(json.dumps({'units':'metres','sourceUp':'Z','instances':records,'mannequinReference':'assets/models/scale-mannequin.glb'},indent=2)+'\n',encoding='utf-8')
report={'status':'passed','scope':'Static art module sockets, scale, terrain edges and low foliage layout; no collision, wind or terrain-system acceptance.',
    'newAssets':len(entries),'assemblyInstances':len(layout),'terrainTiles':len(tiles),'terrainJointPairs':pairs,
    'assembledTriangles':sum(next(a['triangles'] for a in catalog['assets']+catalog['dependencies'] if a['id']==item['asset']) for item in layout),
    'checks':checks}
(REVIEW/'assembly-check.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='checks'}))
