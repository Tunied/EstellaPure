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
mat('toolbody',(.12,.14,.16),.65,.35,texture='tool-metal.png')
mat('orange',(.67,.29,.045),.62,.38,texture='ochre.png')
mat('city',(.075,.10,.14),.25,.62)
for i in range(4):mat(f'haze{i}',(.10+i*.018,.16+i*.023,.23+i*.03),.1,.8,.18+i*.08)
mat('tarp',(.055,.064,.062),.05,.85,texture='tarp.png')
mat('leaflit',(.055,.18,.016),.05,.66,.08)
mat('roof',(.16,.21,.27),.78,.16,texture='roof.png')
mat('puddle',(.10,.13,.15),.35,.52)
mat('glass',(.018,.09,.13),.8,.12)
mat('leaf',(.08,.28,.045),.05,.68)
mat('leaflight',(.25,.43,.065),.05,.65)
mat('soil',(.04,.025,.018),0,.95)
mat('cyan',(.015,.65,.80),.25,.22,2.2)
mat('pink',(1,.018,.36),.2,.23,5)
mat('warm',(1,.48,.12),.1,.25,4)
mat('white',(.56,.75,1),.15,.25,2)
mat('windowWarm',(.85,.48,.20),.05,.4,1.8)
mat('windowCool',(.12,.28,.40),.05,.4,1.2)
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
    if group=='Habitat': verts=[(x*1.08,y*1.28,z) for x,y,z in verts]
    # The viaduct approaches the right foreground instead of lying parallel to the screen.
    if group in ('Rail','Train'): verts=[(x,y,z+(x-2)*.48) for x,y,z in verts]
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
    if len(points)>3:
        p=[Vector(points[0])]+[Vector(x) for x in points]+[Vector(points[-1])];smooth=[]
        for j in range(1,len(p)-2):
            for k in range(6):
                t=k/6;a,b,c,d=p[j-1:j+3]
                smooth.append(tuple(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)))
        points=smooth+[points[-1]]
    for a,b in zip(points,points[1:]): tube(a,b,r,m,8)

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
    for dx in [-.34,.34]:
        for dy in [.12,.88]:
            tube((x+dx*w,y+dy*h,z+d*.53),(x+dx*w,y+dy*h,z+d*.55),.022,'steel',8)
    box((x,y+h+.015,z),(w*.7,.04,d*.65),'toolbody')
    for dx in [-.25,.25]: box((x+dx*w,y+h+.04,z),(w*.07,.045,d*.9),'orange')

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
    for j in range(int(w/.46)):
        box((x-w/2+.12+j*.46,y+h/2,z+d/2+.012),(.055,h-.24,.035),'paint',False)
    for sy in [y+.08,y+h-.08]:
        for sz in [-1,1]: box((x,sy,z+sz*d/2),(w+.15,.16,.18),'dark')
    for sx in [-1,1]:
        for sz in [-1,1]: box((x+sx*(w/2-.07),y+h/2,z+sz*(d/2-.03)),(.20,h+.12,.20),'steel')
    for j in range(12): box((x-w/2+.25+j*.46,y+h+.02,z),(.045,.045,d),'steel',False)
    # Broad inset maintenance panels, hinge blocks, bolts and hazard tabs.
    for j in range(max(1,int(w/1.6))):
        px=x-w/2+.78+j*1.6
        box((px,y+h*.52,z+d/2+.04),(1.38,h*.77,.045),'dark')
        box((px,y+h*.52,z+d/2+.072),(1.28,h*.72,.045),'paint')
        for dx in [-.52,.52]:
            for dy in [.24,h-.24]: box((px+dx,y+dy,z+d/2+.11),(.08,.14,.07),'steel')
        box((px+.39,y+.36,z+d/2+.105),(.22,.13,.018),'orange')
    for sx in [-1,1]:
        for sy in [.17,h-.17]: box((x+sx*(w/2-.14),y+sy,z+d/2+.12),(.16,.23,.10),'orange')

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
for j in range(780):
    x,z=rng.uniform(-19,17),rng.uniform(-18,20); r=rng.uniform(.06,.72)
    v=[(x,.014,z)]+[(x+math.cos(k*math.pi/8)*r*rng.uniform(.6,1.2),.014,z+math.sin(k*math.pi/8)*r*.5*rng.uniform(.6,1.2)) for k in range(16)]
    emit('puddle',v,[[0,k+1,(k+1)%16+1] for k in range(16)])
