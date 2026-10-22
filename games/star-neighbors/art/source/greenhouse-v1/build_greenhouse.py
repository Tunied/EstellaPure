"""A glass garden kit in the habitat's material family, authored in metres."""
from pathlib import Path
KIT_SLUG='greenhouse-v1'
helper=Path(__file__).resolve().parent.parent/'habitat-v2/build_habitat.py'
shared=helper.read_text(encoding='utf-8').split('# -- End shared art helpers --')[0]
# Run the shared modeling definitions in this author's namespace, keeping this
# kit's paths and editable part collection. No habitat meshes are rebuilt here.
exec(compile(shared,str(helper),'exec'))
scene.name='Greenhouse / 4 x 6 metre garden'
material('16 • fresh leaf',(.28,.38,.07),0,.78)
material('17 • growing soil',(.075,.042,.02),0,.94)
material('18 • tomato',(.65,.072,.02),0,.49)
FRESH='16 • fresh leaf';SOIL='17 • growing soil';FRUIT='18 • tomato'

start('garden-floor-2m')
box('Insulated base',(0,0,.085),(2,2,.17),DARK,.025)
box('Washable floor',(0,0,.18),(1.986,1.986,.06),INNER,.018)
for x in [-.94,.94]:
    box('Drain trough',(x,0,.211),(.065,1.87,.012),DARK,.008)
    for y in [-.80+i*.16 for i in range(11)]:box('Drain slot',(x,y,.219),(.05,.027,.009),METAL,.003)
finish(current,[2,2,.21],{'top':[0,0,.21],'edgeLeft':[-1,0,0],'edgeRight':[1,0,0]})

start('garden-wall-glass-2m')
frame('Insulated perimeter',(1.986,2.8,.05),(1.76,2.14,.15),(0,1.54),0,.18,PAINT,(0,1.4))
frame('Window seal',(1.80,2.18,.17),(1.71,2.09,.125),(0,1.54),-.025,.05,RUBBER)
frame('Anodized glazing bead',(1.76,2.14,.15),(1.70,2.08,.12),(0,1.54),-.044,.07,METAL)
panel('Clear pane',1.735,2.115,.135,(0,1.54),.045,.010,GLASS)
box('Central glazing bar',(0,-.008,1.54),(.032,.075,2.08),PAINT,.01)
box('Outer sill',(0,-.035,.448),(1.83,.22,.068),PAINT,.018)
box('Base rail',(0,-.025,.12),(1.96,.10,.18),DARK,.025)
box('Service stripe',(0,-.03,.30),(1.87,.05,.09),ORANGE,.018)
for x in [-.96,.96]:box('Frame joint',(x,-.012,1.4),(.052,.06,2.68),PAINT,.015)
for x in [-.84,.84]:screw(x,-.054,.30)
text3d('GARDEN / 01',(0,-.061,.29),.044,WHITE)
finish(current,[2,.18,2.8],{'left':[-1,0,0],'right':[1,0,0],'roof':[0,0,2.8]})

start('garden-door-glass-120')
frame('Door seal',(1.235,2.27,.215),(.99,2.00,.16),(0,1.205),.10,.09,RUBBER)
frame('Door shell',(1.20,2.23,.195),(1.00,2.01,.16),(0,1.205),.075,.12,PAINT)
frame('Door bead',(1.04,2.05,.18),(.98,1.99,.15),(0,1.205),.055,.05,METAL)
panel('Door glass',1.01,2.02,.16,(0,1.205),.103,.010,GLASS)
box('Glass safety stripe',(0,.049,1.22),(1.0,.014,.055),ORANGE,.008)
for z in [.95,1.32]:box('Pull mount',(.44,.012,z),(.065,.14,.07),DARK,.015)
cylinder('Door pull',(.44,-.07,.95),(.44,-.07,1.32),.025,METAL)
text3d('GARDEN',(0,.037,1.20),.045,WHITE)
finish(current,[1.235,.3,2.34],{'doorway':[0,0,0]})

