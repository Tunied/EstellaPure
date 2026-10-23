"""Additional art reviews, passage recipes and geometric interface checks."""
from pathlib import Path
import bpy,json,math
from mathutils import Vector,Matrix
HERE=Path(__file__).resolve().parent;PROJECT=HERE.parents[2];REVIEW=PROJECT/'art/reviews/connections-v1'
bpy.ops.wm.open_mainfile(filepath=str(HERE/'connections-v1.blend'))
scene=bpy.context.scene;camera=scene.camera
assembly=next(c for c in scene.collection.children if c.name.startswith('ASSEMBLY /'))
library=scene.collection.children['LIBRARY / Independent modules']
assets={}
for coll in library.children:
    roots=[o for o in coll.objects if o.type=='EMPTY']
    if roots:assets[roots[0].get('module_id',roots[0].name)]=[o for o in coll.objects if o.type=='MESH']
layout=json.loads((HERE/'assembly.json').read_text(encoding='utf-8'))
catalog=json.loads((HERE/'asset-catalog.json').read_text(encoding='utf-8'))
records=[]
recipes=bpy.data.collections.new('REVIEW / passage recipes');scene.collection.children.link(recipes)
def place(name,p,a=0,zone='',record=True):
    root=bpy.data.objects.new(zone+' / '+name,None);recipes.objects.link(root);root.location=p;root.rotation_euler.z=math.radians(a)
    root['asset']=name;root['recipe']=zone
    for original in assets[name]:
        o=original.copy();o.data=original.data;recipes.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:records.append({'recipe':zone,'asset':name,'positionZUp':list(p),'yawZ':a})
    return root
def label(body,x,y):
    cu=bpy.data.curves.new(body,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=.28;cu.extrude=.001
    o=bpy.data.objects.new(body,cu);recipes.objects.link(o);o.location=(x,y,.005)
    cu.materials.append(bpy.data.materials['11 • dark graphic'])
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.cycles.samples=72

# Three independent 2 m-grid recipes. The roof is deliberately hidden for this
# review, but present as actual independent instances in the saved study.
definitions=[
    {'id':'straight','offset':[-7,0],'cells':[(0,0),(0,2)],'open':[(0,0,'S'),(0,2,'N')]},
    {'id':'elbow','offset':[-1,0],'cells':[(0,0),(0,2),(2,2)],'open':[(0,0,'S'),(2,2,'E')]},
    {'id':'tee','offset':[7,0],'cells':[(-2,0),(0,0),(2,0),(0,2)],'open':[(-2,0,'W'),(2,0,'E'),(0,2,'N')]}
]
roof_children=[]
for definition in definitions:
    ox,oy=definition['offset'];name=definition['id'];cells=set(definition['cells']);ends=set(definition['open']);corners=set()
    for x,y in sorted(cells):
        place('habitat/floor-2m',(ox+x,oy+y,0),zone=name)
        root=place('corridor-roof-2m',(ox+x,oy+y,3.01),zone=name)
        roof_children.extend(root.children)
        for side,dx,dy,yaw in [('S',0,-1,0),('N',0,1,180),('W',-1,0,270),('E',1,0,90)]:
            if (x+2*dx,y+2*dy) in cells:continue
            module='junction-frame-2m' if (x,y,side) in ends else 'corridor-wall-glass-2m'
            place(module,(ox+x+dx,oy+y+dy,.21),yaw,name)
            for sign in [-1,1]:corners.add((x+dx+sign*dy,y+dy+sign*dx))
    for x,y in sorted(corners):place('junction-post',(ox+x,oy+y,.21),zone=name)
    label({'straight':'STRAIGHT / SAME 2 M PARTS','elbow':'TURN / SAME 2 M PARTS','tee':'T JUNCTION / SAME 2 M PARTS'}[name],ox,-2.35)
for o in roof_children:o.hide_render=True
assembly.hide_render=True
camera_at((14,-24,30),(1,.6,0),52)
scene.render.resolution_x=2200;scene.render.resolution_y=1350
scene.render.filepath=str(REVIEW/'05-passage-recipes.png');bpy.ops.render.render(write_still=True)
(HERE/'passage-recipes.json').write_text(json.dumps({'sourceUp':'Z','definitions':definitions,'instances':records},indent=2)+'\n',encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'passage-studies.blend'))
recipes.hide_render=True;recipes.hide_viewport=True;assembly.hide_render=False