for x in range(-20,20,2):
    tube((x,0,-20),(x,1.2,-20),.045)
    for h in [.35,1.15]: tube((x,h,-20),(x+2,h,-20),.04)
for z in range(-20,22,2):
    tube((19,0,z),(19,1.2,z),.05)
    for h in [.35,1.15]: tube((19,h,z),(19,h,z+2),.04)

# Modular safehouse: wide silhouette on the left, two levels and an open grow bay.
group='Habitat'
for x in [-12,-6,0]: container(x,.16,-7)
container(-6,3.12,-7)
container(-12,3.12,-8,w=5.8,h=2.8,d=2.6)
container(0,3.12,-8,w=5.8,h=2.5,d=2.6)
container(-2.6,5.98,-8,w=3.4,h=1.0,d=3.0)
# Recessed windows, access panels and conduits break up the repeating kit.
for x,y,z in [(-5.6,1.8,-4.61),(-4.9,4.55,-4.61),(-1.9,4.55,-6.61),(-2.6,6.5,-6.47)]:
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
    for x in [-9.2,-6.9,-4.6]:
        rack_height=2.60 if y<1 else 1.85
        for z in [-2.95,-4.2]:
            for dx in [-.94,.94]: tube((x+dx,y,z),(x+dx,y+rack_height,z),.035)
        for level in [.40]:
            box((x,y+level,-3.55),(1.95,.18,1.2),'steel')
            box((x,y+level+.10,-3.55),(1.80,.05,1.05),'soil')
            box((x,y+level+1.10,-3.55),(1.92,.045,.10),'pink')
            for j in range(6):
                box((x-.77+j*.31,y+level+.11,-3.55),(.27,.23,.95),'dark')
            for plant in range(19):
                px=x+rng.uniform(-.8,.8); pz=-3.55+rng.uniform(-.43,.43); py=y+level+.12
                height=rng.uniform(.35,.78); tube((px,py,pz),(px,py+height,pz),.013,'leaf',5)
                for k in range(7):
                    a=rng.uniform(0,6.28); h=py+height*k/6
                    tip=(px+math.cos(a)*.26,h+.12,pz+math.sin(a)*.26)
                    emit('leaflit' if k%2 else 'leaf',[(px,h,pz),(tip[0]-.09*math.sin(a),tip[1],tip[2]+.09*math.cos(a)),(tip[0],tip[1]+.07,tip[2]),(tip[0]+.09*math.sin(a),tip[1],tip[2]-.09*math.cos(a))],[[0,1,2],[0,2,3]])
    roof_height=2.65 if y<1 else 1.90
    box((-6.9,y+roof_height,-3.5),(7.1,.1,2.2),'dark')
    for x in [-9.2,-6.9,-4.6]:box((x,y+roof_height-.07,-2.34),(1.85,.045,.08),'warm')
for x in [-10.5,-3.4]: tube((x,.15,-2.3),(x,5.2,-2.3),.065)
# Sagging canvas, sewn strips and angled tension rods make the canopy asymmetric.
for side in [-1,1]:
    for j in range(12):
        a=j/12; b=(j+1)/12
        def tarp_point(t,z):
            return (-5.8+side*5.8*t,5.85-1.2*t-.16*math.sin(t*math.pi)+.045*math.sin(z*8+t*12),z)
        for k in range(9):
            za=-2.1-k*.46;zb=za-.46
            emit('tarp',[tarp_point(a,za),tarp_point(b,za),tarp_point(b,zb),tarp_point(a,zb)],[[0,1,2],[0,2,3]])
    for t in [.06,.5,.96]:
        cable([tarp_point(t,-2.1-k*.46) for k in range(10)],.015,'steel')
