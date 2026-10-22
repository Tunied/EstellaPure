"""Build the modular, editable art study using metre-scale Y-up authoring coordinates.

Run with Blender --background --factory-startup --python. Each kit asset has its
own root/collection and GLB; the review scene uses linked copies. The mannequin
is an unmodified CC0 MakeHuman base for scale only, never a production character.
"""
from pathlib import Path
import bpy, bmesh, json, math, random, os
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / 'art/source/kit-spec.json').read_text(encoding='utf-8'))
MODELS = ROOT / 'assets/models'
SOURCE = ROOT / 'art/source'
REVIEW = ROOT / 'art/reviews'
for folder in (MODELS, SOURCE, REVIEW): folder.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(1022)
materials, assets, batches = {}, {}, {}
current = None

def xyz(p): return (p[0], -p[2], p[1])

for name, color in SPEC['palette'].items():
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = .65 if name == 'steel' else .12 if name in ('ivory', 'orange') else 0
    shader.inputs['Roughness'].default_value = .24 if name in ('glass', 'solar') else .52 if name in ('steel', 'ivory', 'orange') else .83
    if name == 'glass':
        shader.inputs['Metallic'].default_value = .42
        shader.inputs['Coat Weight'].default_value = .45
    if name == 'cyan':
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = 1.7
    mat.diffuse_color = (*color, 1)
    materials[name] = mat

def start(name):
    global current
    current = name
    batches[name] = []

def finish_obj(obj, material):
    obj.data.materials.append(materials[material])
    batches[current].append(obj)
    return obj

