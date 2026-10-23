"""Living and social prop art kit. Headless Blender authoring, no game code.

All original modules are editable mesh parts; exports are independent GLBs.
The house is a cutaway review of already delivered architectural modules.
"""
from pathlib import Path
KIT_SLUG='living-v1'
helper=Path(__file__).resolve().parent.parent/'habitat-v2/build_habitat.py'
exec(compile(helper.read_text(encoding='utf-8').split('# -- End shared art helpers --')[0],str(helper),'exec'))

shared_finish=finish
def finish(name,nominal,sockets):
    # Very thin bevelled insets can leave coincident vertices where the bevel
    # reaches half their thickness. Clean those meshes before final export.
    for o in parts:
        o.data.calc_loop_triangles()
        if any(t.area<1e-12 for t in o.data.loop_triangles):
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
            bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
            bm.to_mesh(o.data);bm.free();o.data.update();o.data.calc_loop_triangles()
            assert not any(t.area<1e-12 for t in o.data.loop_triangles),(name,o.name)
    shared_finish(name,nominal,sockets)
    bpy.context.view_layer.update()
    # Exact mesh bounds after transforms, including oblique chair legs. Bounding
    # box corners from a rotated part overestimate its true exported extents.
    points=[o.matrix_world@v.co for o in assets[name]['parts'] for v in o.data.vertices]
    low=[min(p[i] for p in points) for i in range(3)]
    high=[max(p[i] for p in points) for i in range(3)]
    manifest[-1]['sourceDimensionsXYZ']=[round(b-a,5) for a,b in zip(low,high)]
    manifest[-1]['sourceBoundsXYZ']={'min':low,'max':high}

# A small embedded woven normal texture, shared by cloth and soft furnishings.
yy,xx=np.mgrid[0:n,0:n]
weave=np.stack((.5+.045*np.sin(xx*math.pi/2),.5+.045*np.sin(yy*math.pi/2),np.ones((n,n))),axis=-1).astype(np.float32)
woven=image_map('woven-normal',weave)
def cloth(name,color):
    m=material(name,color,0,.87);p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Sheen Weight'].default_value=.24
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=woven
    nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.35
    m.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    return name
TEAL=cloth('16 / ocean woven cloth',(.105,.235,.235))
LINEN=cloth('17 / oatmeal linen',(.62,.56,.43))
RUST=cloth('18 / saffron textile',(.55,.23,.075))
SEAM=cloth('19 / pale textile piping',(.32,.43,.39))
CERAMIC='20 / glazed cream ceramic';material(CERAMIC,(.77,.72,.59),.02,.24)
WALNUT='21 / honey ash timber';material(WALNUT,(.34,.19,.085),0,.53)
INKGLASS='22 / cooktop ceramic glass';material(INKGLASS,(.015,.024,.026),.27,.16)
PAPER='23 / gift wrap sage';material(PAPER,(.29,.39,.27),0,.73)

def tube(name,points,r,mat=METAL,cyclic=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=3 if len(points)>12 else 10
    cu.bevel_depth=r;cu.bevel_resolution=2;cu.use_fill_caps=not cyclic
    sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(points)-1);sp.use_cyclic_u=cyclic
    for bp,p in zip(sp.bezier_points,points):bp.co=p;bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,cu);scene.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');return register(bpy.context.object,name,mat)

