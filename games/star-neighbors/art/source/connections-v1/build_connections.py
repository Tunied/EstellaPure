"""Art authoring only: repeatable connections, an L-shaped home and raised terrace.

All source dimensions are metres, Z up. Existing habitat and garden meshes are
loaded as dependencies, never stretched or overwritten. No runtime code.
"""
from pathlib import Path
KIT_SLUG='connections-v1'
helper=Path(__file__).resolve().parent.parent/'habitat-v2/build_habitat.py'
exec(compile(helper.read_text(encoding='utf-8').split('# -- End shared art helpers --')[0],str(helper),'exec'))
scene.name='Connections / home, passage, garden and terrace'

def prism(name,points,z0,z1,mat,r=0):
    k=len(points);vs=[(x,y,z) for z in (z0,z1) for x,y in points]
    fs=[tuple(range(k-1,-1,-1)),tuple(range(k,2*k))]
    fs += [(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
    return mesh(name,vs,fs,mat,r)

# A concave corner consumes the first two metres of BOTH adjoining boundary
# runs. It mates at (2,.5) and (.5,2); unlike an outward corner it cannot simply
# be mirrored. The central habitat floor grid remains untouched.
guide=[(2,.5,0,-1)]
for i in range(25):
    a=-math.pi/2-i*math.pi/48
    guide.append((1+.5*math.cos(a),1+.5*math.sin(a),math.cos(a),math.sin(a)))
guide.append((.5,2,-1,0))

def sweep(name,profile,mat):
    n=len(profile);vs=[(x+nx*d,y+ny*d,z) for x,y,nx,ny in guide for d,z in profile]
    fs=[tuple(range(n-1,-1,-1)),tuple(range((len(guide)-1)*n,len(guide)*n))]
    for i in range(len(guide)-1):
        for j in range(n):
            a=i*n+j;b=i*n+(j+1)%n;fs.append((a,b,b+n,a+n))
    return mesh(name,vs,fs,mat)

footprint=[(0,0),(2,0)]+[(x,y) for x,y,_,_ in guide]+[(0,2)]
wedge=[(0,0)]+[(1+math.cos(-math.pi/2-i*math.pi/48),1+math.sin(-math.pi/2-i*math.pi/48)) for i in range(25)]
corner_sockets={'front':[2,.5,0],'side':[.5,2,0],'gridCorner':[0,0,0]}
start('foundation-inner-corner-2m')
prism('Concave foundation tray',footprint,0,.17,DARK)
prism('Concave floor infill',footprint,.17,.21,PAINT)
sweep('Continuous outer drain',[(-.018,.09),(0,.09),(0,.13),(-.018,.13)],RUBBER)
finish(current,[2,2,.21],corner_sockets)

start('wall-inner-corner-2m')
sweep('Insulated concave wall',[(0,0),(.22,0),(.22,2.8),(0,2.8)],INNER)
sweep('Warm external skin',[(-.02,.20),(.015,.20),(.015,2.75),(-.02,2.75)],PAINT)
sweep('Continuous enamel stripe',[(-.06,2.50),(-.02,2.50),(-.02,2.63),(-.06,2.63)],ORANGE)
sweep('Lower shadow reveal',[(-.031,.44),(-.018,.44),(-.018,.46),(-.031,.46)],DARK)
sweep('Protective foot rail',[(-.025,.015),(.12,.015),(.12,.20),(-.025,.20)],DARK)
for x in [1.22,1.78]:screw(x,.57,2.56)
o=panel('Corner service hatch',.64,.88,.10,(1.50,1.35),-.04,.03,PAINT)
o.location.y=.50;o.rotation_euler.z=math.pi
# The hatch above uses its own local x centre, so restore its front-wall centre.
o.location.x=3.0
text3d('INNER / 01',(1.50,.532,.69),.045,INK,rotation=(math.pi/2,0,math.pi))
finish(current,[2,2,2.8],{**corner_sockets,'roof':[0,0,2.8]})

start('roof-inner-corner-2m')
profile=[(.5-.5*math.cos(i*math.pi/48),.5*math.sin(i*math.pi/48)) for i in range(25)]+[(.5,.28),(.15,0)]
sweep('Concave rolled shoulder',profile,PAINT)
prism('Inner roof wedge',wedge,.28,.50,PAINT)
sweep('Eave gasket',[(-.016,0),(.015,0),(.015,.04),(-.016,.04)],RUBBER)
sweep('Continuous eave ribbon',[(-.055,.04),(-.012,.04),(-.012,.10),(-.055,.10)],ORANGE)
finish(current,[2,2,.50],corner_sockets)

start('junction-frame-2m')
frame('Passage insulated surround',(1.986,2.8,.06),(1.68,2.56,.18),(0,1.30),0,.22,INNER,(0,1.4))
frame('Passage exterior shell',(1.97,2.76,.08),(1.67,2.55,.18),(0,1.30),-.025,.055,PAINT,(0,1.4))
frame('Passage sealing band',(1.77,2.65,.23),(1.60,2.48,.14),(0,1.26),-.06,.13,DARK)
frame('Passage rolled lip',(1.86,2.72,.26),(1.77,2.63,.22),(0,1.30),-.09,.055,ORANGE)
box('Flush threshold',(0,.06,.011),(1.62,.38,.022),METAL,.006)
box('Header status',(0,-.07,2.67),(.35,.03,.026),CYAN,.008)
for x in [-.93,.93]:box('Vertical joint cover',(x,-.025,1.4),(.06,.07,2.72),PAINT,.018)
finish(current,[2,.3,2.8],{'left':[-1,0,0],'right':[1,0,0],'passage':[0,0,0],'roof':[0,0,2.8]})

start('dock-head-2m')
box('Insulated docking header',(0,.12,.25),(1.99,.68,.50),INNER,.025)
box('Upper weather cap',(0,.10,.49),(2.06,.75,.05),PAINT,.02)
box('Exterior collar face',(0,-.235,.22),(2.05,.06,.40),PAINT,.025)
box('Enamel locator',(0,-.272,.20),(.92,.025,.055),ORANGE,.012)
text3d('LINK / 02',(0,-.289,.29),.055)
for x in [-.87,.87]:screw(x,-.272,.24)
finish(current,[2,.75,.515],{'wallTop':[0,0,0],'roofTop':[0,0,.5]})

start('corridor-wall-glass-2m')
frame('Passage glass frame',(1.986,2.8,.05),(1.75,2.22,.16),(0,1.51),0,.16,PAINT,(0,1.4))
frame('Glazing seal',(1.80,2.27,.185),(1.73,2.20,.15),(0,1.51),-.025,.055,RUBBER)
panel('Passage glass',1.76,2.23,.165,(0,1.51),.045,.012,GLASS)
box('Lower chassis',(0,.03,.13),(1.98,.19,.26),DARK,.028)
box('Bumper stripe',(0,-.07,.29),(1.92,.045,.075),ORANGE,.014)
box('Wall top rail',(0,.02,2.74),(1.98,.23,.12),PAINT,.024)
for x in [-.94,.94]:box('Joint strip',(x,-.02,1.4),(.065,.06,2.68),PAINT,.018)
text3d('PASSAGE',(0,-.100,.285),.042,WHITE)
finish(current,[2,.23,2.8],{'left':[-1,0,0],'right':[1,0,0],'roof':[0,0,2.8]})

start('corridor-roof-2m')
box('Flat junction canopy',(0,0,.23),(2,2,.46),INNER,.035)
box('Weather panel',(0,0,.477),(1.984,1.984,.046),PAINT,.022)
for y in [-.94,.94]:box('Recessed roof joint',(0,y,.502),(1.84,.016,.005),DARK,.001)
box('Light socket',(0,0,-.016),(.17,1.65,.032),DARK,.01)
box('Passage diffuser',(0,0,-.036),(.10,1.50,.018),LAMP,.006)
finish(current,[2,2,.54],{'north':[0,1,0],'south':[0,-1,0],'east':[1,0,0],'west':[-1,0,0]})

start('junction-post')
box('Corner spine',(0,0,1.4),(.18,.18,2.8),PAINT,.035)
for z in [.13,2.70]:box('Corner shoe',(0,0,z),(.23,.23,.20),DARK,.025)
box('Corner enamel collar',(0,0,.29),(.21,.21,.075),ORANGE,.018)
finish(current,[.23,.23,2.8],{'floor':[0,0,0],'ceiling':[0,0,2.8]})

start('deck-floor-2m')
box('Terrace tray',(0,0,.075),(2,2,.15),DARK,.025)
for i in range(8):
    y=-.875+i*.25
    box('Individual tread plank',(0,y,.179),(1.976,.238,.062),PAINT,.012)
    for x in [-.92,.92]:cylinder('Recessed deck fastener',(x,y,.207),(x,y,.213),.014,METAL,12)
for x in [-.80,.80]:box('Drainage channel',(x,0,.212),(.025,1.90,.004),DARK,.001)
finish(current,[2,2,.21],{'north':[0,1,0],'south':[0,-1,0],'east':[1,0,0],'west':[-1,0,0],'top':[0,0,.21]})

start('deck-edge-2m')
box('Edge fascia',(0,.015,.09),(1.98,.09,.18),PAINT,.018)
box('Orange edge inset',(0,-.035,.11),(1.88,.023,.045),ORANGE,.008)
box('Underside drain',(0,-.025,.018),(1.95,.06,.028),DARK,.005)
for x in [-.85,.85]:screw(x,-.049,.11)
finish(current,[2,.10,.19],{'left':[-1,0,0],'right':[1,0,0]})

start('deck-corner-cap')
box('Corner trim',(0,0,.09),(.12,.12,.18),PAINT,.02)
box('Corner marker',(0,0,.11),(.125,.125,.04),ORANGE,.012)
finish(current,[.13,.13,.18],{'corner':[0,0,0]})

start('deck-rail-2m')
box('Top handrail',(0,0,1.035),(1.89,.11,.09),PAINT,.035)
box('Orange underside',(0,0,.98),(1.82,.075,.03),ORANGE,.01)
box('Lower guard rail',(0,0,.20),(1.88,.08,.07),DARK,.02)
panel('Wind glass',1.78,.69,.04,(0,.59),-.013,.026,GLASS)
for x in [-.82,.82]:
    for z in [.26,.91]:box('Glass clamp',(x,0,z),(.065,.065,.08),METAL,.014)
finish(current,[2,.11,1.08],{'left':[-1,0,0],'right':[1,0,0]})

start('deck-post-105')
box('Post foot',(0,0,.035),(.20,.20,.07),METAL,.022)
box('Post shaft',(0,0,.55),(.095,.095,1.03),DARK,.025)
box('Post upper cap',(0,0,1.04),(.14,.14,.10),PAINT,.03)
box('Locator band',(0,0,.18),(.105,.105,.06),ORANGE,.013)
finish(current,[.20,.20,1.09],{'base':[0,0,0],'rail':[0,0,1.035]})

start('support-foot-020')
box('Ground bearing pad',(0,0,.045),(.44,.44,.09),DARK,.04)
cylinder('Threaded seat',(0,0,.09),(0,0,.20),.11,METAL)
box('Support collar',(0,0,.17),(.25,.25,.06),ORANGE,.018)
for x in [-.15,.15]:
    for y in [-.15,.15]:cylinder('Anchor bolt',(x,y,.085),(x,y,.10),.024,METAL,12)
finish(current,[.44,.44,.20],{'ground':[0,0,0],'riser':[0,0,.20]})

start('support-riser-040')
box('Support web',(0,0,.20),(.15,.15,.40),DARK,.018)
for z in [.035,.365]:box('Splice flange',(0,0,z),(.28,.28,.07),METAL,.02)
for x in [-.095,.095]:box('Support jacket',(x,0,.20),(.035,.17,.24),PAINT,.012)
finish(current,[.28,.28,.40],{'base':[0,0,0],'top':[0,0,.40]})

start('terrace-stair-081')
for i in range(5):
    h=.162*(i+1);y=-1.60+.32*(i+.5)
    box('Stair riser',(0,y,(h-.014)/2),(1.70,.322,h-.014),PAINT,.018)
    box('Non-slip tread',(0,y,h-.007),(1.51,.27,.014),DARK,.009)
    box('Step nosing',(0,y-.134,h+.003),(1.56,.025,.006),ORANGE,.002)
for x in [-.79,.79]:
    cylinder('Stair handrail',(x,-1.43,1.20),(x,-.17,1.83),.035,PAINT)
    for y,z in [(-1.43,.162),(-.17,.81)]:
        cylinder('Handrail post',(x,y,z),(x,y,z+1.02),.025,DARK)
        box('Post shoe',(x,y,z+.016),(.11,.11,.06),METAL,.015)
finish(current,[1.7,1.6,1.87],{'landing':[0,0,.81],'ground':[0,-1.6,0]})

start('terrace-ramp-2m')
vs=[(x,y,z) for x in [-.9,.9] for y,z in [(-1,-.12),(1,.285),(1,.405),(-1,0)]]
mesh('Sloped deck tray',vs,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],DARK)
for i in range(12):
    y=-.9167+i/6;z=(y+1)*.2025
    o=box('Ramp tread',(0,y,z+.005),(1.78,.154,.025),PAINT,.007);o.rotation_euler.x=math.atan(.2025)
for x in [-.84,.84]:cylinder('Ramp edge marker',(x,-1,.015),(x,1,.420),.018,ORANGE,12)
finish(current,[1.8,2,.54],{'lower':[0,-1,0],'upper':[0,1,.405]})

start('ramp-rail-2m')
cylinder('Sloping handrail',(0,-1,1.035),(0,1,1.44),.04,PAINT)
cylinder('Mid safety rail',(0,-1,.50),(0,1,.905),.022,DARK)
for y in [-.94,.94]:
    z=(y+1)*.2025
    cylinder('Ramp guard post',(0,y,z),(0,y,z+1.035),.025,DARK)
    box('Ramp post foot',(0,y,z+.03),(.13,.11,.06),METAL,.015)
finish(current,[.13,2,1.48],{'lower':[0,-1,0],'upper':[0,1,.405]})

# Special half-roof at the greenhouse side entry: shorten only this pane,
# then fit a separate manufactured hood. Adjacent full roof bays are unchanged.
cut=math.acos(1.5/2)
def garden_profile(rx,rz):
    return [(rx*math.cos(cut+i*(math.pi/2-cut)/30),rz*math.sin(cut+i*(math.pi/2-cut)/30)) for i in range(31)]
def xz_shell(name,outer,inner,y0,y1,mat):
    pts=outer+list(reversed(inner));n=len(pts)
    vs=[(x,y,z) for y in [y0,y1] for x,z in pts]
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj=mesh(name,vs,fs,mat)
    if mat==GLASS:
        # Smooth only the curved sheet faces; retain flat cut edges and caps.
        for i,face in enumerate(obj.data.polygons):
            edge=i-2
            face.use_smooth=(0<=edge<len(outer)-1 or len(outer)<=edge<n-1)
    return obj
start('garden-link-roof-glass')
xz_shell('Shortened arch pane',garden_profile(2,.9),garden_profile(1.99,.89),-.968,.968,GLASS)
for y in [-.97,.97]:xz_shell('Pane edge seal',garden_profile(2.004,.904),garden_profile(1.985,.885),y-.008,y+.008,RUBBER)
finish(current,[1.5,2,.9],{'ridge':[0,0,.9],'hood':[1.5,0,.5953]})

start('garden-link-hood-2m')
# Local coordinates match the original half-vault: X from ridge towards eave.
xz_shell('Raised transition cap',[(1.49,.647),(2.0,.50),(2.24,.50)],[(1.49,.605),(2.0,.458),(2.24,.458)],-.991,.991,PAINT)
for y in [-.984,.984]:
    outer=[(1.49,.64),(2,.50),(2.24,.50),(2.24,0),(2,0)]
    outer += [(2*math.cos(cut*i/18),.9*math.sin(cut*i/18)) for i in range(1,19)]
    # A closed side cheek follows the old arch and seals the elevated hood.
    n=len(outer);vs=[(x,yy,z) for yy in [y-.014,y+.014] for x,z in outer]
    mesh('Hood side flashing',vs,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],PAINT)
