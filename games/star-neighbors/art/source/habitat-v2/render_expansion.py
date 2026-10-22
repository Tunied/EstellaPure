"""Art-only assembly examples and an unmodified 1.78 m scale mannequin."""
from pathlib import Path
import bpy, json, math
from mathutils import Vector, Matrix
HERE=Path(__file__).resolve().parent;PROJECT=HERE.parents[2];REVIEW=PROJECT/'art/reviews/habitat-v2'
bpy.ops.wm.open_mainfile(filepath=str(HERE/'habitat-v2.blend'))
scene=bpy.context.scene;camera=scene.camera
original=scene.collection.children['ASSEMBLY / 7 x 5 metre home'];original.hide_render=True
library=scene.collection.children['LIBRARY / Independent modules']
assets={c.name.removeprefix('MODULE / '):[o for o in c.objects if o.type=='MESH'] for c in library.children}
coll=bpy.data.collections.new('EXPANSION / 7 x 5 and 13 x 9');scene.collection.children.link(coll)
records=[]
def place(name,p,angle=0,zone='large'):
    root=bpy.data.objects.new(zone+' / '+name,None);coll.objects.link(root);root.location=p;root.rotation_euler.z=math.radians(angle)
    root['module_id']=name;root['zone']=zone
    for original in assets[name]:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    records.append({'zone':zone,'asset':name,'positionZUp':p,'yawZ':angle})
    return root
def room(nx,ny,offset,zone):
    ox,oy=offset;xs=[2*i-(nx-1) for i in range(nx)];ys=[2*i-(ny-1) for i in range(ny)]
    wx=nx+.5;wy=ny+.5
    for x in xs:
        for y in ys:
            place('floor-2m',(ox+x,oy+y,0),zone=zone)
            place('roof-center-2m',(ox+x,oy+y,3.01),zone=zone)
        for y,a in [(-wy,0),(wy,180)]:
            for asset,z in [('foundation-edge-2m',0),('roof-edge-2m',3.01)]:place(asset,(ox+x,oy+y,z),a,zone)
        place('wall-solid-2m',(ox+x,oy+wy,.21),180,zone)
    for i,x in enumerate(xs):
        if i==len(xs)-1:
            place('wall-doorway-2m',(ox+x,oy-wy,.21),zone=zone)
            place('door-leaf-110',(ox+x,oy-wy,.21),zone=zone)
            place('entry-step-2m',(ox+x,oy-wy-.03,0),zone=zone)
        else:place('wall-window-2m',(ox+x,oy-wy,.21),zone=zone)
    for x,a in [(-wx,270),(wx,90)]:
        for y in ys:
            place('foundation-edge-2m',(ox+x,oy+y,0),a,zone)
            place('wall-window-2m',(ox+x,oy+y,.21),a,zone)
            place('roof-edge-2m',(ox+x,oy+y,3.01),a,zone)
    for x,y,a in [(nx,-ny,0),(nx,ny,90),(-nx,ny,180),(-nx,-ny,270)]:
        for asset,z in [('foundation-corner-r050',0),('wall-corner-r050',.21),('roof-corner-r050',3.01)]:place(asset,(ox+x,oy+y,z),a,zone)
    for x in xs[::2]:place('roof-vent',(ox+x,oy+ny-.9,3.51),zone=zone)
    for x in xs[::2]:place('interior-bench-2m',(ox+x,oy+ny-.2,.21),zone=zone)
    if nx>3:
        for x in [-2,2]:place('support-column-2p8',(ox+x,oy,.21),zone=zone)
        for x in xs:place('ceiling-beam-2m',(ox+x,oy,3.01),zone=zone)
        place('ceiling-beam-end-050',(ox+nx+.25,oy,3.01),zone=zone)
        place('ceiling-beam-end-050',(ox-nx-.25,oy,3.01),180,zone)
    return (ox+xs[-1],oy-wy)
small_door=room(3,2,(-9,-3),'small')
large_door=room(6,4,(4,1),'large')
(HERE/'expansion-layout.json').write_text(json.dumps({'sourceUp':'Z','rooms':[{'zone':'small','centralFloorMetres':[6,4],'outerMetres':[7,5]},
    {'zone':'large','centralFloorMetres':[12,8],'outerMetres':[13,9]}],'instances':records},indent=2)+'\n',encoding='utf-8')