def lathe(name,profile,mat=PAINT,sides=48,offset=(0,0,0)):
    # Every ring has positive radius. The two planar caps use single ngons.
    ox,oy,oz=offset
    vs=[(ox+r*math.cos(i*2*math.pi/sides),oy+r*math.sin(i*2*math.pi/sides),oz+z) for r,z in profile for i in range(sides)]
    fs=[tuple(range(sides-1,-1,-1))]
    for j in range(len(profile)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;fs.append((a,b,b+sides,a+sides))
    fs.append(tuple(range((len(profile)-1)*sides,len(profile)*sides)))
    o=mesh(name,vs,fs,mat)
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return o

def horizontal_plate(name,w,d,r,z,thickness,mat=PAINT):
    o=panel(name,w,d,r,(0,0),0,thickness,mat)
    # XZ panel becomes XY; local thickness points upward from z.
    o.rotation_euler.x=math.pi/2;o.location.z=z
    return o

def piping(name,w,d,z,mat=SEAM,r=.004,offset=(0,0)):
    pts=outline(w,d,min(.07,w*.18,d*.18),steps=7)
    return tube(name,[(x+offset[0],y+offset[1],z) for x,y in pts],r,mat,True)

def feet(x,y,h=.12):
    for a in [-x,x]:
        for b in [-y,y]:
            cylinder('Rubber foot',(a,b,0),(a,b,.025),.038,RUBBER)
            cylinder('Tapered furniture leg',(a,b,.025),(a*.94,b*.94,h),.025,METAL)

start('dining-table-180')
horizontal_plate('Rounded solid timber top',1.8,.90,.16,.704,.056,WALNUT)
horizontal_plate('Dark under-edge',1.74,.84,.13,.682,.022,DARK)
for x in [-.61,.61]:
    for y in [-.29,.29]:
        cylinder('Splayed leg',(x*1.12,y*1.18,.025),(x,y,.69),.029,METAL)
        cylinder('Quiet rubber glide',(x*1.12,y*1.18,0),(x*1.12,y*1.18,.035),.035,RUBBER)
    box('Under-table cross rail',(x,0,.66),(.08,.64,.07),DARK,.015)
box('Central stretcher',(0,0,.64),(1.30,.065,.075),DARK,.015)
for y in [-.37,.37]:box('Timber inlay',(0,y,.761),(1.45,.009,.002),WOOD,.0005)
finish(current,[1.8,.9,.76],{'top':[0,0,.76],'floor':[0,0,0]})

start('dining-chair')
for x in [-.205,.205]:
    for y in [-.205,.205]:
        cylinder('Splayed chair leg',(x*1.16,y*1.16,.018),(x,y,.405),.018,METAL)
        cylinder('Chair glide',(x*1.16,y*1.16,0),(x*1.16,y*1.16,.025),.023,RUBBER)
    tube('Seat to back frame',[(x,-.22,.395),(x,.19,.395),(x,.265,.64),(x,.285,.82)],.022,DARK)
box('Seat shell',(0,0,.405),(.50,.49,.048),PAINT,.022)
box('Woven seat pad',(0,-.01,.45),(.465,.45,.06),TEAL,.026)
piping('Seat piping',.448,.437,.462,SEAM,.003,(0,-.01))
o=box('Gently reclined back shell',(0,.267,.71),(.50,.065,.29),PAINT,.028);o.rotation_euler.x=math.radians(9)
o=box('Back upholstery',(0,.224,.712),(.452,.05,.235),TEAL,.020);o.rotation_euler.x=math.radians(9)
box('Ochre back badge',(0,.311,.70),(.16,.006,.028),ORANGE,.009)
finish(current,[.50,.56,.86],{'seat':[0,-.01,.48],'floor':[0,0,0]})

start('coffee-table-110')
horizontal_plate('Ivory rounded top',1.1,.65,.16,.372,.038,PAINT)
horizontal_plate('Dark reveal',1.05,.60,.14,.351,.020,DARK)
feet(.40,.20,.355)
horizontal_plate('Lower timber shelf',.88,.46,.09,.13,.025,WALNUT)
finish(current,[1.1,.65,.41],{'top':[0,0,.41]})

start('sofa-seat-090')
feet(.34,.30,.16)
box('Upholstery base',(0,0,.225),(.9,.86,.15),DARK,.045)
box('Ivory base valance',(0,-.03,.28),(.898,.79,.10),PAINT,.038)
box('Seat cushion',(0,-.052,.395),(.884,.725,.15),TEAL,.06)
piping('Seat cushion stitched edge',.853,.695,.426,SEAM,.003,(0,-.052))
box('Back frame',(0,.344,.65),(.9,.12,.65),PAINT,.05)
o=box('Soft back cushion',(0,.245,.718),(.88,.18,.44),TEAL,.072);o.rotation_euler.x=math.radians(8)
for x in [-.24,.24]:
    box('Back upholstery stitch',(x,.142,.71),(.004,.006,.23),SEAM,.002)
box('Base orange identity strip',(-.29,-.431,.283),(.16,.006,.023),ORANGE,.008)
finish(current,[.9,.86,.98],{'left':[-.45,0,0],'right':[.45,0,0],'seat':[0,-.052,.47]})

start('sofa-arm')
box('Arm structural side',(0,.01,.37),(.15,.83,.48),PAINT,.058)
box('Padded armrest',(0,-.02,.62),(.18,.80,.09),LINEN,.038)
box('Arm dark foot',(0,.02,.08),(.115,.66,.16),DARK,.03)
finish(current,[.18,.83,.665],{'mount':[0,0,0]})

start('bed-frame-160')
feet(.68,.89,.18)
box('Bed foundation',(0,0,.21),(1.72,2.18,.16),PAINT,.065)
box('Mattress platform',(0,0,.285),(1.64,2.10,.03),DARK,.012)
box('Floating base shadow',(0,0,.15),(1.57,1.98,.07),DARK,.026)
box('Warm headboard surround',(0,1.025,.65),(1.76,.13,.79),WALNUT,.055)
box('Upholstered headboard',(0,.945,.70),(1.61,.07,.55),LINEN,.029)
for x in [-.52,0,.52]:box('Headboard stitch',(x,.907,.7),(.004,.003,.45),SEAM,.001)
for x in [-.66,.66]:box('Foot identity detail',(x,-1.094,.215),(.13,.008,.04),ORANGE,.01)
finish(current,[1.76,2.18,1.045],{'mattress':[0,0,.30]})

start('mattress-160')
box('Rounded upholstered mattress',(0,0,.10),(1.60,2.0,.20),LINEN,.07)
piping('Upper mattress welt',1.55,1.95,.167,SEAM,.004)
piping('Lower mattress welt',1.55,1.95,.033,SEAM,.004)
finish(current,[1.6,2,.2],{'bottom':[0,0,0],'top':[0,0,.2]})

start('bed-quilt-160')
# Closed, gently rippled cloth with hems draping off both sides of the mattress.
nx,ny=42,38;vs=[]
def quilt_z(x,y):
    edge=max(0,(abs(x)-.71)/.15)
    foot=max(0,(-y-.91)/.17)
    return .145-.11*edge**1.5-.04*foot+.008*math.sin(14*x+3*y)+.004*math.sin(28*y+2*x)
for side in [0,1]:
    for j in range(ny+1):
        y=-1.08+j*1.66/ny
        for i in range(nx+1):
            x=-.86+i*1.72/nx;vs.append((x,y,quilt_z(x,y)-side*.014))
k=(nx+1)*(ny+1);fs=[]
for j in range(ny):
    for i in range(nx):
        a=j*(nx+1)+i;fs.extend([(a,a+1,a+nx+2,a+nx+1),(a+k,a+nx+1+k,a+nx+2+k,a+1+k)])
boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
for a,b in zip(boundary,boundary[1:]+boundary[:1]):fs.append((a,b,b+k,a+k))
mesh('Quilt soft drape',vs,fs,TEAL,smooth=True)
for x in [-.65,-.39,-.13,.13,.39,.65]:
    pts=[(x,-1.04+j*1.58/30,quilt_z(x,-1.04+j*1.58/30)+.0015) for j in range(31)]
    tube('Quilt stitched channel',pts,.0018,SEAM)
for y in [-1.05,.55]:tube('Quilt rolled hem',[(x,y,quilt_z(x,y)) for x in np.linspace(-.84,.84,40)],.005,SEAM)
finish(current,[1.72,1.66,.16],{'bed-install':[0,0,0]})

start('bed-pillow')
box('Soft pillow filling',(0,0,.068),(.65,.43,.136),LINEN,.058)
piping('Pillow edge seam',.62,.40,.068,SEAM,.003)
finish(current,[.65,.43,.136],{'bottom':[0,0,0]})

start('cabinet-frame-100')
feet(.40,.22,.14)
box('Lower plinth',(0,.015,.16),(.96,.55,.08),DARK,.024)
for x in [-.475,.475]:box('Cabinet side',(x,0,.515),(.05,.60,.69),PAINT,.018)
box('Cabinet back',(0,.275,.52),(.9,.05,.68),INNER,.016)
box('Cabinet floor',(0,0,.205),(.90,.54,.05),INNER,.012)
box('Cabinet shelf',(0,.015,.46),(.9,.50,.025),WALNUT,.008)
box('Cabinet top rail',(0,0,.835),(1,.6,.05),PAINT,.018)
finish(current,[1,.6,.86],{'top':[0,0,.86],'door-left':[-.25,-.327,.18],'door-right':[.25,-.327,.18],'drawer':[0,-.315,.63],'left':[-.5,0,0],'right':[.5,0,0]})

start('cabinet-door-050')
box('Independent symmetric door',(0,0,.3225),(.475,.045,.645),PAINT,.019)
box('Recessed handle backing',(0,-.026,.545),(.23,.009,.055),DARK,.012)
box('Finger pull',(0,-.048,.555),(.21,.035,.017),METAL,.007)
box('Small enamel tab',(.15,-.026,.12),(.055,.005,.022),ORANGE,.006)
finish(current,[.475,.066,.645],{'left-hinge':[-.2375,0,.3225],'right-hinge':[.2375,0,.3225]})

start('cabinet-drawer-100')
box('Drawer front',(0,0,.10),(.944,.045,.20),PAINT,.017)
box('Drawer base',(0,.245,.025),(.85,.48,.025),INNER,.008)
for x in [-.436,.436]:box('Drawer wall',(x,.24,.09),(.022,.47,.14),INNER,.008)
box('Drawer rear',(0,.475,.09),(.85,.025,.14),INNER,.008)
box('Pull recess',(0,-.026,.12),(.33,.009,.06),DARK,.013)
box('Drawer pull',(0,-.047,.13),(.30,.032,.02),METAL,.008)
finish(current,[.944,.51,.20],{'pull-direction':[0,-1,0]})

start('shelf-upright-180')
for y in [-.20,.20]:
    box('Shelf foot',(0,y,.02),(.10,.14,.04),RUBBER,.015)
    box('Vertical rail',(0,y,.91),(.05,.05,1.78),DARK,.014)
    for z in [.25,.65,1.05,1.45]:box('Shelf saddle',(0,y,z),(.10,.085,.035),METAL,.008)
box('Top bridge',(0,0,1.77),(.055,.44,.05),ORANGE,.014)
box('Rear bracing',(0,.21,.91),(.035,.035,1.66),METAL,.009)
finish(current,[.10,.54,1.8],{'bottom':[0,0,0],'shelf1':[0,0,.2675],'shelf2':[0,0,.6675],'shelf3':[0,0,1.0675],'shelf4':[0,0,1.4675]})

start('shelf-board-090')
box('Solid timber shelf',(0,0,.02),(.90,.44,.04),WALNUT,.014)
box('Front edge protector',(0,-.224,.02),(.90,.012,.035),PAINT,.005)
finish(current,[.90,.452,.04],{'left':[-.45,0,0],'right':[.45,0,0],'top':[0,0,.04]})

start('kitchen-counter-100')
box('Worktop',(0,0,.02),(1,.65,.04),WALNUT,.015)
box('Rear splash rail',(0,.295,.08),(1,.045,.12),PAINT,.017)
finish(current,[1,.65,.14],{'counter':[0,0,.04],'left':[-.5,0,0],'right':[.5,0,0]})

start('kitchen-sink-top-100')
# A genuine cavity assembled from a ring plus a separate inner basin, no dark decal.
o=frame('Counter with basin opening',(1,.65,.06),(.58,.39,.065),(0,0),0,.04,WALNUT)
o.rotation_euler.x=math.pi/2;o.location.z=0
o=frame('Metal sink rim',(.62,.43,.07),(.54,.35,.065),(0,0),0,.012,METAL)
o.rotation_euler.x=math.pi/2;o.location.z=.04
box('Basin bottom',(0,0,-.145),(.52,.33,.025),METAL,.01)
for x in [-.263,.263]:box('Basin side',(x,0,-.055),(.026,.35,.18),METAL,.01)
for y in [-.168,.168]:box('Basin end',(0,y,-.055),(.52,.026,.18),METAL,.01)
cylinder('Drain dark inset',(0,0,-.133),(0,0,-.130),.038,DARK)
for x in [-.016,0,.016]:box('Drain slots',(x,0,-.128),(.006,.04,.002),METAL,.0008)
tube('Gooseneck tap',[(.32,.22,.04),(.32,.22,.31),(.22,.22,.37),(.08,.22,.31),(.08,.13,.26)],.018,METAL)
cylinder('Tap base',(.32,.22,.04),(.32,.22,.065),.037,DARK)
box('Tap lever',(.39,.22,.13),(.09,.025,.025),METAL,.009)
box('Rear splash rail',(0,.295,.08),(1,.045,.12),PAINT,.017)
finish(current,[1,.65,.53],{'counter':[0,0,.04],'left':[-.5,0,0],'right':[.5,0,0]})

start('induction-hob')
box('Hob bevelled glass',(0,0,.017),(.60,.46,.034),INKGLASS,.013)
for x,r in [(-.145,.096),(.145,.078)]:
    tube('Induction ring',[(x+r*math.cos(t),.035+r*math.sin(t),.035) for t in np.linspace(0,2*math.pi,48,endpoint=False)],.0017,METAL,True)
for x in [-.06,0,.06]:box('Touch marking',(x,-.17,.035),(.025,.009,.0015),WHITE,.0003)
box('Standby indicator',(.13,-.17,.035),(.016,.005,.0015),CYAN,.0003)
finish(current,[.60,.46,.037],{'bottom':[0,0,0]})

start('kettle')
lathe('Enamel kettle body',[(.085,0),(.115,.025),(.13,.07),(.125,.19),(.09,.24)],ORANGE)
lathe('Brushed lid',[(.089,.239),(.097,.248),(.087,.259),(.025,.263)],METAL)
cylinder('Lid knob',(0,0,.26),(0,0,.285),.023,DARK)
tube('Insulated arch handle',[(-.09,.025,.18),(-.105,.04,.32),(0,.04,.38),(.105,.04,.32),(.09,.025,.18)],.016,DARK)
tube('Kettle spout',[(0,-.105,.075),(0,-.16,.12),(0,-.195,.21)],.027,METAL)
cylinder('Recessed spout mouth',(0,-.195,.21),(0,-.1954,.211),.020,DARK,24)
box('Heat badge',(0,-.128,.14),(.045,.003,.028),PAINT,.007)
finish(current,[.27,.34,.40],{'bottom':[0,0,0]})

start('mug')
lathe('Hollow ceramic mug',[(.035,0),(.042,.007),(.047,.10),(.044,.108),(.036,.108),(.034,.015),(.003,.015)],CERAMIC)
tube('Mug handle',[(.041,0,.083),(.075,0,.086),(.083,0,.049),(.045,0,.028)],.008,ORANGE)
finish(current,[.14,.094,.108],{'bottom':[0,0,0]})

start('dinner-plate')
lathe('Shallow ceramic dish',[(.004,0),(.095,0),(.14,.018),(.145,.025),(.139,.029),(.10,.012),(.004,.012)],CERAMIC)
tube('Fine ochre rim',[(.138*math.cos(t),.138*math.sin(t),.029) for t in np.linspace(0,2*math.pi,64,endpoint=False)],.0015,ORANGE,True)
finish(current,[.29,.29,.031],{'bottom':[0,0,0]})

start('storage-basket-040')
box('Basket base',(0,0,.012),(.4,.32,.024),LINEN,.01)
for x in [-.19,.19]:box('Basket side',(x,0,.145),(.02,.32,.27),LINEN,.009)
for y in [-.15,.15]:
    box('Basket wall',(0,y,.145),(.36,.02,.27),LINEN,.009)
    box('Dark handle patch',(0,y*1.073,.22),(.14,.009,.047),DARK,.018)
    box('Handle inset',(0,y*1.11,.22),(.095,.003,.014),LINEN,.005)
piping('Basket bound rim',.39,.31,.28,RUST,.007)
finish(current,[.414,.334,.287],{'bottom':[0,0,0]})

start('outdoor-lantern-160')
box('Lamp weighted base',(0,0,.035),(.26,.26,.07),DARK,.028)
cylinder('Lamp mast',(0,0,.06),(0,0,1.27),.028,METAL)
lathe('Warm diffuser',[(.095,1.23),(.12,1.27),(.12,1.48),(.095,1.52)],LAMP)
lathe('Enamel top cap',[(.126,1.49),(.132,1.53),(.10,1.57),(.025,1.595)],PAINT)
lathe('Lower collar',[(.09,1.21),(.128,1.24),(.128,1.265)],ORANGE)
for a in range(0,360,90):
    x=.117*math.cos(math.radians(a));y=.117*math.sin(math.radians(a))
    cylinder('Lantern cage rail',(x,y,1.255),(x,y,1.51),.008,DARK,12)
finish(current,[.264,.264,1.595],{'floor':[0,0,0]})

start('wayfinding-post')
box('Sign weighted foot',(0,0,.035),(.34,.30,.07),DARK,.026)
box('Sign stem',(0,0,.76),(.065,.07,1.45),METAL,.018)
box('Post orange cap',(0,0,1.49),(.085,.09,.06),ORANGE,.023)
finish(current,[.34,.30,1.52],{'upper-panel':[0,-.07,1.28],'lower-panel':[0,-.07,.94]})

start('wayfinding-panel')
panel('Rounded sign face',.72,.25,.07,(0,0),-.018,.036,PAINT)
panel('Inset teal field',.65,.185,.05,(0,0),-.022,.004,DARK)
text3d('WELCOME',(-.035,-.026,-.022),.069,WHITE)
mesh('Direction arrow',[(.252,-.027,-.043),(.306,-.027,0),(.252,-.027,.043)],[(0,1,2)],ORANGE)
finish(current,[.72,.036,.25],{'post':[0,0,0]})

start('gift-box-040')
box('Gift base',(0,0,.015),(.4,.4,.03),PAPER,.012)
for x in [-.188,.188]:box('Gift side',(x,0,.17),(.024,.4,.31),PAPER,.009)
for y in [-.188,.188]:box('Gift side',(0,y,.17),(.352,.024,.31),PAPER,.009)
for y in [-.202,.202]:box('Textile wrap band',(0,y,.163),(.052,.006,.32),RUST,.002)
finish(current,[.40,.41,.325],{'lid':[0,0,.325]})

start('gift-lid-040')
box('Independent fitted lid',(0,0,.024),(.44,.44,.048),PAPER,.015)
for x in [-.213,.213]:box('Lid lip',(x,0,-.012),(.012,.438,.024),PAPER,.005)
for y in [-.213,.213]:box('Lid lip',(0,y,-.012),(.414,.012,.024),PAPER,.005)
box('Ribbon across lid',(0,0,.050),(.054,.421,.005),RUST,.002)
box('Ribbon crossing',(0,0,.053),(.421,.054,.005),RUST,.002)
# Flattened ribbon loops are closed strips rather than bulky cartoon bows.
for sign in [-1,1]:
    vs=[]
    for i in range(33):
        t=2*math.pi*i/32;x=sign*(.018+.085*(1-math.cos(t)));z=.079+.022*math.sin(t)
        for y in [-.017,.017]:vs.append((x,y,z))
    mesh('Gift ribbon loop',vs,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(32)],RUST)