box('Hood drip edge',(2.225,0,.477),(.055,1.96,.09),ORANGE,.018)
cylinder('Pane transition seal',(1.50,-.98,.607),(1.50,.98,.607),.027,DARK,16)
finish(current,[.76,2,.65],{'eave':[2,0,0],'pane':[1.5,0,.5953],'passageRoof':[2.24,0,.5]})

# Dependencies retain the authoritative existing GLB dimensions and identities.
dependencies=[]
def load_dependency(prefix,slug,name):
    key=prefix+'/'+name
    if key in assets:return key
    path=PROJECT/'art/models'/slug/(name+'.glb')
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));bpy.context.view_layer.update()
    added=list(set(bpy.data.objects)-before);objects=[o for o in added if o.type=='MESH']
    coll=bpy.data.collections.new('DEPENDENCY / '+key);library.children.link(coll)
    root=bpy.data.objects.new(key,None);coll.objects.link(root)
    for o in objects:
        transform=o.matrix_world.copy()
        for c in list(o.users_collection):c.objects.unlink(o)
        coll.objects.link(o);o.parent=root;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_basis=transform
        for slot in o.material_slots:
            candidate=next((m for k,m in materials.items() if slot.material.name.startswith(k)),None)
            if candidate:slot.material=candidate
        o.hide_set(True)
    for o in added:
        if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
    coll.hide_render=True;assets[key]={'root':root,'parts':objects,'collection':coll}
    source=json.loads((PROJECT/'art/source'/slug/'asset-catalog.json').read_text(encoding='utf-8'))
    entry=next(e for e in source['assets'] if e['id']==name).copy();entry['id']=key
    dependencies.append(entry)
    return key

