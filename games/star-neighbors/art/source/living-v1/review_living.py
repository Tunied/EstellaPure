"""Static modular assembly, dimensions and placement reviews; no engine code."""
from pathlib import Path
import bpy,json,math
from mathutils import Vector,Matrix
HERE=Path(__file__).resolve().parent;PROJECT=HERE.parents[2];REVIEW=PROJECT/'art/reviews/living-v1'
bpy.ops.wm.open_mainfile(filepath=str(HERE/'living-v1.blend'))
scene=bpy.context.scene;camera=scene.camera
assembly=next(c for c in scene.collection.children if c.name.startswith('ASSEMBLY /'))
library=scene.collection.children['LIBRARY / Independent modules']
assets={}
for coll in library.children:
    roots=[o for o in coll.objects if o.type=='EMPTY']
    if roots:assets[roots[0].get('module_id',roots[0].name)]=[o for o in coll.objects if o.type=='MESH']
catalog=json.loads((HERE/'asset-catalog.json').read_text(encoding='utf-8'))
entries={e['id']:e for e in catalog['assets']}
layout=json.loads((HERE/'assembly.json').read_text(encoding='utf-8'))
checks=[]
def check(name,condition,**data):
    assert condition,(name,data)
    checks.append({'check':name,'passed':True,**data})
def socket(name,key):return entries[name]['sourceSockets'][key]
def bounds(name):return entries[name]['sourceBoundsXYZ']
def nearly(a,b):return abs(a-b)<.002
chair=socket('dining-chair','seat')[2];table=socket('dining-table-180','top')[2]
check('Chair seat height',.46<=chair<=.49,metres=chair)
check('Table working height',.73<=table<=.77,metres=table)
check('Table to chair height difference',.26<=table-chair<=.31,metres=round(table-chair,3))
check('Actual chair top bound',nearly(bounds('dining-chair')['max'][2],.854),metres=bounds('dining-chair')['max'][2])
check('Mattress adult length and width',nearly(entries['mattress-160']['sourceDimensionsXYZ'][1],2.) and nearly(entries['mattress-160']['sourceDimensionsXYZ'][0],1.6),metres=[1.6,2.])
check('Bed platform joins mattress bottom',nearly(socket('bed-frame-160','mattress')[2],.30),metres=.30)
check('Kitchen working surface',nearly(socket('cabinet-frame-100','top')[2]+socket('kitchen-counter-100','counter')[2],.9),metres=.9)
check('Sink counter matches worktop',nearly(socket('kitchen-sink-top-100','counter')[2],socket('kitchen-counter-100','counter')[2]))
check('Sofa repeated seat pitch',nearly(socket('sofa-seat-090','right')[0]-socket('sofa-seat-090','left')[0],.9),metres=.9)
check('Shelf bay matches board span',nearly(socket('shelf-board-090','right')[0]-socket('shelf-board-090','left')[0],.9),metres=.9)
check('Gift lid installation',nearly(socket('gift-box-040','lid')[2],bounds('gift-box-040')['max'][2]),metres=.325)
check('Gift lid clears box and wrapping',all(socket('gift-lid-040','inner-opening-half')[i]>bounds('gift-box-040')['max'][i]+.001 for i in [0,1]),minimumSideClearanceMetres=.002)
check('All scene modules at true scale',all(all(abs(s-1)<1e-6 for s in o.scale) for o in assembly.objects if o.type=='EMPTY'))

# Furniture-only XY envelopes, excluding soft rugs and all architecture. This
# checks visual arrangement, not collisions or navigation in the user's program.
bpy.context.view_layer.update()
envelopes=[]
for root in assembly.objects:
    if root.type!='EMPTY' or root.get('zone')=='architecture' or root.get('asset')=='woven-rug-240':continue
    points=[o.matrix_world@v.co for o in root.children if o.type=='MESH' for v in o.data.vertices]
    if points:envelopes.append((root.name,tuple(min(p[i] for p in points) for i in range(3)),tuple(max(p[i] for p in points) for i in range(3))))
for title,rect in [('Entry to interior clear route',(-3.5,-2.5,-8.35,0)),('Ramp arrival clear route',(.4,2.,-8.2,-7.1))]:
    x0,x1,y0,y1=rect
    blockers=[name for name,lo,hi in envelopes if lo[0]<x1 and hi[0]>x0 and lo[1]<y1 and hi[1]>y0]
    check(title,not blockers,rectangleXYMetres=list(rect),blockers=blockers)

for root in assembly.objects:
    if root.type!='EMPTY' or root.get('zone')!='shelving' or root.get('asset') in ['shelf-board-090','shelf-upright-180']:continue
    points=[o.matrix_world@v.co for o in root.children if o.type=='MESH' for v in o.data.vertices]
    bottom=min(p.z for p in points);top=max(p.z for p in points)
    overhead=[item['positionZUp'][2] for item in layout if item['asset']=='shelf-board-090' and abs(item['positionZUp'][0]-root.location.x)<.01 and item['positionZUp'][2]>bottom+.03]
    check('Shelf content clears next board / '+root.name,not overhead or top<=min(overhead)-.005,topMetres=round(top,4),nextBoardMetres=round(min(overhead),4) if overhead else None)