for x in [-11.6,-5.8,0]:
    y=5.85 if x==-5.8 else 4.65
    tube((x,y,-2.2),(x,y,-6.2),.045)
for z in [-2.25,-6.2]:
    tube((-11.6,4.65,z),(-5.8,5.85,z),.035)
    tube((-5.8,5.85,z),(0,4.65,z),.035)
box((-3.5,3.03,-4.1),(6.8,.12,1.0),'steel')
for x in [-6.8,-5,-3.5,-2,-.2]: tube((x,3.04,-3.65),(x,4,-3.65),.025)
for h in [3.48,4]: tube((-6.8,h,-3.65),(-.2,h,-3.65),.025)
for x in [2.3,2.9]: tube((x,.2,-4.32),(x,6.1,-4.32),.028)
for j in range(20): tube((2.3,.4+j*.28,-4.32),(2.9,.4+j*.28,-4.32),.022)

# Tanks, pumps, batteries, rooftop utilities and antennae.
for x,y,z in [(-14,1.8,-4.4),(-11.8,2.1,-4.35),(-2.8,1.3,-4.3),(1.9,4.5,-6.4)]:
    box((x,y,z),(.85,1.1,.2),'toolbody')
    for j in range(9):box((x,y-.39+j*.095,z+.12),(.69,.045,.07),'steel')
    for dx in [-.33,.33]:
        for dy in [-.44,.44]:tube((x+dx,y+dy,z+.15),(x+dx,y+dy,z+.17),.024,'orange',8)
for x in [-14.9,-13.4,-2.3,2.6]:
    cable([(x,.2,-4.4),(x,.8,-4.4),(x+.3,1.1,-4.4),(x+.3,2.5,-4.4),(x+.6,2.85,-4.4)],.045,'steel')
    for y in [.6,1.4,2.2]:box((x+.3,y,-4.3),(.17,.045,.06),'dark')
for x in [-13.5,-11.7,-1.5,1.8]:
    box((x,2.75,-4.35),(.3,.32,.27),'dark');box((x,2.68,-4.18),(.20,.08,.04),'warm')
# Communication dish and cable trays behind the canopy.
tube((-2.7,6,-7.8),(-2.7,7.55,-7.8),.055,'steel')
tube((-2.7,7.45,-7.8),(-2.7,7.45,-7.65),.61,'toolbody',40,.56)
for z in [-6,-8.6]:
    tube((-15,3,z),(2.8,3,z),.055,'steel')
for x,z,h,r,bottom in [(5.5,-5,2.35,.7,.2),(7,-6,2.7,.65,.2),(4,-8,5.7,.86,3.0),(-13,-2,1.8,.72,.2)]:
    tube((x,bottom,z),(x,h,z),r,'steel',40)
    for y in [bottom+.1,bottom+(h-bottom)*.33,bottom+(h-bottom)*.7,h-.1]:
        tube((x,y-.035,z),(x,y+.035,z),r+.04,'dark',24)
    tube((x,h,z),(x,h+.18,z),r,'paint',24,r*.85)
    cable([(x+r,.4,z),(x+r+.3,.4,z),(x+r+.3,h+.3,z),(x,h+.3,z)],.085,'steel')
    box((x,.9,z+r+.02),(.26,.30,.10),'dark')
    box((x,1.00,z+r+.08),(.15,.07,.02),'cyan')
    for j in range(8):
        a=j*math.pi/4
        tube((x+math.cos(a)*(r+.025),bottom+.1,z+math.sin(a)*(r+.025)),(x+math.cos(a)*(r+.025),h-.1,z+math.sin(a)*(r+.025)),.012,'dark',6)
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
group='World'
for j in range(15):
    x,z=rng.choice([(-16,4),(-14,-1),(10,-3),(15,7),(16,9)])
    crate(x+rng.uniform(-1.6,1.6),0,z+rng.uniform(-1.2,1.2),rng.uniform(.8,1.5),rng.uniform(.6,1.2),.9)