for name in ['floor-2m','foundation-edge-2m','foundation-corner-r050','wall-solid-2m','wall-window-2m','wall-doorway-2m','wall-corner-r050','door-leaf-110','roof-center-2m','roof-edge-2m','roof-corner-r050','roof-vent','interior-bench-2m','interior-console','interior-planter','ceiling-beam-2m','ceiling-beam-end-050','support-column-2p8']:
    load_dependency('habitat','habitat-v2',name)
for entry in json.loads((PROJECT/'art/source/greenhouse-v1/asset-catalog.json').read_text(encoding='utf-8'))['assets']:
    load_dependency('garden','greenhouse-v1',entry['id'])

assembly=bpy.data.collections.new('ASSEMBLY / L home, passage, garden and terrace');scene.collection.children.link(assembly)
def place(name,p=(0,0,0),angle=0,coll=assembly,record=True,zone=''):
    root=bpy.data.objects.new(name+' instance',None);coll.objects.link(root)
    root.location=p;root.rotation_euler.z=math.radians(angle);root['asset']=name;root['zone']=zone
    for original in assets[name]['parts']:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:layout.append({'asset':name,'positionZUp':list(p),'yawZ':angle,'zone':zone})
    return root

Z=.60;F=Z+.21;R=F+2.8
def support(x,y):
    place('support-foot-020',(x,y,0),zone='support')
    place('support-riser-040',(x,y,.20),zone='support')
