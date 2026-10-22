"""Build the editable rooftop kit and export material-batched glTF, headlessly.

Coordinates in authoring helpers are metres, Y up, camera facing -Z.
The .blend working source is written to output/; reproducible inputs live here.
"""
from pathlib import Path
import bpy, bmesh, math, random, json
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/models'
TEX=ROOT/'assets/textures'
WORK=ROOT.parents[1]/'output/cyber-rooftop'
OUT.mkdir(parents=True,exist_ok=True); WORK.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
rng=random.Random(7221)
materials={}; batches={}; group='World'

def mat(name,color,metal=.4,rough=.4,emission=0,texture=None):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1)
        p.inputs['Emission Strength'].default_value=emission
    if texture:
        t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=bpy.data.images.load(str(TEX/texture))
        m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
        if emission: m.node_tree.links.new(t.outputs['Color'],p.inputs['Emission Color'])
    materials[name]=m

mat('steel',(.48,.54,.57),.75,.29,texture='steel.png')
mat('paint',(.60,.58,.50),.22,.58,texture='worn-paint.png')
mat('dark',(.038,.060,.080),.12,.56,texture='rubber.png')
mat('toolbody',(.33,.40,.45),.55,.32)
mat('orange',(.72,.25,.035),.45,.35)
mat('roof',(.16,.21,.27),.78,.16,texture='roof.png')
mat('puddle',(.12,.18,.22),.95,.055)
mat('glass',(.018,.09,.13),.8,.12)
mat('leaf',(.08,.28,.045),.05,.68)
mat('leaflight',(.25,.43,.065),.05,.65)
mat('soil',(.04,.025,.018),0,.95)
mat('cyan',(.02,.72,1),.25,.22,4)
mat('pink',(1,.018,.36),.2,.23,5)
mat('warm',(1,.48,.12),.1,.25,4)
mat('white',(.56,.75,1),.15,.25,2)
mat('windowWarm',(.85,.48,.20),.05,.4,1.8)
mat('windowCool',(.12,.38,.64),.05,.4,1.7)
mat('windowDark',(.022,.045,.065),.55,.3)
mat('billboard',(1,1,1),0,.4,2.2,'billboard.png')
mat('display',(1,1,1),0,.4,2,'tool-display.png')
for i in range(6): mat(f'sign{i}',(1,1,1),0,.4,2.6,f'sign-{i}.png')

# One bevelled unit cube template reused across thousands of authored details.
bm=bmesh.new(); bmesh.ops.create_cube(bm,size=1)
bmesh.ops.bevel(bm,geom=list(bm.edges),offset=.035,segments=1,affect='EDGES')
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
CV=[tuple(v.co) for v in bm.verts]; CF=[[v.index for v in f.verts] for f in bm.faces]; bm.free()

def emit(name,verts,faces,uvs=None):
    key=(group,name); a=batches.setdefault(key,{'v':[],'f':[],'uv':[]})
    base=len(a['v']); a['v'].extend([(v[0],-v[2],v[1]) for v in verts])
    for i,f in enumerate(faces):
        a['f'].append([base+j for j in f])
        if uvs: a['uv'].append(uvs[i])
        else:
            # Box projection in world units preserves consistent surface grain.
            n=(Vector(verts[f[1]])-Vector(verts[f[0]])).cross(Vector(verts[f[2]])-Vector(verts[f[0]]))
            axis=max(range(3),key=lambda x:abs(n[x])); axes=[j for j in range(3) if j!=axis]
            a['uv'].append([(verts[j][axes[0]]*.28,verts[j][axes[1]]*.28) for j in f])