box('Tied textile knot',(0,0,.069),(.052,.048,.027),RUST,.011)
box('Gift tag',(.105,-.103,.057),(.10,.055,.004),CERAMIC,.001)
finish(current,[.44,.44,.14],{'box':[0,0,0],'inner-opening-half':[.207,.207,0]})

start('woven-rug-240')
box('Woven rug base',(0,0,.006),(2.4,1.65,.012),LINEN,.004)
for y in [-.70,.70]:box('Woven teal border',(0,y,.013),(2.32,.095,.002),TEAL,.0005)
for x in [-1.08,1.08]:box('Woven saffron end band',(x,0,.013),(.07,1.42,.002),RUST,.0005)
for x in [-1.215,1.215]:
    for y in np.linspace(-.77,.77,32):cylinder('Short bound fringe',(x-math.copysign(.016,x),y,.005),(x+math.copysign(.018,x),y,.005),.0024,LINEN,8)
finish(current,[2.47,1.65,.014],{'floor':[0,0,0]})

# Reuse delivered architecture and plant props. No duplicate architecture exports.
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
    entry=next(e for e in source['assets'] if e['id']==name).copy();entry['id']=key;dependencies.append(entry)
    return key

assembly=bpy.data.collections.new('ASSEMBLY / furnished home cutaway');scene.collection.children.link(assembly)
def place(name,p=(0,0,0),angle=0,coll=assembly,record=True,zone=''):
    root=bpy.data.objects.new(name+' instance',None);coll.objects.link(root)
    root.location=p;root.rotation_euler.z=math.radians(angle);root['asset']=name;root['zone']=zone
    for original in assets[name]['parts']:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:layout.append({'asset':name,'positionZUp':list(p),'yawZ':angle,'zone':zone})
    return root