for x in [-5,-3,-1,1]:
    for y in [-3,-1,1,3]:
        if x==1 and y>0:continue
        place('habitat/floor-2m',(x,y,Z),zone='home')
        place('habitat/roof-center-2m',(x,y,R),zone='home-roof');support(x,y)

edges=[]
edges += [(x,-4.5,0,'door' if x==-3 else 'window') for x in [-5,-3,-1,1]]
edges += [(x,4.5,180,'solid') for x in [-5,-3,-1]]
edges += [(-6.5,y,270,'solid') for y in [-3,-1,1,3]]
edges += [(2.5,y,90,'link' if y==-1 else 'window') for y in [-3,-1]]
edges += [(.5,3,90,'window')]
for x,y,a,kind in edges:
    place('habitat/foundation-edge-2m',(x,y,Z),a,zone='home')
    place('habitat/roof-edge-2m',(x,y,R),a,zone='home-roof')
    wall='junction-frame-2m' if kind=='link' else 'habitat/wall-'+{'door':'doorway','window':'window','solid':'solid'}[kind]+'-2m'
    place(wall,(x,y,F),a,zone='home')
    if kind=='door':place('habitat/door-leaf-110',(x,y,F),a,zone='home')
    if kind=='link':place('dock-head-2m',(x,y,R),a,zone='home-roof')