crate(-13,.85,-.2); crate(15,.9,7.2)
# Foreground framing: supply cases cut into both edges of the reference view.
crate(1.3,0,11,1.45,1.2,1.25);crate(-2.2,0,8.5,1.4,1.15,1.3)
crate(8.9,0,9.0,1.6,1.5,1.3);crate(10.5,0,9.0,1.7,1.6,1.3)
for k in range(5):
    cable([(-15+k*.14,.08,-3),(-15+k*.14,.08,0),(-13+k*.14,.08,3),(-13+k*.14,.08,7),(-9+k*.14,.08,11),(-7+k*.14,.08,17)],.04,'dark')
for x in [-16,9,17]: box((x,.25,-17),(1,.25,.3),'warm')
for k in range(3):
    cable([(-8+k*.13,.07,-1),(-7+k*.13,.07,1),(-8+k*.13,.07,3),(-4+k*.13,.07,4.5),(-3+k*.13,.07,6.5),(-.5+k*.13,.07,9),(2+k*.13,.07,11.4)],.045,'dark')
    cable([(-9+k*.13,.08,-1),(-10+k*.13,.08,2),(-4.5+k*.13,.08,3),(-4+k*.13,.08,6),(-1+k*.13,.08,8)],.025,'orange' if k==0 else 'dark')
box((1.0,.03,10.5),(1.1,.06,3.5),'dark')
for z in range(31):box((1.0,.08,8.8+z*.11),(1.0,.025,.035),'steel',False)
for x in [.42,1.58]:box((x,.065,10.5),(.07,.04,3.5),'steel')

# Layered city: varied setbacks, gaps, narrow warm windows and darker near silhouettes.
group='City'
for row in range(4):
    for col in range(13):
        x=-118+col*19+rng.uniform(-6,6); z=-61-row*31+rng.uniform(-9,9)
        w=rng.uniform(6,13); d=rng.uniform(8,17); h=rng.uniform(20,74)
        citymat=f'haze{row}'
        box((x,h/2-9,z),(w,h,d),citymat,False)
        box((x,h-8.4,z),(w*.65,1.2,d*.64),citymat)
        if col%2==0: box((x,h-5,z),(w*.33,5,d*.4),citymat)
        for xx in [x-w*.49,x+w*.49]: box((xx,h/2-9,z+d*.51),(.13,h,.18),'toolbody',False)
        # Windows use geometry rather than a flat skyline image.
        for ix in range(int(w/.85)):
            for iy in range(int(h/1.35)):
                choice=rng.random(); m='windowDark' if choice<.69 else ('windowWarm' if choice<.94 else 'windowCool')
                box((x-w/2+.5+ix*.85,-8+iy*1.35,z+d/2+.03),(.22,.38,.025),m,False)
                if ix<int(d/1.1) and iy%2==0:
                    box((x+w/2+.02,-8+iy*1.35,z-d/2+.6+ix*1.1),(.025,.35,.28),m,False)
        for j in range(3):
            box((x+w*.50,-1+j*6,z+d*.25),(1.0,.8,1.3),'steel')
        for yy in range(0,int(h)-9,7):
            box((x,yy,z+d/2+.04),(w+.12,.09,.18),'toolbody',False)
        for xx in [-.25,.25]: box((x+w*xx,h/2-9,z+d/2+.04),(.07,h,.16),'toolbody',False)
        if col%3!=0:
            sx=x+rng.choice([-1,1])*w*.32; sh=rng.uniform(6,12); sy=rng.uniform(4,max(5,h-sh/2-10))
            box((sx,sy,z+d*.5+.16),(1.55,sh+.2,.32),'toolbody')
            panel((sx,sy,z+d*.5+.34),1.45,sh,f'sign{(col+row)%6}')
        if col%4==0:
            box((x+w*.48,h/2-9,z+d*.52),(.035,h*.7,.06),'cyan')
            tube((x,h-8,z),(x,h-3,z),.05)
            box((x,h-3,z),(.09,.09,.09),'pink')