F=.81
for item in json.loads((PROJECT/'art/source/connections-v1/assembly.json').read_text(encoding='utf-8')):
    name=item['asset'];x,y,z=item['positionZUp'];a=item['yawZ'];zone=item['zone']
    if zone not in ['home','terrace','ramp','support']:continue
    if zone=='support' and (x>2 or y>4.5):continue
    # South/east walls are cut away for interior review, not deleted from their source kit.
    if zone=='home' and any(t in name for t in ['wall-','door-leaf','junction-frame']):
        if y< -4 or x>=0:continue
    key=load_dependency('habitat','habitat-v2',name.split('/')[1]) if name.startswith('habitat/') else load_dependency('connections','connections-v1',name)
    place(key,(x,y,z),a,zone='architecture')
plant=load_dependency('habitat','habitat-v2','interior-planter')

def relative(p,local,a=0):
    return tuple(Vector(p)+Matrix.Rotation(math.radians(a),4,'Z')@Vector(local))
def cabinet(p,a=0,top='kitchen-counter-100',doors=True):
    place('cabinet-frame-100',p,a,zone='kitchen')
    if doors:
        for x in [-.25,.25]:place('cabinet-door-050',relative(p,(x,-.327,.18),a),a,zone='kitchen')
    if top:place(top,relative(p,(0,0,.86),a),a,zone='kitchen')