def box(p,s,m='steel',bevel=True,yaw=0):
    v=CV if bevel else [(-.5,-.5,-.5),(.5,-.5,-.5),(.5,.5,-.5),(-.5,.5,-.5),(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)]
    f=CF if bevel else [[3,2,1,0],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
    c,t=math.cos(yaw),math.sin(yaw)
    emit(m,[(p[0]+a*s[0]*c+d*s[2]*t,p[1]+b*s[1],p[2]-a*s[0]*t+d*s[2]*c) for a,b,d in v],f)

def tube(a,b,r,m='steel',segments=10,r2=None):
    a,b=Vector(a),Vector(b); n=(b-a).normalized()
    u=n.cross(Vector((0,1,0)) if abs(n.y)<.95 else Vector((1,0,0))).normalized(); w=n.cross(u)
    v=[]
    for center,rad in [(a,r),(b,r if r2 is None else r2)]:
        for j in range(segments):
            t=j*2*math.pi/segments; v.append(tuple(center+rad*(math.cos(t)*u+math.sin(t)*w)))
    f=[list(reversed(range(segments))),list(range(segments,segments*2))]
    f += [[j,(j+1)%segments,(j+1)%segments+segments,j+segments] for j in range(segments)]
    emit(m,v,f)

def cable(points,r=.035,m='dark'):
    for a,b in zip(points,points[1:]): tube(a,b,r,m,6)

def panel(p,w,h,m,yaw=0):
    c,s=math.cos(yaw),math.sin(yaw)
    v=[(p[0]+x*c,p[1]+y,p[2]-x*s) for x,y in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]]
    emit(m,v,[[0,1,2,3]],[[(0,0),(1,0),(1,1),(0,1)]])

def crate(x,y,z,w=1.1,h=.8,d=.8):
    box((x,y+h/2,z),(w,h,d),'dark')
    box((x,y+h*.55,z+d*.505),(w*.80,h*.65,.035),'paint')
    for sx in [-1,1]:
        box((x+sx*w*.41,y+h/2,z),(w*.12,h*1.03,d*1.05),'steel')
        box((x+sx*w*.41,y+h*.56,z+d*.54),(.07,.17,.04),'orange')
    box((x,y+h*.6,z+d*.53),(.27,.05,.03),'cyan')

def ac(x,y,z):
    box((x,y,z),(1.15,1.05,.50),'paint')
    tube((x,y,z+.26),(x,y,z+.31),.40,'dark',20)
    tube((x,y,z+.30),(x,y,z+.35),.09,'steel',12)
    for j in range(8):
        a=j*math.pi/4
        tube((x+math.cos(a)*.10,y+math.sin(a)*.10,z+.34),(x+math.cos(a+.4)*.34,y+math.sin(a+.4)*.34,z+.34),.04,'steel',6)
    for j in range(9): box((x,y-.38+j*.095,z+.37),(.80,.013,.012),'dark',False)

def container(x,y,z,w=5.8,h=2.8,d=4.6):
    box((x,y+h/2,z),(w,h,d),'paint')
    # Front corrugation, structural corner rails and seam hardware.
    for j in range(int(w/.20)):
        box((x-w/2+.1+j*.20,y+h/2,z+d/2+.025),(.06,h-.22,.08),'steel',False)
    for sy in [y+.08,y+h-.08]:
        for sz in [-1,1]: box((x,sy,z+sz*d/2),(w+.15,.16,.18),'dark')
    for sx in [-1,1]:
        for sz in [-1,1]: box((x+sx*(w/2-.07),y+h/2,z+sz*(d/2-.03)),(.20,h+.12,.20),'steel')
    for j in range(12): box((x-w/2+.25+j*.46,y+h+.02,z),(.045,.045,d),'steel',False)

# Roof deck, drainage grilles, expansion joints and puddles.
group='Deck'; box((-1,-.19,0),(42,.36,44),'roof',False)
group='World'
for x in range(-20,20,4):
    box((x,.006,0),(.018,.015,44),'dark',False)
for z in range(-20,22,4): box((-1,.007,z),(42,.015,.016),'dark',False)
for x in [-16,12]:
    box((x,.018,4),(.45,.04,34),'dark')
    for z in range(-12,21):
        for k in range(5): box((x,.046,z+k*.16),(.41,.018,.035),'steel',False)
for j in range(150):
    x,z=rng.uniform(-19,17),rng.uniform(-18,20); r=rng.uniform(.25,1.8)
    v=[(x,.014,z)]+[(x+math.cos(k*math.pi/8)*r*rng.uniform(.6,1.2),.014,z+math.sin(k*math.pi/8)*r*.5*rng.uniform(.6,1.2)) for k in range(16)]
    emit('puddle',v,[[0,k+1,(k+1)%16+1] for k in range(16)])