# Geometry checks record attachment distances and the unobstructed plant bay.
entries={e['id']:e for e in catalog['assets']+catalog['dependencies']}
by_id={}
for item in layout:by_id.setdefault(item['asset'],[]).append(item)
def socket(item,name):
    local=Vector(entries[item['asset']]['sourceSockets'][name]);yaw=math.radians(item['yawZ'])
    return Matrix.Rotation(yaw,4,'Z')@local+Vector(item['positionZUp'])
checks=[]
def same_point(name,a,b,tolerance=.002):
    gap=(Vector(a)-Vector(b)).length
    assert gap<tolerance,(name,gap)
    checks.append({'check':name,'gapMetres':round(gap,7),'passed':True})
corner=by_id['wall-inner-corner-2m'][0]
front=next(i for i in by_id['habitat/wall-corner-r050'] if i['positionZUp'][:2]==[2,0])
side=next(i for i in by_id['habitat/wall-window-2m'] if i['positionZUp'][:2]==[.5,3])
same_point('Inner wall to outward corner',socket(corner,'front'),socket(front,'side'))
same_point('Inner wall to straight window wall',socket(corner,'side'),socket(side,'left'))
for name,z in [('foundation-inner-corner-2m',.6),('wall-inner-corner-2m',.81),('roof-inner-corner-2m',3.61)]:
    same_point(name+' grid origin',by_id[name][0]['positionZUp'],[0,0,z])
ramps=sorted(by_id['terrace-ramp-2m'],key=lambda i:i['positionZUp'][2])
same_point('Ramp section joint',socket(ramps[0],'upper'),socket(ramps[1],'lower'))
same_point('Ramp upper to deck surface',socket(ramps[1],'upper'),[2,-7.5,.81])
same_point('Ramp lower to ground datum',socket(ramps[0],'lower'),[6,-7.5,0])
stairs=next(i for i in by_id['terrace-stair-081'] if i['positionZUp'][0]==-3)
same_point('Stair to deck surface',socket(stairs,'landing'),[-3,-8.5,.81])
link=next(i for i in by_id['junction-frame-2m'] if i['positionZUp'][0]==6.5)
same_point('Garden link installation datum',link['positionZUp'],[6.5,-1,.81])
west_beds=[i for i in by_id['garden/growing-bed-2m'] if i['positionZUp'][0]<8.5]
for item in west_beds:
    centre=item['positionZUp'][1]
    assert centre+.95<=-1.8+.001 or centre-.95>=-.2-.001,('Blocked garden link',item)
checks.append({'check':'Garden side doorway kept clear of west beds','clearIntervalYMetres':[-1.8,-.2],'passed':True})
assert all(all(abs(s-1)<1e-6 for s in o.scale) for o in assembly.objects if o.type=='EMPTY')
checks.append({'check':'Assembly module scales all 1','passed':True})
report={'status':'passed','scope':'Source attachment geometry and art layout; no movement or structural simulation',
    'assets':len(catalog['assets']),'dependencies':len(catalog['dependencies']),'assemblyInstances':len(layout),
    'newModules':20,'homeCentralFloorSquareMetres':56,'terraceMetres':[8,4],
    'floorDatumMetres':.81,'corridorLengthMetres':4,'corridorNominalWidthMetres':2,
    'junctionClearStraightWidthMetres':1.60,'stairRiseMetres':.81,'rampRunMetres':4,'checks':checks}
(REVIEW/'interface-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

# Separate close views show the concave wall and the greenhouse hood clearly.
camera_at((9,10,10),(2.0,.6,2.5),52)
scene.render.resolution_x=1920;scene.render.resolution_y=1440
scene.render.filepath=str(REVIEW/'06-corner-and-dock.png');bpy.ops.render.render(write_still=True)
camera_at((5,-15,5),(-1.0,-6.6,1.0),48)
scene.render.filepath=str(REVIEW/'07-terrace-detail.png');bpy.ops.render.render(write_still=True)
camera_at((4.7,4.3,7.3),(6.7,-.7,3.2),53)
scene.render.filepath=str(REVIEW/'08-garden-connection.png');bpy.ops.render.render(write_still=True)
print(json.dumps(report))