# Same-scale studies with independently positionable doors, drawer and gift lid.
assembly.hide_render=True
study=bpy.data.collections.new('REVIEW / modular furniture studies');scene.collection.children.link(study)
records=[]
def place(name,p,a=0,group=''):
    root=bpy.data.objects.new(group+' / '+name,None);study.objects.link(root)
    root.location=p;root.rotation_euler.z=math.radians(a)
    for original in assets[name]:
        o=original.copy();o.data=original.data;study.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    records.append({'group':group,'asset':name,'positionZUp':list(p),'yawZ':a})
    return root
def label(body,p,size=.16):
    cu=bpy.data.curves.new(body,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=size;cu.extrude=.0005
    o=bpy.data.objects.new(body,cu);study.objects.link(o);o.location=p
    cu.materials.append(bpy.data.materials['11 • dark graphic'])
def sofa(cx,cy,count):
    for i in range(count):place('sofa-seat-090',(cx+(i-(count-1)/2)*.9,cy,0),group='repeatable sofa')
    for x in [-count*.45-.075,count*.45+.075]:place('sofa-arm',(cx+x,cy,0),group='independent arm')

place('dining-table-180',(-4.8,2.3,0),group='adult table and chairs')
for x in [-5.3,-4.3]:
    for y,a in [(1.45,180),(3.15,0)]:place('dining-chair',(x,y,0),a,'adult table and chairs')
label('SEAT 0.48 M / TABLE 0.76 M',(-4.8,.7,.005))

place('bed-frame-160',(-.5,2.3,0),group='bed layers')
place('mattress-160',(-.5,2.3,.30),group='bed layers')
place('bed-quilt-160',(-.5,2.3,.40),group='bed layers')
for x in [-.9,-.1]:place('bed-pillow',(x,3.01,.50),group='bed layers')
label('1.60 x 2.00 M / 4 SEPARATE PART TYPES',(-.5,.7,.005),.14)

for x in [2.6,3.5,4.4]:place('shelf-upright-180',(x,2.4,0),group='two shelf bays')
for x in [3.05,3.95]:
    for z in [.2675,.6675,1.0675,1.4675]:place('shelf-board-090',(x,2.4,z),group='two shelf bays')
    place('storage-basket-040',(x,2.4,.7075),group='two shelf bays')
label('0.90 M BAY / SHARED UPRIGHT',(3.5,1.2,.005))

for x in [-5.3,-4.05]:
    place('cabinet-frame-100',(x,-1.75,0),group='cabinet variants')
    place('kitchen-counter-100',(x,-1.75,.86),group='cabinet variants')
# Left cabinet: closed left leaf, open right leaf with an explicit hinge pivot.
place('cabinet-door-050',(-5.55,-2.077,.18),group='cabinet variants')
hinge=Vector((-4.8125,-2.077,.5025));angle=math.radians(65)
local_hinge=Vector(socket('cabinet-door-050','right-hinge'))
origin=hinge-Matrix.Rotation(angle,4,'Z')@local_hinge
place('cabinet-door-050',origin,65,'cabinet open leaf')
place('cabinet-drawer-100',(-4.05,-2.285,.63),group='cabinet open drawer')
label('SAME CARCASS / DOORS OR DRAWER',(-4.7,-2.9,.005),.14)
check('Door hinge preserved in open study',(origin+Matrix.Rotation(angle,4,'Z')@local_hinge-hinge).length<1e-6)

sofa(-.8,-1.8,1);sofa(1.25,-1.8,2)
label('0.90 M SEATS / SEPARATE ARMS',(.4,-2.9,.005),.14)
place('gift-box-040',(4.0,-1.9,0),group='gift separated lid')
place('gift-lid-040',(4.0,-1.9,.60),group='gift separated lid')
place('outdoor-lantern-160',(5.0,-1.8,0),group='social props')
place('wayfinding-post',(3.0,-1.8,0),group='social props')
place('wayfinding-panel',(3.0,-1.87,1.28),group='social props')
label('REMOVABLE LID / REPLACEABLE SIGN',(4.0,-2.9,.005),.14)

# Existing grey scale mannequin: review reference only, not a new character.
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'assets/models/scale-mannequin.glb'))
added=list(set(bpy.data.objects)-before);meshes=[o for o in added if o.type=='MESH']
bpy.context.view_layer.update();points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
height=hi.z-lo.z;check('Existing adult mannequin height',abs(height-1.78)<.03,metres=round(height,4))
delta=Vector((-6.4,2.3,0))-Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for o in meshes:
    transform=o.matrix_world.copy();transform.translation+=delta
    for c in list(o.users_collection):c.objects.unlink(o)
    study.objects.link(o);o.parent=None;o.matrix_world=transform
for o in added:
    if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
label('1.78 M',(-6.4,1.5,.005),.13)
report={'status':'passed','scope':'Art geometry, static furniture layout and dimensions only. No collision, animation or gameplay acceptance.',
    'assets':len(entries),'assemblyInstances':len(layout),'checks':checks}
(REVIEW/'scale-and-fit-check.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'modular-studies.json').write_text(json.dumps({'sourceUp':'Z','units':'metres','instances':records,
    'mannequinReference':'assets/models/scale-mannequin.glb','note':'Floating gift lid and open door/drawer are static art demonstrations, not animation clips.'},indent=2)+'\n',encoding='utf-8')
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.cycles.samples=80
camera.location=(10,-17,16);camera.rotation_euler=(Vector((-.7,.2,.4))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=48
scene.render.resolution_x=2400;scene.render.resolution_y=1600
scene.render.filepath=str(REVIEW/'06-modularity-and-scale.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'modular-studies.blend'))
bpy.ops.render.render(write_still=True)
print(json.dumps(report))