# Near right tower frames the elevated rail and portrait billboard.
box((26,19,-14),(11,50,12),'city',False)
for yy in range(-4,44,2):
    for xx in range(22,31,2): box((xx,yy,-7.97),(.8,.9,.05),'windowWarm' if rng.random()>.5 else 'windowDark',False)
panel((22.0,9,-7.87),2.7,8.6,'sign4')
box((15,20,-38),(4.7,11.1,.4),'steel')
panel((15,20,-37.76),4.6,11,'billboard')
box((-33,7.2,-20),(4.1,8.1,.4),'steel')
panel((-33,7.2,-19.76),4,8,'billboard')
# Close skyline on the left, with short signs between tall, narrow facades.
for x,h,z in [(-34,41,-32),(-43,32,-24),(-23,35,-40),(10,43,-59)]:
    box((x,h/2-6,z),(6.2,h,9),'city',False)
    for iy in range(int(h/1.2)):
        for ix in range(5):
            if rng.random()>.38: box((x-2.3+ix*1.05,-5+iy*1.2,z+4.53),(.25,.38,.02),'windowWarm',False)
    panel((x+2,13,z+4.58),1.6,12,f'sign{int(abs(x))%6}')

# Raised railway, cables and individually detailed train cars.
group='Rail'
box((20,6.2,-19),(40,.65,3.2),'steel')
for x in range(2,41,8):
    box((x,-3,-19),(.9,18,1.2),'dark')
    box((x,5.65,-19),(3.3,.40,3.4),'dark')
for z in [-20,-18]:
    tube((0,6.65,z),(40,6.65,z),.045)
    tube((0,9.9,z),(40,9.9,z),.018,'dark')
for x in range(1,41,3):
    box((x,6.07,-17.35),(.5,.06,.05),'warm')
    tube((x,5.8,-17.6),(x+2,6.4,-17.6),.045,'dark')
    tube((x,6.4,-17.6),(x+2,5.8,-17.6),.045,'dark')
group='Train'
for x in [5,12,19,26,33]:
    box((x,7.65,-19),(6.6,1.65,2.3),'toolbody')
    box((x,7.15,-17.83),(6.4,.12,.06),'pink')
    box((x,8.38,-17.83),(6.4,.055,.05),'cyan')
    for k in range(5):
        box((x-2.5+k*1.18,7.85,-17.81),(.87,.76,.03),'glass')
        box((x-2.5+k*1.18,8.17,-17.78),(.77,.05,.02),'windowCool')
    for dx in [-2.5,2.5]: tube((x+dx,6.9,-20),(x+dx,6.9,-18),.24,'dark',12)
    for dx in [-3.12,3.12]: box((x+dx,7.6,-17.79),(.035,1.4,.04),'cyan')
    box((x,8.55,-19),(4.5,.23,1.6),'steel')

# Holographic build preview is a real separate mesh; runtime moves and rotates it.
group='Ghost'
PW,PD=6.8,4.2
for y in [.10,.48]:
    for z in [-PD/2,PD/2]: box((0,y,z),(PW,.012,.012),'cyan',False)
    for x in [-PW/2,PW/2]: box((x,y,0),(.012,.012,PD),'cyan',False)
for x in [-PW/2,PW/2]:
    for z in [-PD/2,PD/2]:
        for dx in [-.10,.10]:
            for dz in [-.10,.10]: box((x+dx,.25,z+dz),(.010,.50,.010),'cyan',False)
        for h in [.01,.08,.48]:
            for dz in [-.20,.20]: box((x,h,z+dz),(.40,.010,.010),'cyan',False)
            for dx in [-.20,.20]: box((x+dx,h,z),(.010,.010,.40),'cyan',False)
for x in range(-3,4): box((x,.46,0),(.006,.006,PD),'cyan',False)
for z in range(-2,3): box((0,.46,z),(PW,.006,.006),'cyan',False)
for z in [-PD/2,PD/2]:
    for x in [-3,-2,-1,0,1,2,3]:
        box((x,.29,z),(.008,.34,.008),'cyan',False)
        for y in [.17,.40]:box((x+.18,y,z),(.05,.012,.012),'cyan',False)