for x,y,a in [(2,-4,0),(2,0,90),(0,4,90),(-6,4,180),(-6,-4,270)]:
    for name,z in [('foundation-corner-r050',Z),('wall-corner-r050',F),('roof-corner-r050',R)]:
        place('habitat/'+name,(x,y,z),a,zone='home-roof' if name.startswith('roof') else 'home')
for name,z in [('foundation-inner-corner-2m',Z),('wall-inner-corner-2m',F),('roof-inner-corner-2m',R)]:
    place(name,(0,0,z),zone='home-roof' if name.startswith('roof') else 'home')
for x,y in [(-4,2),(-2,2),(-1,-2)]:place('habitat/roof-vent',(x,y,R+.5),zone='home-roof')
for x in [-5,-3,-1]:place('habitat/interior-bench-2m',(x,3.75,F),zone='furniture')
place('habitat/interior-console',(-5.2,-1.3,F),270,zone='furniture')
place('habitat/interior-planter',(-5.15,-1.25,F+.92),zone='furniture')
for x in [-5,-3,-1]:place('habitat/ceiling-beam-2m',(x,0,R),zone='structure')
place('habitat/ceiling-beam-end-050',(-6.25,0,R),180,zone='structure')
place('habitat/support-column-2p8',(-2,0,F),zone='structure')
place('habitat/support-column-2p8',(0,0,F),zone='structure')