def box(p, s, m='ivory', bevel=.04, name='panel'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('edge-radius', 'BEVEL')
        mod.width = min(bevel, min(s) * .42)
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('weighted-normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish_obj(obj, m)

def ball(p, s, m, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=xyz(p))
    obj = bpy.context.object
    obj.scale = (s[0], s[2], s[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons: poly.use_smooth = True
    return finish_obj(obj, m)

def tube(a, b, r, m='steel', r2=None, sides=10):
    pa, pb = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if r2 is None else r2, depth=(pb-pa).length, location=(pa+pb)/2)
    obj = bpy.context.object
    obj.rotation_euler = (pb-pa).to_track_quat('Z', 'Y').to_euler()
    for poly in obj.data.polygons: poly.use_smooth = len(poly.vertices) == 4
    return finish_obj(obj, m)

def line(points, radius, material):
    for a, b in zip(points, points[1:]): tube(a, b, radius, material)

def ring(p, radius, thick, material, start_angle=0, end_angle=math.tau, steps=48):
    points = [(p[0]+radius*math.cos(t), p[1]+radius*math.sin(t), p[2]) for t in [start_angle+(end_angle-start_angle)*i/steps for i in range(steps+1)]]
    line(points, thick, material)

def frame(p, w, h, r, thick, material):
    points=[]
    for cx, cy, angle in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
        for i in range(7):
            t=math.radians(angle+i*15)
            points.append((p[0]+cx+r*math.cos(t),p[1]+cy+r*math.sin(t),p[2]))
    line(points+[points[0]],thick,material)

def leaf(p, length, width, angle, material='leaf'):
    # A folded leaf silhouette with a raised midrib, rather than a canopy sphere.
    c,s=math.cos(angle),math.sin(angle)
    coords=[(-length/2,0,0),(0,width/2,0),(length/2,0,0),(0,-width/2,0),(0,0,width*.16)]
    verts=[xyz((p[0]+x*c-z*s,p[1]+z*c+x*s,p[2]+y)) for x,y,z in coords]
    mesh=bpy.data.meshes.new('leaf')
    mesh.from_pydata(verts,[],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)])
    mesh.update()
    obj=bpy.data.objects.new('leaf',mesh);bpy.context.collection.objects.link(obj)
    return finish_obj(obj,material)

def consolidate(name):
    parts = batches[name]
    coll=bpy.data.collections.new('KIT/'+name);bpy.context.scene.collection.children.link(coll)
    root=bpy.data.objects.new(name,None);coll.objects.link(root)
    result=[]
    groups={material:[o for o in parts if o.data.materials[0].name==material] for material in materials}
    for material in materials:
        group=groups[material]
        if not group: continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in group: obj.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        if len(group)>1:bpy.ops.object.join()
        obj=bpy.context.object
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.name=name+'__'+material
        for old in list(obj.users_collection): old.objects.unlink(obj)
        coll.objects.link(obj);obj.parent=root
        result.append(obj)
    assets[name]={'root':root,'parts':result,'collection':coll}
    return root

def hardware(p):
    box(p,(.13,.13,.035),'steel',.025)
    box((p[0],p[1],p[2]+.025),(.052,.025,.02),'rubber',.003)

start('floor-2m')
box((0,.08,0),(2,.16,2),'steel',.06)
box((0,.17,0),(1.94,.08,1.94),'ivory',.045)
for x in [-.78,.78]:
    for z in [-.78,.78]:box((x,.218,z),(.1,.015,.1),'steel',.02)
consolidate(current)

for kind in ['wall-2m','window-2m','door-2m']:
    start(kind)
    for x in [-.94,.94]:box((x,1.4,0),(.12,2.8,.23),'ivory',.04)
    box((0,.13,0),(1.8,.26,.23),'steel',.035)
    box((0,2.61,0),(1.8,.38,.23),'ivory',.07)
    box((0,2.46,.128),(1.78,.11,.035),'orange',.018)
    if kind=='wall-2m':
        box((0,1.38,0),(1.8,2.28,.18),'ivory',.06)
        box((0,.42,.115),(1.65,.035,.04),'steel',.008)
    elif kind=='window-2m':
        box((0,.49,0),(1.8,.5,.18),'ivory',.05)
        box((0,1.61,-.025),(1.66,1.55,.035),'glass',.015)
        frame((0,1.61,.12),1.7,1.6,.17,.055,'steel')
        frame((0,1.61,.15),1.76,1.66,.2,.025,'orange')
        box((-.55,2.2,.155),(.36,.025,.02),'cyan',.008)
    else:
        for x in [-.73,.73]:box((x,1.36,0),(.35,2.18,.2),'ivory',.06)
        frame((0,1.24,.10),1.08,2.2,.22,.065,'orange')
        box((.71,1.4,.18),(.18,.37,.12),'steel',.04)
        box((.71,1.44,.25),(.10,.22,.02),'cyan',.02)
    for x in [-.87,.87]: hardware((x,2.55,.15))
    consolidate(current)

start('roof-2m')
box((0,.16,0),(2.04,.32,2.04),'ivory',.14)
box((0,.32,0),(1.77,.08,1.77),'ivory',.035)
for x in [-.94,.94]:box((x,.14,0),(.065,.065,1.91),'orange',.02)
consolidate(current)

start('greenhouse-2m')
box((0,.12,0),(2.15,.24,2.15),'ivory',.08)
box((0,.28,0),(1.86,.15,1.86),'soil',.04)
for z in [-1,-.33,.33,1]:
    points=[(-1,.32,z),(-1,1.1,z)]
    points += [(math.cos(t),1.1+math.sin(t),z) for t in [math.pi-i*math.pi/16 for i in range(17)]]
    points += [(1,.32,z)]
    line(points,.045,'ivory')
for x,y in [(-1,1.1),(0,2.1),(1,1.1)]:tube((x,y,-1),(x,y,1),.035,'steel')
for x in [-.6,0,.6]:
    for z in [-.65,.05,.65]:
        tube((x,.34,z),(x,.9,z),.035,'leaf')
        for y in [.48,.67,.84]:
            for side in [-1,1]: leaf((x+side*.13,y,z),.38,.16,side*.35,'leafLight')
consolidate(current)

start('planter')
box((0,.25,0),(2,.5,1.1),'ivory',.1)
box((0,.52,0),(1.83,.09,.93),'soil',.055)
for z in [-.51,.51]:box((0,.38,z),(1.76,.10,.035),'orange',.02)
for x in [-.86,.86]:
    for z in [-.47,.47]:box((x,.24,z),(.13,.42,.12),'steel',.025)
box((.6,.29,.57),(.32,.17,.04),'steel',.025)
box((.6,.31,.595),(.20,.06,.015),'cyan',.01)
consolidate(current)

start('crate')
box((0,.38,0),(1.0,.76,.78),'ivory',.10)
box((0,.78,0),(1.02,.12,.80),'steel',.06)
for x in [-.41,.41]:
    for z in [-.31,.31]:box((x,.4,z),(.16,.78,.16),'orange',.05)
box((0,.48,.41),(.35,.18,.035),'rubber',.025)
box((0,.49,.435),(.25,.07,.035),'steel',.015)
box((.20,.23,.405),(.26,.13,.025),'cyan',.02)
consolidate(current)

start('solar-panel')
box((0,.10,0),(1.2,.20,.85),'ivory',.08)
tube((0,.2,0),(0,1,0),.07,'steel')
panel=box((0,1.12,0),(2,.1,1.45),'steel',.04)
panel.rotation_euler.x=math.radians(28)
for ix in range(6):
    for iz in range(4):
        u=-.81+ix*.325; v=-.51+iz*.34
        angle=math.radians(28)
        y=1.12+.057*math.cos(angle)-v*math.sin(angle);z=v*math.cos(angle)+.057*math.sin(angle)
        obj=box((u,y,z),(.30,.015,.31),'solar',.005);obj.rotation_euler.x=angle
consolidate(current)

start('portal')
box((0,.13,0),(4.6,.26,2.5),'steel',.10)
for z in [-1,-.5,0,.5,1]:box((0,.28,z),(4.2,.06,.40),'ivory',.025)
ring((0,2.35,-.25),1.98,.20,'steel')
ring((0,2.35,-.20),1.79,.06,'cyan')
for i in range(12):
    t=math.tau*i/12
    ring((0,2.35,-.23),2.04,.15,'orange' if i%3==0 else 'ivory',t+.045,t+math.tau/12-.045,4)
    x,y=2.04*math.cos(t+.26),2.35+2.04*math.sin(t+.26)
    obj=box((x,y,-.03),(.18,.10,.08),'cyan',.02);obj.rotation_euler.y=-(t+.26)
for x in [-1.85,1.85]:box((x,.66,-.20),(.48,.76,.68),'ivory',.08)
# Open centre: real geometry can be walked around; energy is a nested spiral.
for k in range(3):
    pts=[]
    for i in range(60):
        t=i/59*math.tau*.86+k*math.tau/3;r=.35+1.35*i/59
        pts.append((r*math.cos(t),2.35+r*math.sin(t),-.31))
    line(pts,.012,'cyan')
consolidate(current)

start('repair-robot')
ball((0,.42,0),(.36,.32,.3),'ivory',24,12)
ball((0,.45,.24),(.25,.19,.095),'rubber',20,10)
for x in [-.1,.1]:ball((x,.47,.323),(.027,.045,.02),'cyan',10,6)
for x in [-.37,.37]:
    ball((x,.43,0),(.095,.12,.10),'orange')
    tube((x,.37,0),(x*1.25,.18,.02),.035,'steel')
    box((x*1.25,.13,.04),(.10,.13,.10),'steel',.025)
tube((0,.72,0),(.05,.91,0),.018,'steel')
ball((.05,.92,0),(.045,.045,.045),'orange')
consolidate(current)

start('crop')
tube((0,0,0),(0,.78,0),.018,'leaf')
for j in range(7):
    t=j*2.4;y=.15+j*.082;x=.22*math.cos(t);z=.22*math.sin(t)
    tube((0,y-.06,0),(x,y,z),.011,'leaf')
    obj=leaf((x,y,z),.30,.12,.2 if j%2 else -.3,'leafLight' if j%3==0 else 'leaf')
    if j%2==0:ball((x,y-.08,z),(.07,.07,.065),'fruit',12,7)
consolidate(current)

start('grass-tuft')
for j in range(8):
    a=j*2.4;x=.10*math.cos(a);z=.10*math.sin(a)
    tube((x,0,z),(x*1.8,.16+random.random()*.18,z*1.8),.009,'grass',r2=.001,sides=3)
consolidate(current)
start('flower')
for j in range(3):
    x=(j-1)*.12;z=(j%2)*.12;y=.25+j*.04
    tube((x,0,z),(x,y,z),.008,'leaf')
    for k in range(5):
        t=k*math.tau/5
        ball((x+math.cos(t)*.042,y,z+math.sin(t)*.042),(.045,.013,.026),'petal',8,4)
consolidate(current)

start('tree')
tube((0,0,0),(.12,2.5,0),.18,'bark',r2=.085)
for j in range(7):
    a=j*2.4;cx=math.cos(a)*(.8+random.random()*.4);cz=math.sin(a)*(.8+random.random()*.4);cy=2.5+random.random()*1.0
    tube((.1,1.5+j*.14,0),(cx,cy,cz),.07,'bark',r2=.018)
    for n in range(70):
        t=random.random()*math.tau;r=math.sqrt(random.random())*.80
        p=(cx+math.cos(t)*r,cy+random.uniform(-.15,.35)*(1-r*.5),cz+math.sin(t)*r)
        leaf(p,random.uniform(.25,.43),random.uniform(.10,.20),random.uniform(-.5,.5),'leafLight' if n%3==0 else 'leaf')
consolidate(current)

start('rock')
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1)
obj=bpy.context.object
for v in obj.data.vertices:
    v.co.x*=1+random.uniform(-.16,.16);v.co.y*=.7+random.uniform(-.12,.12);v.co.z=.45+v.co.z*.55
    v.co.z=max(.01,v.co.z)