start('garden-corner-post')
box('Corner spine',(0,0,1.4),(.16,.16,2.8),PAINT,.04)
for z in [.12,2.70]:box('Post shoe',(0,0,z),(.21,.21,.18),DARK,.027)
box('Lower collar',(0,0,.30),(.19,.19,.09),ORANGE,.02)
finish(current,[.21,.21,2.8],{'base':[0,0,0],'roof':[0,0,2.8]})

def arc_profile(rx=2,rz=.9,steps=36):
    return [(rx*math.cos(t),rz*math.sin(t)) for t in [i*math.pi/2/steps for i in range(steps+1)]]

def swept_shell(name,outer,inner,y0,y1,mat):
    loop=outer+list(reversed(inner));k=len(loop)
    vs=[(x,y,z) for y in [y0,y1] for x,z in loop]
    fs=[tuple(range(k-1,-1,-1)),tuple(range(k,2*k))]
    fs += [(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
    o=mesh(name,vs,fs,mat)
    for i,f in enumerate(o.data.polygons):f.use_smooth=i>1
    return o

start('garden-roof-glass-half-2m')
swept_shell('Curved sealed pane',arc_profile(),arc_profile(1.990,.890),-.968,.968,GLASS)
for y in [-.97,.97]:swept_shell('Pane edge seal',arc_profile(2.004,.904),arc_profile(1.985,.885),y-.008,y+.008,RUBBER)
finish(current,[2,2,.9],{'ridge':[0,0,.9],'eave':[2,0,0],'start':[0,-1,0],'end':[0,1,0]})

start('garden-arch-half-2m')
swept_shell('Curved structural rib',arc_profile(2.045,.945),arc_profile(1.955,.855),-.05,.05,PAINT)
swept_shell('Inner rib reinforcement',arc_profile(1.96,.86),arc_profile(1.935,.835),-.032,.032,METAL)
box('Eave anchor',(2,0,.03),(.18,.16,.15),ORANGE,.027)
box('Crown splice',(.035,0,.907),(.16,.17,.12),METAL,.025)
finish(current,[2.1,.17,.97],{'ridge':[0,0,.9],'eave':[2,0,0]})

start('garden-roof-end-half-2m')
profile=arc_profile()+[(0,0)]
k=len(profile);vs=[(x,y,z) for y in [0,.010] for x,z in profile]
fs=[tuple(range(k-1,-1,-1)),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
mesh('Arched end pane',vs,fs,GLASS)
box('End head rail',(1,.04,.02),(1.98,.13,.085),PAINT,.02)
box('Half crown mullion',(.025,.04,.45),(.05,.11,.90),PAINT,.012)
finish(current,[2,.17,.9],{'base':[0,0,0],'ridge':[0,0,.9],'side':[2,0,0]})

start('garden-ridge-2m')
box('Ridge spine',(0,0,.90),(.15,1.984,.16),PAINT,.04)
box('Ridge top cap',(0,0,1.00),(.19,1.98,.055),ORANGE,.02)
box('Grow light socket',(0,0,.797),(.12,1.77,.07),DARK,.018)
box('Warm grow light',(0,0,.755),(.085,1.64,.025),LAMP,.009)
finish(current,[.19,2,1.03],{'start':[0,-1,0],'end':[0,1,0],'ridge':[0,0,.9]})

start('garden-gutter-2m')
box('Gutter lower channel',(0,0,.025),(.20,1.985,.07),DARK,.018)
box('Gutter exterior lip',(.092,0,.09),(.045,1.98,.14),ORANGE,.018)
box('Gutter interior lip',(-.092,0,.07),(.035,1.98,.10),PAINT,.012)
for y in [-.78,.78]:box('Gutter bracket',(0,y,-.045),(.22,.11,.12),METAL,.022)
finish(current,[.22,2,.20],{'start':[0,-1,0],'end':[0,1,0]})

start('growing-bed-2m')
for x in [-.72,.72]:
    for y in [-.31,.31]:box('Bed leg',(x,y,.12),(.13,.13,.24),DARK,.025)
box('Planting basin',(0,0,.37),(1.84,.81,.48),PAINT,.065)
box('Basin top rim',(0,0,.61),(1.90,.87,.085),ORANGE,.03)
box('Growing medium',(0,0,.659),(1.71,.69,.036),SOIL,.018)
for y in [-.33,.33]:cylinder('Irrigation rail',(-.83,y,.69),(.83,y,.69),.018,DARK,12)
for x in [-.67,-.22,.22,.67]:
    for y in [-.33,.33]:cylinder('Dripper',(x,y,.69),(x,y*.73,.69),.010,METAL,10)
panel('Bed monitor',.28,.15,.025,(.48,.40),-.426,.025,DARK)
box('Moisture readout',(.48,-.447,.42),(.18,.008,.025),CYAN,.006)
text3d('HYDRO / 02',(-.34,-.414,.36),.045)
finish(current,[1.9,.87,.71],{'floor':[0,0,0],'crop':[0,0,.677]})

start('crop-tray-leafy')
box('Removable root mat',(0,0,.014),(1.64,.59,.028),SOIL,.008)
for ix in range(4):
    for iy in range(2):
        ox=-.61+ix*.40;oy=-.17+iy*.34
        stem=random.uniform(.24,.43)
        cylinder('Soft plant stem',(ox,oy,.025),(ox,oy,stem),.011,LEAF,10)
        for j in range(8):
            a=j*2.399+random.uniform(-.2,.2);length=random.uniform(.19,.31)
            origin=Vector((ox,oy,.055+j*.028))
            end=origin+Vector((math.cos(a)*length,math.sin(a)*length,random.uniform(.10,.21)))
            side=Vector((-math.sin(a),math.cos(a),0));vs=[];fs=[]
            for step in range(9):
                t=step/8;c=origin+(end-origin)*t;c.z+=math.sin(math.pi*t)*.10
                w=math.sin(math.pi*t)**.7*length*.29
                vs += [tuple(c-side*w),tuple(c+Vector((0,0,w*.24))),tuple(c+side*w)]
            for step in range(8):
                for edge in range(2):v=step*3+edge;fs.append((v,v+1,v+4,v+3))
            o=mesh('Broad edible leaf',vs,fs,FRESH if j%3==0 else LEAF,smooth=True)
            mod=o.modifiers.new('Leaf thickness','SOLIDIFY');mod.thickness=.001
            bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
finish(current,[2,.9,.6],{'bed':[0,0,0]})

start('garden-irrigation-unit')
box('Pump plinth',(0,0,.07),(.64,.47,.14),DARK,.025)
box('Pump housing',(0,0,.58),(.58,.40,1.02),PAINT,.08)
box('Enamel cap',(0,0,1.10),(.59,.41,.12),ORANGE,.045)
panel('Pump display',.35,.30,.04,(0,.82),-.215,.02,DARK)
for j in range(3):box('Pump reading',(-.025,-.239,.74+j*.065),(.21-j*.04,.008,.014),CYAN,.003)
for x in [-.14,.14]:
    cylinder('Water outlet',(x,-.20,.29),(x,-.30,.29),.055,METAL)
    cylinder('Orange hose coupling',(x,-.29,.29),(x,-.34,.29),.06,ORANGE)
text3d('WATER / 01',(0,-.206,.47),.045)
finish(current,[.64,.60,1.16],{'floor':[0,0,0]})

# Existing habitat parts are referenced directly, keeping cross-kit door fit.
dependencies=[]
for name in ['wall-doorway-2m','entry-step-2m']:
    before=set(bpy.data.objects)
    path=PROJECT/'art/models/habitat-v2'/(name+'.glb')
    bpy.ops.import_scene.gltf(filepath=str(path));bpy.context.view_layer.update()
    added=list(set(bpy.data.objects)-before);meshes=[o for o in added if o.type=='MESH']
    coll=bpy.data.collections.new('DEPENDENCY / habitat / '+name);library.children.link(coll)
    root=bpy.data.objects.new('habitat/'+name,None);coll.objects.link(root)
    for o in meshes:
        transform=o.matrix_world.copy()
        for c in list(o.users_collection):c.objects.unlink(o)
        coll.objects.link(o);o.parent=root;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_basis=transform
        for slot in o.material_slots:
            candidate=next((m for key,m in materials.items() if slot.material.name.startswith(key)),None)
            if candidate:slot.material=candidate
        o.hide_set(True)
    for o in added:
        if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
    coll.hide_render=True
    assets['habitat/'+name]={'root':root,'parts':meshes,'collection':coll}
    dependencies.append({'id':'habitat/'+name,'glb':str(path.relative_to(PROJECT)).replace('\\','/')})

assembly=bpy.data.collections.new('ASSEMBLY / modular glass garden');scene.collection.children.link(assembly)
def place(name,p=(0,0,0),angle=0,coll=assembly,record=True):
    root=bpy.data.objects.new(name+' instance',None);coll.objects.link(root);root.location=p;root.rotation_euler.z=math.radians(angle)
    for original in assets[name]['parts']:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:layout.append({'asset':name,'positionZUp':p,'yawZ':angle})
    return root

for y in [-2,0,2]:
    for x in [-1,1]:place('garden-floor-2m',(x,y,0))
    for x,a in [(2,90),(-2,270)]:
        place('garden-wall-glass-2m',(x,y,.21),a)
        place('garden-gutter-2m',(x,y,3.01),0 if x>0 else 180)
    for a in [0,180]:place('garden-roof-glass-half-2m',(0,y,3.01),a)
    place('garden-ridge-2m',(0,y,3.01))
for y in [-3,-1,1,3]:
    for a in [0,180]:place('garden-arch-half-2m',(0,y,3.01),a)
for y,a in [(-3,0),(3,180)]:
    for x in [-1,1]:
        if y<0 and x>0:
            place('habitat/wall-doorway-2m',(x,y,.21));place('garden-door-glass-120',(x,y,.21))
            place('habitat/entry-step-2m',(x,y-.03,0))
        else:place('garden-wall-glass-2m',(x,y,.21),a)
    for rotation in [0,180]:place('garden-roof-end-half-2m',(0,y,3.01),rotation)
    for x in [-2,2]:place('garden-corner-post',(x,y,.21))
for x in [-1.32,1.32]:
    for y in [-1.30,.80]:
        place('growing-bed-2m',(x,y,.21),90)
        place('crop-tray-leafy',(x,y,.887),90)
place('garden-irrigation-unit',(-1.15,2.45,.21))
catalog={'stage':'art-review','units':'metres','sourceUp':'Z','glbUp':'Y','assets':manifest,'dependencies':dependencies,
    'expansion':'Repeat along Y in 2 m increments, move the end walls and add ribs. Current vault width is 4 m.'}
(HERE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'assembly.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

studio=bpy.data.collections.new('STUDIO / review only');scene.collection.children.link(studio)
material('Studio sand',(.26,.285,.265),0,.84)
start('studio');ground=box('Studio ground',(0,0,-.11),(200,200,.2),'Studio sand',0)
for c in list(ground.users_collection):c.objects.unlink(ground)
studio.objects.link(ground)
def light(name,p,power,size,color,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=size;data.shape='DISK';data.color=color
    o=bpy.data.objects.new(name,data);studio.objects.link(o);o.location=p;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    return o
light('Warm key',(-5,-6,10),1800,6,(1,.84,.64),(0,0,1))
light('Cool fill',(7,-1,6),1200,6,(.65,.82,1),(0,0,1))
light('Rim',(6,7,5),1300,4,(1,.93,.76),(0,0,1))
for y in [-1.7,1.3]:light('Garden fill',(0,y,2.85),70,1.5,(1,.8,.50),(0,y,.3))
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.43,.57,.68,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.28
bpy.ops.object.camera_add(location=(9,-11,7));camera=bpy.context.object;camera.name='Garden review camera';scene.camera=camera
def camera_at(p,target,lens=47):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
camera_at((9,-11,7),(0,0,1.65))
scene.render.engine='CYCLES';scene.cycles.samples=96;scene.cycles.use_denoising=True
scene.cycles.max_bounces=16;scene.cycles.transmission_bounces=12;scene.cycles.transparent_max_bounces=24
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.25
scene.render.resolution_x=1920;scene.render.resolution_y=1440;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene['reference']='art/concepts/selected-warm-sci-fi.png';scene['stage']='Art review; no in-engine acceptance.'
scene.render.filepath=str(REVIEW/'01-greenhouse.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'greenhouse-v1.blend'))
if os.environ.get('GARDEN_SKIP_RENDER')!='1':
    bpy.ops.render.render(write_still=True)
    assembly.hide_render=True
    detail=bpy.data.collections.new('REVIEW / growing bed detail');scene.collection.children.link(detail)
    place('growing-bed-2m',(0,0,0),coll=detail,record=False)
    place('crop-tray-leafy',(0,0,.677),coll=detail,record=False)
    place('garden-irrigation-unit',(1.65,.22,0),coll=detail,record=False)
    camera_at((3.4,-5,3.05),(.40,0,.6),52)
    scene.render.filepath=str(REVIEW/'02-growing-bed.png');bpy.ops.render.render(write_still=True)
    detail.hide_render=True;detail.hide_viewport=True;assembly.hide_render=False

# Inspect roof, glazing, structure and planting as independent manufactured parts.
assembly.hide_render=True
board=bpy.data.collections.new('REVIEW / separate modules');scene.collection.children.link(board)
items=[('garden-wall-glass-2m','01 / GLAZED WALL 2 M'),('garden-roof-glass-half-2m','02 / CURVED GLASS 2 M'),('garden-arch-half-2m','03 / ARCH HALF 2 M'),
       ('garden-door-glass-120','04 / GARDEN DOOR'),('garden-roof-end-half-2m','05 / END GLAZING'),('garden-ridge-2m','06 / RIDGE + LIGHT'),
       ('growing-bed-2m','07 / GROWING BED'),('crop-tray-leafy','08 / REMOVABLE CROPS'),('garden-irrigation-unit','09 / IRRIGATION')]
for i,(name,label) in enumerate(items):
    x=(i%3-1)*4.2;z=(1-i//3)*4.2
    root=place(name,(x,0,z),-20,board,False);root.rotation_euler.x=math.radians(22)
    bpy.context.view_layer.update();points=[o.matrix_world@Vector(c) for o in root.children for c in o.bound_box]
    root.location.x+=x-(min(p.x for p in points)+max(p.x for p in points))/2
    root.location.z+=z-(min(p.z for p in points)+max(p.z for p in points))/2
    start('board');o=text3d(label,(x,-1.5,z-1.68),.16,INK)
    for c in list(o.users_collection):c.objects.unlink(o)
    board.objects.link(o)
start('board');backdrop=box('Sheet backdrop',(0,3,0),(40,.1,40),'Studio sand',0)
for c in list(backdrop.users_collection):c.objects.unlink(backdrop)
board.objects.link(backdrop);ground.hide_render=True
boardlight=light('Sheet fill',(0,-10,2),1500,12,(1,.95,.85),(0,0,0))
camera_at((0,-30,0),(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=15.6
scene.render.resolution_x=1900;scene.render.resolution_y=1800;scene.render.filepath=str(REVIEW/'03-garden-modules.png')
if os.environ.get('GARDEN_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
board.hide_render=True;board.hide_viewport=True;ground.hide_render=False;assembly.hide_render=False
boardlight.hide_render=True;boardlight.hide_viewport=True;camera.data.type='PERSP'
camera_at((9,-11,7),(0,0,1.65));scene.render.resolution_x=1920;scene.render.resolution_y=1440
scene.render.filepath=str(REVIEW/'01-greenhouse.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'greenhouse-v1.blend'))
print(json.dumps({'assets':len(manifest),'dependencies':len(dependencies),'instances':len(layout)}))