for x in range(-20,20,2):
    tube((x,0,-20),(x,1.2,-20),.045)
    for h in [.35,1.15]: tube((x,h,-20),(x+2,h,-20),.04)
for z in range(-20,22,2):
    tube((19,0,z),(19,1.2,z),.05)
    for h in [.35,1.15]: tube((19,h,z),(19,h,z+2),.04)

# Modular safehouse: wide silhouette on the left, two levels and an open grow bay.
for x in [-12,-6,0]: container(x,.16,-7)
container(-6,3.12,-7)
container(-12,3.12,-8,w=5.8,h=2.8,d=2.6)
container(0,3.12,-8,w=5.8,h=2.5,d=2.6)
container(-2.6,5.98,-8,w=3.4,h=1.8,d=3.0)
# Recessed windows, access panels and conduits break up the repeating kit.
for x,y,z in [(-5.6,1.8,-4.61),(-4.9,4.55,-4.61),(-1.9,4.55,-6.61),(-2.6,6.9,-6.47)]:
    box((x,y,z),(1.65,1.05,.17),'dark')
    box((x,y,z+.10),(1.40,.80,.04),'glass')
    box((x,y+.36,z+.13),(1.33,.045,.03),'warm')
    box((x,y,z+.15),(.055,.8,.04),'steel')
    box((x,y-.42,z+.12),(1.7,.06,.24),'steel')
for x,y in [(-6.7,.6),(-3.4,1.7),(-2.8,3.9),(2.1,1.2),(-11.9,4.8)]:
    box((x,y,-4.5),(.58,.78,.17),'dark')
    box((x,y,-4.39),(.49,.65,.04),'paint')
    for j in range(6): box((x,y-.24+j*.09,-4.35),(.36,.022,.025),'dark',False)
    for dx in [-.21,.21]:
        for dy in [-.28,.28]: tube((x+dx,y+dy,-4.34),(x+dx,y+dy,-4.31),.022,'steel',6)
for h in [.4,2.94,5.85]:
    cable([(-14.8,h,-4.5),(-8,h,-4.5),(-7.7,h+.13,-4.5),(-2,h+.13,-4.5),(2.8,h,-4.5)],.045,'dark')
    tube((-14.8,h+.13,-4.5),(2.8,h+.13,-4.5),.026,'steel')
for j in range(8):
    x=-6.6+j*.19
    cable([(x,5.8,-4.48),(x,3.5,-4.48),(x+.18,3.2,-4.48),(x+.18,1.2,-4.48)],.018,'dark')
for x in [-14,-7,2.7]:
    box((x,2.8,-4.35),(.28,.50,.3),'dark')
    box((x,2.76,-4.17),(.17,.20,.03),'warm')
# Front entrance, inset door, conduits and stair treads.
box((.2,1.6,-4.60),(1.8,2.75,.17),'dark')
box((.2,1.5,-4.49),(1.30,2.30,.08),'steel')
box((.2,2.25,-4.42),(.96,.53,.025),'glass')
for x in [-.56,.96]: box((x,1.6,-4.39),(.05,2.6,.04),'warm')
box((.2,2.94,-4.36),(1.8,.085,.10),'warm')
for i in range(4):
    box((.2,.08+i*.09,-3.4-i*.25),(2.4,.16,.38),'steel')
    box((.2,.17+i*.09,-3.23-i*.25),(2.3,.02,.03),'warm')
for x in [-1.1,1.5]:
    tube((x,.12,-3.1),(x,1.18,-3.1),.035)
    tube((x,1.18,-3.1),(x,1.48,-4.5),.035)
for x in [-13.8,-9.2,-3.0,2.8]:
    cable([(x,.2,-4.49),(x,.6,-4.49),(x+.18,.9,-4.49),(x+.18,2.5,-4.49),(x+.5,2.8,-4.49)],.04)
    box((x,1.3,-4.31),(.40,.65,.22),'dark')
    box((x,1.48,-4.18),(.20,.06,.03),'cyan')
for x in [-11,-7,0]: ac(x,4.55,-6.5)