finish_obj(obj,'stone');consolidate(current)

# The only human geometry here is a third-party scale mannequin, without fitting
# or invented face/outfit geometry. Character references are a separate gate.
base=SOURCE/'third-party/makehuman-base.obj'
if base.exists():
    start('scale-mannequin')
    verts=[];faces=[];group=''
    for row in base.read_text(encoding='utf-8').splitlines():
        if row.startswith('v '):verts.append(tuple(map(float,row.split()[1:4])))
        elif row.startswith('g '):group=row[2:]
        elif row.startswith('f ') and group=='body':faces.append([int(v.split('/')[0])-1 for v in row.split()[1:]])
    used=sorted({v for f in faces for v in f});remap={v:i for i,v in enumerate(used)}
    low=min(verts[i][1] for i in used);height=max(verts[i][1] for i in used)-low
    points=[xyz((verts[i][0]*1.78/height,(verts[i][1]-low)*1.78/height,verts[i][2]*1.78/height)) for i in used]
    mesh=bpy.data.meshes.new('CC0-scale-body');mesh.from_pydata(points,[],[[remap[i] for i in f] for f in faces]);mesh.update()
    obj=bpy.data.objects.new('Scale reference only',mesh);bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:poly.use_smooth=True
    finish_obj(obj,'steel');consolidate(current)