# Two straight passage cells; both ends remain visibly open and connected.
for x in [3.5,5.5]:
    place('habitat/floor-2m',(x,-1,Z),zone='passage')
    place('corridor-roof-2m',(x,-1,R),zone='passage-roof')
    for y,a in [(-2,0),(0,180)]:place('corridor-wall-glass-2m',(x,y,F),a,zone='passage')
    support(x,-1)
place('junction-frame-2m',(6.5,-1,F),270,zone='garden-link')

# Shift the existing garden to (8.5,-1). Replace only one west wall and one
# adjacent half-vault pane. Its new hood seals to the passage roof at x=6.5.
gx,gy=8.5,-1
for item in json.loads((PROJECT/'art/source/greenhouse-v1/assembly.json').read_text(encoding='utf-8')):
    name=item['asset'];x,y,z=item['positionZUp'];a=item['yawZ']
    if name=='habitat/entry-step-2m':continue
    if name=='garden-wall-glass-2m' and x==-2 and y==0:continue
    if name in ['growing-bed-2m','crop-tray-leafy'] and x<0:
        y=-1.85 if y<0 else 1.85
    if name=='garden-irrigation-unit':x=0;y=2.45
    if name=='garden-roof-glass-half-2m' and y==0 and a==180:
        place('garden-link-roof-glass',(gx,gy,R),180,zone='garden-roof')
        place('garden-link-hood-2m',(gx,gy,R),180,zone='garden-roof');continue
    key=name if name.startswith('habitat/') else 'garden/'+name
    place(key,(gx+x,gy+y,Z+z),a,zone='garden-roof' if any(t in name for t in ['roof-','arch-','ridge','gutter']) else 'garden')
for x in [gx-1,gx+1]:
    for y in [gy-2,gy,gy+2]:support(x,y)
# Garden front entrance receives its own small landing and the same stair.
place('deck-floor-2m',(gx+1,gy-4,Z),zone='garden-porch')
for x in [gx,gx+2]:
    place('deck-rail-2m',(x,gy-4,F),90,zone='garden-porch')
    for y in [gy-5,gy-3]:place('deck-post-105',(x,y,F),zone='garden-porch')