def sofa(p,count,a=0,zone='living'):
    for i in range(count):place('sofa-seat-090',relative(p,((i-(count-1)/2)*.9,0,0),a),a,zone=zone)
    for x in [-count*.45-.075,count*.45+.075]:place('sofa-arm',relative(p,(x,0,0),a),a,zone=zone)
def dining(p,a=0,zone='dining'):
    place('dining-table-180',p,a,zone=zone)
    for x in [-.50,.50]:
        for y,angle in [(-.85,180),(.85,0)]:place('dining-chair',relative(p,(x,y,0),a),a+angle,zone=zone)
    for x in [-.50,.50]:
        for y in [-.25,.25]:
            place('dinner-plate',relative(p,(x,y,.762),a),a,zone=zone)
            place('mug',relative(p,(x+.20,y,.762),a),a,zone=zone)

# Sleeping alcove and a repeatable two-bay open shelf.
place('bed-frame-160',(-4.9,2.75,F),zone='sleep')
place('mattress-160',(-4.9,2.75,F+.30),zone='sleep')
place('bed-quilt-160',(-4.9,2.75,F+.40),zone='sleep')
for x in [-5.3,-4.5]:place('bed-pillow',(x,3.46,F+.50),zone='sleep')
for x in [-3.25,-2.35,-1.45]:place('shelf-upright-180',(x,4.0,F),zone='shelving')
for x in [-2.8,-1.9]:
    for z in [.2675,.6675,1.0675,1.4675]:place('shelf-board-090',(x,4.,F+z),zone='shelving')
    for z in [.3075,.7075]:place('storage-basket-040',(x,4.,F+z),zone='shelving')