catalog=[]
for name, asset in assets.items():
    bpy.ops.object.select_all(action='DESELECT')
    asset['root'].select_set(True)
    for part in asset['parts']:part.select_set(True)
    bpy.context.view_layer.objects.active=asset['root']
    bpy.ops.export_scene.gltf(filepath=str(MODELS/(name+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
    points=[part.matrix_world @ Vector(corner) for part in asset['parts'] for corner in part.bound_box]
    mins=[min(p[i] for p in points) for i in range(3)];maxs=[max(p[i] for p in points) for i in range(3)]
    triangles=0
    for part in asset['parts']:part.data.calc_loop_triangles();triangles+=len(part.data.loop_triangles)
    catalog.append({'id':name,'sourceCollection':'KIT/'+name,'glb':'assets/models/'+name+'.glb','triangles':triangles,'materialSlots':len(asset['parts']),'dimensions':[round(maxs[0]-mins[0],4),round(maxs[2]-mins[2],4),round(maxs[1]-mins[1],4)],'origin':'bottom-centre','stage':'scale-reference' if name=='scale-mannequin' else 'art-study'})
    for part in asset['parts']:part.hide_render=True;part.hide_set(True)

(SOURCE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf-8')
layout=[]
sample=bpy.data.collections.new('SAMPLE/assembly');bpy.context.scene.collection.children.link(sample)

def place(asset_id, p, yaw=0, scale=1, name=None):
    root=bpy.data.objects.new(name or f'{asset_id}-{len(layout)}',None);sample.objects.link(root)
    root.location=xyz(p);root.rotation_euler.z=math.radians(yaw);root.scale=(scale,scale,scale)
    for part in assets[asset_id]['parts']:
        obj=part.copy();obj.data=part.data;sample.objects.link(obj);obj.parent=root;obj.hide_render=False;obj.hide_set(False)
    layout.append({'name':root.name,'asset':asset_id,'position':list(p),'yaw':yaw,'scale':scale})
    return root

# Six independent floor/roof cells; each perimeter is a replaceable wall module.
for x in [-7,-5,-3]:
    for z in [-3,-1]:
        place('floor-2m',(x,0,z));place('roof-2m',(x,SPEC['floorHeight']+SPEC['wallHeight'],z))
for x,kind in [(-7,'window-2m'),(-5,'window-2m'),(-3,'door-2m')]:place(kind,(x,SPEC['floorHeight'],0))
for x in [-7,-5,-3]:place('wall-2m',(x,SPEC['floorHeight'],-4),180)
for z in [-3,-1]:place('wall-2m',(-8,SPEC['floorHeight'],z),-90);place('window-2m',(-2,SPEC['floorHeight'],z),90)
place('greenhouse-2m',(-9.4,0,-1.2))
place('portal',(6.3,0,-1.8),-12,name='Portal')
place('planter',(-6.7,0,4.1),name='Garden planter')
place('planter',(-9.0,0,2.2),20)
for x,z in [(-7.25,4.1),(-6.65,4.1),(-6.05,4.1),(-9.5,2.2),(-8.9,2.2)]:place('crop',(x,.56,z))
place('crate',(-2.1,0,4.6),-12);place('crate',(-3.1,0,4.9),14,.8)
place('solar-panel',(-.8,0,-.3),-10)
place('repair-robot',(.1,1.65,.1),name='Robot')
if 'scale-mannequin' in assets:place('scale-mannequin',(2.7,0,1.9),-35,name='Scale mannequin')
for x,z,s in [(-11,-5,1.6),(-12,5,1.3),(-9,10,1.2),(11,-6,1.6),(13,4,1.3),(-1,-10,1.1),(8,-11,1.2)]:place('tree',(x,0,z),random.uniform(0,360),s)
for x,z,s in [(-10,8,1.3),(11,6,1.5),(9,-7,2.2),(-13,-7,2),(-2,-9,.7),(8,9,.8)]:place('rock',(x,0,z),random.uniform(0,360),s)

# Terrain is split into four independently reusable static chunks. Fine foliage
# is material-batched inside each chunk, while the editable source stays in the kit.
for ix in [-1,0]:
    for iz in [-1,0]:
        start(f'terrain-{ix+1}-{iz+1}')
        x0=ix*16;z0=iz*16
        verts=[];faces=[]
        for j in range(17):
            for i in range(17):
                x=x0+i;z=z0+j;y=-.055+min(1,max(0,abs(x)-10)/6)*(.18*math.sin(x*.6+z*.4))
                verts.append(xyz((x,y,z)))
        for j in range(16):
            for i in range(16):
                a=j*17+i;faces.append((a,a+17,a+18,a+1))
        mesh=bpy.data.meshes.new(current);mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new(current,mesh);bpy.context.collection.objects.link(obj);finish_obj(obj,'sand')
        # Ground cover keeps a readable earth path while breaking up broad colour.
        grass_faces=[]
        for j in range(16):
            for i in range(16):
                x=x0+i+.5;z=z0+j+.5
                path=(abs(x-1)<2.2 and z>-4) or (abs(z-1.8)<1.1 and -10<x<7)
                if not path:grass_faces.append(faces[j*16+i])
        grass_mesh=bpy.data.meshes.new(current+'-groundcover')
        grass_mesh.from_pydata([(v[0],v[1],v[2]+.003) for v in verts],[],grass_faces);grass_mesh.update()
        grass_obj=bpy.data.objects.new(current+'-groundcover',grass_mesh);bpy.context.collection.objects.link(grass_obj);finish_obj(grass_obj,'grass')
        for n in range(350):
            x=x0+random.random()*16;z=z0+random.random()*16
            blocked=(-10.7<x<-1.7 and -5<z<1.1) or (4<x<8.8 and -3.5<z<0) or (-8.1<x<-5.4 and 3.3<z<4.9)
            path=(abs(x-1.0)<2.2 and -4<z<12) or (abs(z-1.8)<1.1 and -10<x<7)
            if blocked or path:continue
            source=assets['flower' if n%12==0 else 'grass-tuft']
            for part in source['parts']:
                cp=part.copy();cp.data=part.data.copy();bpy.context.collection.objects.link(cp);cp.parent=None
                cp.location=xyz((x,0,z));cp.rotation_euler.z=random.random()*math.tau
                sc=random.uniform(.65,1.55);cp.scale=(sc,sc,sc);cp.hide_set(False);cp.hide_render=False;batches[current].append(cp)
        consolidate(current)
        asset=assets[current]
        bpy.ops.object.select_all(action='DESELECT');asset['root'].select_set(True)
        for part in asset['parts']:part.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(MODELS/(current+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_animations=False)
        for part in asset['parts']:part.hide_render=True;part.hide_set(True)
        place(current,(0,0,0))

(SOURCE/'sample-layout.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

# Background geometry is a separate asset, not a photographic backdrop.
start('landscape')
box((0,-.42,0),(200,.30,200),'grass',0)
box((0,-.20,-45),(140,.08,50),'glass',0)
for j in range(20):
    x=-60+j*6.5;z=-60-random.random()*20;h=random.uniform(3,8)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=xyz((x,h*.27,z)))
    obj=bpy.context.object;obj.scale=(random.uniform(4,7),random.uniform(5,9),h*.75)
    for v in obj.data.vertices:v.co*=random.uniform(.82,1.2)
    finish_obj(obj,'stone')
consolidate(current);asset=assets[current]
bpy.ops.object.select_all(action='DESELECT');asset['root'].select_set(True)
for part in asset['parts']:part.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(MODELS/'landscape.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=False)
for part in asset['parts']:part.hide_render=True;part.hide_set(True)
place('landscape',(0,0,0));(SOURCE/'sample-layout.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

start('sky-dome')
ball((0,0,0),(155,155,155),'sky',48,24)
ball((-45,36,-100),(13,13,13),'planet',32,16)
ball((-18,42,-111),(4,4,4),'planet',24,12)
for i in range(65):
    a=random.uniform(-2.8,2.8);e=random.uniform(.1,1.2)
    p=(125*math.cos(e)*math.sin(a),125*math.sin(e),-125*math.cos(e)*math.cos(a))
    ball(p,(.06,.06,.06),'star',6,4)
consolidate(current);asset=assets[current]
bpy.ops.object.select_all(action='DESELECT');asset['root'].select_set(True)
for part in asset['parts']:part.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(MODELS/'sky-dome.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=False)
for part in asset['parts']:part.hide_render=True;part.hide_set(True)
# Engine uses the dome; offline review uses the physical sky for illumination.
layout.append({'name':'Sky dome','asset':'sky-dome','position':[0,0,0],'yaw':0,'scale':1})
(SOURCE/'sample-layout.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

# Include environment chunks in the same manifest as the reusable kit parts.
for name,asset in assets.items():
    if any(item['id']==name for item in catalog):continue
    triangles=0
    for part in asset['parts']:part.data.calc_loop_triangles();triangles+=len(part.data.loop_triangles)
    catalog.append({'id':name,'sourceCollection':'KIT/'+name,'glb':'assets/models/'+name+'.glb','triangles':triangles,'materialSlots':len(asset['parts']),'origin':'sample-world-origin','stage':'environment-study'})
(SOURCE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf-8')

scene=bpy.context.scene
scene.world.use_nodes=True
world=scene.world.node_tree.nodes
sky=world.new('ShaderNodeTexSky')
sky.sky_type='MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in sky.bl_rna.properties['sky_type'].enum_items else 'NISHITA'
sky.sun_elevation=math.radians(35);sky.sun_rotation=math.radians(145)
scene.world.node_tree.links.new(sky.outputs['Color'],world.get('Background').inputs['Color']);world.get('Background').inputs['Strength'].default_value=.23
def area(name,p,energy,size,target):
    light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.shape='DISK';light.size=size
    obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=xyz(p);obj.rotation_euler=(Vector(xyz(target))-obj.location).to_track_quat('-Z','Y').to_euler()
area('large-warm-key',(-8,12,10),1600,7,(0,0,0))
area('sky-fill',(10,10,0),1100,10,(0,0,0))
bpy.ops.object.camera_add(location=xyz((14,9,20)))
camera=bpy.context.object;camera.name='Review camera';camera.rotation_euler=(Vector(xyz((-.8,1,-1)))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=42;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices:device.use=device.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-2
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(REVIEW/'blender-day.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'star-neighbors-art-sample.blend'))
if os.environ.get('STAR_NEIGHBORS_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
print(json.dumps({'assets':len(catalog),'instances':len(layout),'source':str(SOURCE/'star-neighbors-art-sample.blend')}))