# Scale-only body from the existing CC0 MakeHuman reference; no character redesign.
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'assets/models/scale-mannequin.glb'))
bpy.context.view_layer.update();added=list(set(bpy.data.objects)-before)
body=[(o,o.matrix_world.copy()) for o in added if o.type=='MESH']
reference=bpy.data.collections.new('SCALE / existing reference only');scene.collection.children.link(reference)
for o in added:
    for c in list(o.users_collection):c.objects.unlink(o)
    reference.objects.link(o);o.hide_render=True;o.hide_set(True)
def mannequin(p,name):
    root=bpy.data.objects.new(name,None);coll.objects.link(root);root.location=p
    for o,matrix in body:
        copy=o.copy();copy.data=o.data;coll.objects.link(copy);copy.parent=root
        copy.matrix_parent_inverse=Matrix.Identity(4);copy.matrix_basis=matrix;copy.hide_render=False;copy.hide_set(False)
    return root
for label,(x,y) in [('small',small_door),('large',large_door)]:mannequin((x,y-.46,.25),label+' / 1.78 m reference')
def text(body,p,size=.32):
    data=bpy.data.curves.new(body,'FONT');data.body=body;data.align_x='CENTER';data.size=size;data.extrude=.001
    o=bpy.data.objects.new(body,data);coll.objects.link(o);o.location=p
    data.materials.append(bpy.data.materials['11 • dark graphic'])
text('7 x 5 M / SAME MODULES',(-9,-7,0.005))
text('13 x 9 M / SAME MODULES',(4,-5,0.005))
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
def light(name,p,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=size;data.shape='DISK'
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=p
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
light('Expansion fill',(-7,-9,12),2500,11)
light('Expansion rim',(4,9,14),3200,9)
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.cycles.samples=80
scene.render.resolution_x=2200;scene.render.resolution_y=1350
camera_at((21,-31,24),(-1,-.4,1.2),48)
scene.render.filepath=str(REVIEW/'05-room-expansion.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'habitat-expansion.blend'))
bpy.ops.render.render(write_still=True)

# Separate cutaway shows the repeated floors, independent ceiling beams and columns.
for root in list(coll.objects):
    if root.parent:continue
    if root.get('zone')=='small' or root.name.startswith('small /') or root.type=='FONT':
        root.hide_render=True
        for child in root.children:child.hide_render=True
    if root.get('zone')=='large' and root.get('module_id','').startswith('roof-') and root.location.y<1.1:
        for child in root.children:child.hide_render=True
camera_at((18,-18,18),(4,0,1.1),52)
scene.render.resolution_x=1920;scene.render.resolution_y=1440
scene.render.filepath=str(REVIEW/'06-expanded-cutaway.png');bpy.ops.render.render(write_still=True)

# A direct doorway fit review, standing on the actual threshold with the leaf removed.
coll.hide_render=True;original.hide_render=False
for o in original.objects:
    if o.type=='EMPTY' and o.get('asset')=='door-leaf-110':
        for child in o.children:child.hide_render=True
scale_coll=bpy.data.collections.new('REVIEW / doorway scale');scene.collection.children.link(scale_coll)
person=mannequin((2,-2.47,.325),'Doorway / 1.78 m reference')
for o in [person,*person.children]:
    coll.objects.unlink(o);scale_coll.objects.link(o)
camera_at((4.5,-8.5,3.15),(1.9,-2.50,1.55),56)
scene.render.resolution_x=1600;scene.render.resolution_y=1600
scene.render.filepath=str(REVIEW/'07-doorway-scale.png');bpy.ops.render.render(write_still=True)
report={'mannequinHeightMetres':1.78,'mannequinPoseWidthMetres':1.0605,'doorClearWidthMetres':1.20,'doorClearHeightMetres':2.26,
    'heightMarginMetres':.48,'totalWidthMarginMetres':.1395,'scope':'Geometry scale review only; no animation or collision acceptance',
    'largeRoomOuterMetres':[13,9],'smallRoomOuterMetres':[7,5],'allModulesScale':[1,1,1],
    'layoutInstances':len(records),'source':'assets/models/scale-mannequin.glb'}
(REVIEW/'scale-review.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