support(gx+.2,gy-4.8);support(gx+1.8,gy-4.8)
place('terrace-stair-081',(gx+1,gy-5,0),zone='garden-porch')

# Raised 8 x 4 m terrace; all treads are on the same 0.81 m walking datum.
for x in [-5,-3,-1,1]:
    for y in [-5.5,-7.5]:place('deck-floor-2m',(x,y,Z),zone='terrace');support(x,y)
railed=[]
for x in [-5,-3,-1,1]:
    place('deck-edge-2m',(x,-8.5,Z),zone='terrace')
    if x!=-3:railed.append((x,-8.5,0))
for x,a in [(-6,270),(2,90)]:
    for y in [-5.5,-7.5]:
        place('deck-edge-2m',(x,y,Z),a,zone='terrace')
        if not (x==2 and y==-7.5):railed.append((x,y,a))
post_positions=set()
for x,y,a in railed:
    place('deck-rail-2m',(x,y,F),a,zone='terrace')
    for d in [-1,1]:post_positions.add((round(x+d*math.cos(math.radians(a)),5),round(y+d*math.sin(math.radians(a)),5)))
for x,y in sorted(post_positions):place('deck-post-105',(x,y,F),zone='terrace')
for x in [-6,2]:
    for y in [-8.5,-4.5]:place('deck-corner-cap',(x,y,Z),zone='terrace')
place('terrace-stair-081',(-3,-8.5,0),zone='terrace')
for x,z in [(5,0),(3,.405)]:
    place('terrace-ramp-2m',(x,-7.5,z),90,zone='ramp')
    for y in [-8.34,-6.66]:place('ramp-rail-2m',(x,y,z),90,zone='ramp')
for x,y,a in [(-5.2,-6.1,90),(.6,-5.9,270)]:
    place('habitat/interior-bench-2m',(x,y,F),a,zone='furniture')
for x,y in [(-5.5,-4.9),(1.4,-4.9)]:place('habitat/interior-planter',(x,y,F),zone='furniture')

catalog={'stage':'art-review','units':'metres','sourceUp':'Z','glbUp':'Y','assets':manifest,'dependencies':dependencies,
    'assembly':'L-shaped central floor 56 m2, 4 m passage, 4 x 6 m garden and 8 x 4 m terrace; all module scales 1.',
    'scope':'Geometry, materials and module assembly only. No runtime logic or performance acceptance.'}
(HERE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'assembly.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

# Studio is separate from delivery meshes. All preview images are real renders.
studio=bpy.data.collections.new('STUDIO / review only');scene.collection.children.link(studio)
material('Studio sand',(.26,.285,.265),0,.84)
start('studio');ground=box('Studio ground',(0,0,-.11),(200,200,.20),'Studio sand',0)
for c in list(ground.users_collection):c.objects.unlink(ground)
studio.objects.link(ground)
def light(name,p,power,size,color,target=(0,-1,1)):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=p
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
light('Warm key',(-9,-12,15),3700,10,(1,.84,.65))
light('Cool fill',(12,-6,12),2600,10,(.67,.83,1))
light('Soft rim',(5,10,10),3200,8,(1,.94,.79))
for x,y in [(-4,2),(-2,-2),(4.5,-1),(8.5,-1)]:light('Interior',(x,y,3.25),100,2,(1,.80,.55),(x,y,.8))
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.43,.57,.68,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.32
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.name='Connections review camera'
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
camera_at((23,-31,24),(1,-2,1.4),50)
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.cycles.max_bounces=16;scene.cycles.transmission_bounces=12
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.3
scene.render.resolution_x=2200;scene.render.resolution_y=1600;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(REVIEW/'01-connected-home.png')
scene['reference']='art/concepts/selected-warm-sci-fi.png';scene['stage']='Art module review only'
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'connections-v1.blend'))
if os.environ.get('CONNECTIONS_SKIP_RENDER')!='1' and os.environ.get('CONNECTIONS_MODULE_SHEET_ONLY')!='1':bpy.ops.render.render(write_still=True)