# Plant racks: open framework, individual leaves and pink tube lights.
for y in [.3,3.08]:
    for x in [-12.8,-10.5,-8.2]:
        for z in [-2.95,-4.2]:
            for dx in [-.94,.94]: tube((x+dx,y,z),(x+dx,y+2.60,z),.035)
        for level in [.3,1.32]:
            box((x,y+level,-3.55),(1.95,.18,1.2),'steel')
            box((x,y+level+.10,-3.55),(1.80,.05,1.05),'soil')
            box((x,y+level+.92,-3.55),(1.92,.055,.10),'pink')
            for plant in range(10):
                px=x+rng.uniform(-.8,.8); pz=-3.55+rng.uniform(-.43,.43); py=y+level+.12
                height=rng.uniform(.2,.46); tube((px,py,pz),(px,py+height,pz),.013,'leaf',5)
                for k in range(5):
                    a=rng.uniform(0,6.28); h=py+height*k/6
                    tip=(px+math.cos(a)*.22,h+.12,pz+math.sin(a)*.22)
                    emit('leaflight' if k%2 else 'leaf',[(px,h,pz),(tip[0]-.06*math.sin(a),tip[1],tip[2]+.06*math.cos(a)),(tip[0],tip[1]+.04,tip[2]),(tip[0]+.06*math.sin(a),tip[1],tip[2]-.06*math.cos(a))],[[0,1,2,3]])
    box((-10.5,y+2.65,-3.5),(7.1,.1,2.2),'dark')
    box((-10.5,y+2.58,-2.34),(6.9,.06,.08),'warm')
for x in [-14.1,-7]: tube((x,.15,-2.3),(x,6.25,-2.3),.07)
box((-10.5,6.1,-4),(7.8,.12,4),'dark',yaw=.03)
emit('dark',[(-14.6,5.98,-2.1),(-10.7,6.95,-3.2),(-6.7,5.98,-2.1),(-14.6,5.98,-6.2),(-10.7,6.95,-6.2),(-6.7,5.98,-6.2)],[[0,1,4,3],[1,2,5,4]])
for x in [-14.6,-10.7,-6.7]:
    y=6.95 if x==-10.7 else 5.98
    tube((x,y,-2.2),(x,y,-6.2),.045)
for z in [-2.25,-6.2]:
    tube((-14.6,6,z),(-10.7,6.95,z),.035)
    tube((-10.7,6.95,z),(-6.7,6,z),.035)
box((-3.5,3.03,-4.1),(6.8,.12,1.0),'steel')
for x in [-6.8,-5,-3.5,-2,-.2]: tube((x,3.04,-3.65),(x,4,-3.65),.025)
for h in [3.48,4]: tube((-6.8,h,-3.65),(-.2,h,-3.65),.025)
for x in [2.3,2.9]: tube((x,.2,-4.32),(x,6.1,-4.32),.028)
for j in range(20): tube((2.3,.4+j*.28,-4.32),(2.9,.4+j*.28,-4.32),.022)

# Tanks, pumps, batteries, rooftop utilities and antennae.
for x,z,h,r in [(5,-5,3.7,.8),(7,-6,2.7,.65),(4,-8,5,.86),(-1,-7,7,.65)]:
    tube((x,.2,z),(x,h,z),r,'steel',24)
    for y in [.3,h*.33,h*.7,h-.1]:
        tube((x,y-.035,z),(x,y+.035,z),r+.04,'dark',24)
    tube((x,h,z),(x,h+.18,z),r,'paint',24,r*.85)
    cable([(x+r,.4,z),(x+r+.3,.4,z),(x+r+.3,h+.3,z),(x,h+.3,z)],.085,'steel')
    box((x,.9,z+r+.02),(.26,.30,.10),'dark')
    box((x,1.00,z+r+.08),(.15,.07,.02),'cyan')
for x in [3.7,5.5,7.3]:
    box((x,.6,-2.9),(1.3,1.15,.8),'dark')
    for j in range(6): box((x-.48+j*.19,.62,-2.47),(.09,.8,.05),'steel')
    box((x,1.21,-2.9),(1.25,.07,.76),'paint')
    box((x,.96,-2.42),(.18,.05,.025),'cyan')
for x,z in [(-14,-7),(-5,-8),(2,-8)]:
    tube((x,5.6,z),(x,9.6,z),.07)
    for h in [7,7.5,8,8.5]: tube((x-.6,h,z),(x+.6,h,z),.025)
    box((x+.20,8.6,z),(.18,1.2,.22),'dark')
    box((x,9.68,z),(.06,.09,.06),'pink')