group='GhostSurface';box((0,.45,0),(PW-.02,.015,PD-.02),'cyan',False)

# First-person construction tool and arm, authored in camera-local space.
group='Tool'
# An octagonal, layered receiver around the barrel instead of a box-shaped screen.
for za,zb,r,m in [(-1.18,-1.07,.115,'toolbody'),(-1.07,-1.02,.13,'steel'),(-1.02,-.84,.135,'orange'),(-.84,-.77,.15,'toolbody'),(-.77,-.55,.145,'orange')]:
    tube((.42,-.34,za),(.42,-.34,zb),r,m,8)
for x in [.285,.555]:
    box((x,-.34,-.77),(.04,.21,.40),'orange')
    for z in [-.97,-.83,-.65]:
        box((x,-.34,z),(.048,.24,.045),'toolbody')
        for y in [-.26,-.42]: tube((x-.024,y,z),(x+.024,y,z),.011,'steel',8)
for z in [-1.1,-1.04,-.92,-.84,-.76,-.65]: box((.42,-.205,z),(.19,.045,.028),'toolbody')
box((.42,-.34,-.52),(.245,.29,.09),'toolbody')
box((.42,-.34,-.466),(.198,.242,.025),'steel')
box((.42,-.34,-.45),(.178,.220,.018),'dark')
panel((.42,-.34,-.438),.162,.200,'display')
for x in [.315,.525]:
    for y in [-.215,-.465]: tube((x,y,-.47),(x,y,-.435),.012,'steel',8)
box((.42,-.51,-.54),(.19,.065,.09),'toolbody')
box((.42,-.50,-.486),(.10,.022,.018),'warm')
tube((.42,-.46,-.72),(.42,-.72,-.53),.073,'toolbody',8)
for k in range(5): tube((.42,-.50-k*.037,-.69+k*.027),(.42,-.515-k*.037,-.679+k*.027),.077,'dark',8)
cable([(.27,-.37,-1.01),(.22,-.46,-.98),(.23,-.58,-.78),(.28,-.60,-.66),(.30,-.44,-.61)],.014,'dark')
cable([(.29,-.39,-1.01),(.25,-.48,-.98),(.25,-.57,-.78),(.29,-.58,-.66),(.31,-.44,-.61)],.006,'orange')
# Glove, bent fingers, knuckle plates and a segmented fabric sleeve.
group='Glove'
box((.45,-.67,-.58),(.23,.15,.20),'dark',yaw=-.15)
for k in range(4):
    x=.345+k*.051;y=-.60+k*.012;z=-.66+k*.01
    tube((x,y,z+.075),(x,y+.035,z-.01),.029,'dark',12)
    tube((x,y+.035,z-.01),(x,y+.005,z-.09),.026,'dark',12)
    box((x,y+.053,z+.01),(.042,.028,.065),'toolbody')
    for zz in [z-.05,z-.075]: tube((x-.022,y+.014,zz),(x+.022,y+.014,zz),.004,'steel',6)
tube((.54,-.67,-.53),(.57,-.58,-.64),.038,'dark',16)
tube((.57,-.58,-.64),(.51,-.55,-.72),.033,'dark',16)
tube((.46,-.71,-.56),(.72,-1.02,-.12),.105,'dark',24,.175)
for j in range(7):
    t=j/7;a=(.48+t*.24,-.73-t*.29,-.54+t*.42);b=(a[0]+.014,a[1]-.020,a[2]+.027)
    tube(a,b,.114+t*.066,'toolbody' if j%3==0 else 'dark',24)
    if j in [0,4]: tube(b,(b[0]+.007,b[1]-.009,b[2]+.014),.12+t*.066,'orange',24)
for j in range(5): box((.50+j*.033,-.73-j*.043,-.43+j*.052),(.13,.045,.08),'toolbody',yaw=-.25)

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