# A cutaway records the same assembled parts with only roofs hidden.
hidden=[]
for root in list(assembly.objects):
    if root.type=='EMPTY' and root.get('zone') in ['home-roof','passage-roof','garden-roof']:
        for o in root.children:o.hide_render=True;hidden.append(o)
camera_at((17,-22,30),(1,-1.7,.8),52)
scene.render.filepath=str(REVIEW/'02-connected-cutaway.png')
if os.environ.get('CONNECTIONS_SKIP_RENDER')!='1' and os.environ.get('CONNECTIONS_MODULE_SHEET_ONLY')!='1':bpy.ops.render.render(write_still=True)
for o in hidden:o.hide_render=False

# The module board is authored separately so its pieces never enter the GLBs.
assembly.hide_render=True
board=bpy.data.collections.new('REVIEW / independent pieces');scene.collection.children.link(board)
items=[('wall-inner-corner-2m','01 / CONCAVE WALL'),('foundation-inner-corner-2m','02 / CONCAVE BASE'),('roof-inner-corner-2m','03 / CONCAVE ROOF'),
    ('junction-frame-2m','04 / OPEN CONNECTION'),('dock-head-2m','05 / DOCK HEADER'),('corridor-wall-glass-2m','06 / PASSAGE WALL'),
    ('corridor-roof-2m','07 / PASSAGE ROOF'),('junction-post','08 / CORNER POST'),('deck-floor-2m','09 / DECK TILE'),
    ('deck-edge-2m','10 / EDGE FASCIA'),('deck-rail-2m','11 / GUARD RAIL'),('deck-post-105','12 / GUARD POST'),
    ('support-foot-020','13 / SUPPORT FOOT'),('support-riser-040','14 / SUPPORT RISER'),('deck-corner-cap','15 / DECK CORNER'),
    ('terrace-stair-081','16 / STEPS'),('terrace-ramp-2m','17 / RAMP SECTION'),('ramp-rail-2m','18 / RAMP GUARD'),
    ('garden-link-roof-glass','19 / SHORT ARCH PANE'),('garden-link-hood-2m','20 / GARDEN HOOD')]
for i,(name,label) in enumerate(items):
    x=(i%5-2)*4.2;z=(1.5-i//5)*4.4
    root=place(name,(x,0,z),225 if 'inner-corner' in name else -27,board,False);root.rotation_euler.x=math.radians(23)
    bpy.context.view_layer.update();points=[o.matrix_world@Vector(c) for o in root.children for c in o.bound_box]
    root.location.x+=x-(min(p.x for p in points)+max(p.x for p in points))/2
    root.location.z+=z-(min(p.z for p in points)+max(p.z for p in points))/2
    start('label');o=text3d(label,(x,-2,z-1.84),.16,INK)
    for c in list(o.users_collection):c.objects.unlink(o)
    board.objects.link(o)
start('board');back=box('Module sheet backdrop',(0,3,0),(45,.1,35),'Studio sand',0)
for c in list(back.users_collection):c.objects.unlink(back)
board.objects.link(back);ground.hide_render=True
boardlight=light('Sheet fill',(0,-10,2),2400,16,(1,.95,.85),(0,0,0))
camera_at((0,-35,0),(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=23.1
scene.render.resolution_x=2400;scene.render.resolution_y=1900;scene.render.filepath=str(REVIEW/'03-connection-modules.png')
if os.environ.get('CONNECTIONS_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
board.hide_render=True;board.hide_viewport=True;boardlight.hide_render=True;boardlight.hide_viewport=True
ground.hide_render=False;assembly.hide_render=False;camera.data.type='PERSP'
camera_at((23,-31,24),(1,-2,1.4),50)
scene.render.resolution_x=2200;scene.render.resolution_y=1600;scene.render.filepath=str(REVIEW/'01-connected-home.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'connections-v1.blend'))
print(json.dumps({'assets':len(manifest),'dependencies':len(dependencies),'instances':len(layout)}))