for j in range(15):
    x,z=rng.choice([(-16,4),(-14,-1),(10,-3),(15,7),(16,9)])
    crate(x+rng.uniform(-1.6,1.6),0,z+rng.uniform(-1.2,1.2),rng.uniform(.8,1.5),rng.uniform(.6,1.2),.9)
crate(-13,.85,-.2); crate(15,.9,7.2)
for k in range(5):
    cable([(-15+k*.14,.08,-3),(-15+k*.14,.08,0),(-13+k*.14,.08,3),(-13+k*.14,.08,7),(-9+k*.14,.08,11),(-7+k*.14,.08,17)],.04,'dark')
for x in [-16,9,17]: box((x,.25,-17),(1,.25,.3),'warm')

# Fully modelled skyline, window grids, roof setbacks and long vertical signs.
for row in range(3):
    for col in range(14):
        x=-100+col*15+rng.uniform(-3,3); z=-58-row*27+rng.uniform(-4,4)
        w=rng.uniform(7,12); d=rng.uniform(7,13); h=rng.uniform(36,100)
        box((x,h/2-5,z),(w,h,d),'dark',False)
        box((x,h-4.5,z),(w*.73,1.1,d*.74),'steel')
        for xx in [x-w*.49,x+w*.49]: box((xx,h/2-5,z+d*.51),(.15,h,.18),'steel',False)
        # Windows use geometry rather than a flat skyline image.
        for ix in range(int(w/1.05)):
            for iy in range(int(h/1.6)):
                choice=rng.random(); m='windowDark' if choice<.60 else ('windowWarm' if choice<.84 else 'windowCool')
                box((x-w/2+.6+ix*1.05,-4+iy*1.6,z+d/2+.03),(.40,.75,.045),m,False)
        for j in range(3):
            box((x+w*.50,-1+j*6,z+d*.25),(1.0,.8,1.3),'steel')
        for yy in range(0,int(h)-5,6):
            box((x,yy,z+d/2+.04),(w+.12,.13,.18),'steel',False)
        for xx in [-.25,.25]: box((x+w*xx,h/2-5,z+d/2+.04),(.10,h,.16),'steel',False)
        if col%3!=0:
            sx=x+rng.choice([-1,1])*w*.32; sh=rng.uniform(7,16); sy=rng.uniform(8,h-sh/2-3)
            box((sx,sy,z+d*.5+.16),(2.15,sh+.2,.32),'steel')
            panel((sx,sy,z+d*.5+.34),2,sh,f'sign{(col+row)%6}')
        if col%4==0:
            box((x+w*.48,h/2-5,z+d*.52),(.08,h,.09),'cyan')
            tube((x,h-4,z),(x,h+3,z),.08)
            box((x,h+3,z),(.12,.12,.12),'pink')
# Near right tower frames the elevated rail and portrait billboard.
box((26,19,-14),(11,50,12),'dark',False)
for yy in range(-4,44,2):
    for xx in range(22,31,2): box((xx,yy,-7.97),(.8,.9,.05),'windowWarm' if rng.random()>.5 else 'windowDark',False)
panel((22.0,14,-7.87),2.9,13,'sign4')
box((12,22,-32),(7.1,15.1,.4),'steel')
panel((12,22,-31.76),7,15,'billboard')
box((-28,15,-20),(6.1,12.1,.4),'steel')
panel((-28,15,-19.76),6,12,'billboard')

# Raised railway, cables and individually detailed train cars.
box((20,6.2,-19),(40,.65,3.2),'steel')
for x in range(2,41,8):
    box((x,-3,-19),(.9,18,1.2),'dark')
    box((x,5.65,-19),(3.3,.40,3.4),'dark')
for z in [-20,-18]:
    tube((0,6.65,z),(40,6.65,z),.045)
    tube((0,9.9,z),(40,9.9,z),.018,'dark')
for x in range(1,41,3):
    box((x,6.07,-17.35),(.5,.06,.05),'warm')