place(plant,(-2.8,4.,F+1.5075),zone='shelving')
place('gift-box-040',(-1.9,4.,F+1.5075),zone='shelving');place('gift-lid-040',(-1.9,4.,F+1.8325),zone='shelving')
sofa((-1.65,2.55,F),2)
place('woven-rug-240',(-1.65,1.4,F+.005),zone='living')
place('coffee-table-110',(-1.65,1.27,F+.02),zone='living')
for x in [-1.9,-1.4]:place('mug',(x,1.27,F+.432),zone='living')

# Kitchen along the west wall, leaving the entrance route through x=-3 open.
for y,top in [(-2.9,'kitchen-counter-100'),(-1.9,'kitchen-sink-top-100'),(-.9,'kitchen-counter-100')]:
    cabinet((-5.88,y,F),90,top)
place('induction-hob',(-5.88,-2.9,F+.902),90,zone='kitchen')
place('kettle',(-5.9,-2.74,F+.94),90,zone='kitchen')
place('mug',(-5.75,-.9,F+.902),zone='kitchen')
dining((-.2,-2.7,F))

# Outdoor gathering area reuses precisely the same furniture pieces.
sofa((-5.05,-5.95,F),3,90,'terrace-social')
place('coffee-table-110',(-4.05,-5.95,F),90,zone='terrace-social')
place('mug',(-4.05,-6.2,F+.412),zone='terrace-social');place('kettle',(-4.05,-5.8,F+.412),zone='terrace-social')
dining((.1,-5.75,F),zone='terrace-dining')
place('gift-box-040',(.1,-5.75,F+.762),zone='terrace-dining');place('gift-lid-040',(.1,-5.75,F+1.087),zone='terrace-dining')
for x,y in [(-5.65,-7.8),(1.55,-5.0),(-3.6,3.85)]:place('outdoor-lantern-160',(x,y,F),zone='lighting')
place('wayfinding-post',(-1.6,-8.0,F),zone='welcome')
place('wayfinding-panel',(-1.6,-8.07,F+1.28),zone='welcome')
for x,y in [(-5.55,-4.8),(1.55,-6.1)]:place(plant,(x,y,F),zone='terrace-social')