group='Train'
for x in [5,12,19,26,33]:
    box((x,7.65,-19),(6.6,1.65,2.3),'steel')
    box((x,7.15,-17.83),(6.4,.12,.06),'pink')
    box((x,8.38,-17.83),(6.4,.055,.05),'cyan')
    for k in range(5):
        box((x-2.5+k*1.18,7.85,-17.81),(.87,.76,.03),'glass')
        box((x-2.5+k*1.18,8.17,-17.78),(.77,.05,.02),'windowCool')
    for dx in [-2.5,2.5]: tube((x+dx,6.9,-20),(x+dx,6.9,-18),.24,'dark',12)

# Holographic build preview is a real separate mesh; runtime moves and rotates it.
group='Ghost'
for y in [.06,.32]:
    for z in [-1.7,1.7]: box((0,y,z),(5.8,.018,.018),'cyan',False)
    for x in [-2.9,2.9]: box((x,y,0),(.018,.018,3.4),'cyan',False)
for x in [-2.9,2.9]:
    for z in [-1.7,1.7]:
        box((x,.19,z),(.035,.30,.035),'cyan',False)
        box((x,0,z),(.38,.014,.38),'cyan',False)
for x in range(-5,6): box((x*.5,.11,0),(.007,.007,3.4),'cyan',False)
for z in range(-3,4): box((0,.11,z*.5),(5.8,.007,.007),'cyan',False)

# First-person construction tool and arm, authored in camera-local space.
group='Tool'
box((.42,-.36,-.78),(.29,.31,.50),'toolbody')
box((.42,-.34,-.84),(.31,.20,.42),'orange')
for sx in [.28,.56]:
    box((sx,-.34,-.84),(.045,.25,.46),'steel')
for zz in [-.97,-.85,-.73]: box((.42,-.235,zz),(.29,.035,.045),'dark')
box((.42,-.33,-.505),(.23,.27,.025),'dark')
panel((.42,-.32,-.488),.18,.205,'display')
for x in [.285,.555]:
    box((x,-.32,-.53),(.04,.29,.12),'toolbody')
    box((x,-.32,-.46),(.027,.22,.025),'orange')
box((.42,-.17,-.56),(.30,.045,.18),'toolbody')
box((.42,-.475,-.56),(.30,.04,.16),'orange')
for x in [.31,.53]:
    for y in [-.19,-.45]: tube((x,y,-.46),(x,y,-.445),.013,'steel',8)
for x in [.26,.58]: tube((x,-.30,-.97),(x,-.30,-.64),.035,'steel',12)
tube((.42,-.39,-.84),(.42,-.64,-.71),.065,'dark',10)
box((.42,-.60,-.72),(.20,.15,.20),'dark')
for k in range(4): tube((.34+k*.047,-.51,-.71),(.34+k*.047,-.55,-.81),.024,'steel',8)
tube((.44,-.66,-.69),(.69,-.99,-.12),.11,'dark',16,.17)
for j in range(4): tube((.48+j*.04,-.70-j*.05,-.58+j*.08),(.50+j*.04,-.73-j*.05,-.53+j*.08),.125,'steel',12)

# Export one mesh per material per logical group to keep draw calls bounded.
roots={}
for (g,m),a in batches.items():
    root=roots.get(g)
    if root is None:
        root=bpy.data.objects.new(g,None); bpy.context.collection.objects.link(root); roots[g]=root
    mesh=bpy.data.meshes.new(f'{g}_{m}'); mesh.from_pydata(a['v'],[],a['f']); mesh.update()
    obj=bpy.data.objects.new(f'{g}_{m}',mesh); bpy.context.collection.objects.link(obj); obj.parent=root
    obj.data.materials.append(materials[m]); uv=mesh.uv_layers.new(name='UVMap')
    for poly,coords in zip(mesh.polygons,a['uv']):
        for li,co in zip(poly.loop_indices,coords): uv.data[li].uv=co
    # Weighted face normals keep bevels shaded while broad walls remain flat.
    for p in mesh.polygons: p.use_smooth=False

bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'cyber-rooftop.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'rooftop.glb'),export_format='GLB',export_yup=True,export_cameras=False,export_lights=False,export_materials='EXPORT')
stats={'groups':list(roots),'meshBatches':len(batches),'vertices':sum(len(a['v']) for a in batches.values()),'faces':sum(len(a['f']) for a in batches.values())}
(OUT/'geometry.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