catalog={'stage':'art-review','units':'metres','sourceUp':'Z','glbUp':'Y','assets':manifest,'dependencies':dependencies,
    'assembly':'Roof and south/east wall cutaway of the existing house and terrace. Furniture uses adult dimensions; all instance scales 1.',
    'scope':'Editable art modules, materials and static layout only. No game logic, animation or engine acceptance.'}
(HERE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'assembly.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

# Offline studio only; not part of any asset export.
studio=bpy.data.collections.new('STUDIO / review only');scene.collection.children.link(studio)
material('Studio sand',(.26,.285,.265),0,.84)
start('studio');ground=box('Studio ground',(0,0,-.11),(200,200,.20),'Studio sand',0)
for c in list(ground.users_collection):c.objects.unlink(ground)
studio.objects.link(ground)
def light(name,p,power,size,color,target=(-2,-1,1)):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=p
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
light('Warm key',(-8,-9,14),3000,9,(1,.84,.66))
light('Cool fill',(10,-4,10),2200,9,(.73,.86,1))
light('Soft rim',(-1,9,12),2700,8,(1,.91,.73))
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.43,.57,.68,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.32
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.name='Living kit review camera'
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
scene.render.engine='CYCLES';scene.cycles.samples=72;scene.cycles.use_denoising=True
scene.cycles.max_bounces=12;scene.cycles.transmission_bounces=8
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.3
scene.render.resolution_x=2200;scene.render.resolution_y=1800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene['reference']='art/concepts/selected-warm-sci-fi.png';scene['stage']='Art module review only'
camera_at((14,-22,23),(-1.5,-1.9,1.0),52)
scene.render.filepath=str(REVIEW/'01-furnished-home.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'living-v1.blend'))
if os.environ.get('LIVING_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
camera_at((3,-11,6),(-1.7,-5.75,1.22),50)
scene.render.resolution_x=1920;scene.render.resolution_y=1440
scene.render.filepath=str(REVIEW/'02-terrace-social.png')
if os.environ.get('LIVING_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
camera_at((5,-4,8),(-3.6,1.45,1.2),46)
scene.render.filepath=str(REVIEW/'05-interior-detail.png')
if os.environ.get('LIVING_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)

# Catalog board: common furniture scale; small pieces explicitly marked 2x / 3x.
assembly.hide_render=True
board=bpy.data.collections.new('REVIEW / independent pieces');scene.collection.children.link(board)
small={'kettle','mug','dinner-plate','storage-basket-040','gift-box-040','gift-lid-040','induction-hob'}
items=[e['id'] for e in manifest]
for i,name in enumerate(items):
    x=(i%6-2.5)*2.8;z=(2-i//6)*2.65
    root=place(name,(x,0,z),-24,board,False);root.rotation_euler.x=math.radians(24)
    if name in small:root.scale=(2,2,2) if name in ['gift-box-040','gift-lid-040','induction-hob','storage-basket-040'] else (3,3,3)
    bpy.context.view_layer.update();points=[o.matrix_world@Vector(c) for o in root.children for c in o.bound_box]
    root.location.x+=x-(min(p.x for p in points)+max(p.x for p in points))/2
    root.location.z+=z-(min(p.z for p in points)+max(p.z for p in points))/2
    label=f'{i+1:02} / '+name.upper().replace('-',' ')
    if name in small:label+='  x'+str(int(root.scale.x))
    start('label');o=text3d(label,(x,-2,z-1.10),.105,INK)
    for c in list(o.users_collection):c.objects.unlink(o)
    board.objects.link(o)
start('board');back=box('Catalog backdrop',(0,3,0),(40,.1,30),'Studio sand',0)
for c in list(back.users_collection):c.objects.unlink(back)
board.objects.link(back);ground.hide_render=True
boardlight=light('Catalog fill',(0,-10,2),2300,14,(1,.95,.85),(0,0,0))
camera_at((0,-35,0),(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=18.0
scene.render.resolution_x=2700;scene.render.resolution_y=2100;scene.render.filepath=str(REVIEW/'03-living-modules.png')
if os.environ.get('LIVING_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
board.hide_render=True;board.hide_viewport=True;boardlight.hide_render=True;boardlight.hide_viewport=True
ground.hide_render=False;assembly.hide_render=False;camera.data.type='PERSP'
camera_at((14,-22,23),(-1.5,-1.9,1.0),52)
scene.render.resolution_x=2200;scene.render.resolution_y=1800;scene.render.filepath=str(REVIEW/'01-furnished-home.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'living-v1.blend'))
print(json.dumps({'assets':len(manifest),'dependencies':len(dependencies),'instances':len(layout)}))
