"""Natural environment art modules, authored and rendered in headless Blender.
No gameplay or runtime code. Geometry leaves need no alpha texture or add-on.
"""
from pathlib import Path
KIT_SLUG='nature-v1'
helper=Path(__file__).resolve().parent.parent/'habitat-v2/build_habitat.py'
exec(compile(helper.read_text(encoding='utf-8').split('# -- End shared art helpers --')[0],str(helper),'exec'))

shared_finish=finish
def finish(name,nominal,sockets):
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
    points=[o.matrix_world@v.co for o in assets[name]['parts'] for v in o.data.vertices]
    low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)]
    manifest[-1]['sourceDimensionsXYZ']=[round(b-a,5) for a,b in zip(low,high)]
    manifest[-1]['sourceBoundsXYZ']={'min':low,'max':high}

STONE='N01 / warm weathered granite';material(STONE,(.31,.30,.23),0,.88)
STRATA='N02 / pale stone strata';material(STRATA,(.43,.41,.32),0,.86)
BARK='N03 / warm ridged bark';material(BARK,(.19,.105,.042),0,.92)
BARKLIGHT='N04 / bark ridges';material(BARKLIGHT,(.27,.17,.072),0,.91)
LEAFD='N05 / olive leaf shade';material(LEAFD,(.075,.16,.023),0,.82)
LEAFM='N06 / olive leaf mid';material(LEAFM,(.14,.255,.043),0,.78)
LEAFL='N07 / sunlit young leaf';material(LEAFL,(.25,.37,.075),0,.76)
GRASS='N08 / meadow blade';material(GRASS,(.19,.28,.055),0,.89)
DRY='N09 / dry grass and litter';material(DRY,(.38,.29,.11),0,.94)
MOSS='N10 / soft moss';material(MOSS,(.16,.235,.042),0,.95)
SOIL='N11 / warm garden loam';material(SOIL,(.22,.135,.065),0,.96)
PATH='N12 / ochre walking earth';material(PATH,(.40,.285,.145),0,.93)
GROUND='N13 / meadow soil';material(GROUND,(.18,.23,.07),0,.96)
PETAL='N14 / amber flower petals';material(PETAL,(.84,.365,.058),0,.70)
CREAM='N15 / ivory flower petals';material(CREAM,(.83,.76,.50),0,.72)
SEED='N16 / dark pollen';material(SEED,(.18,.093,.025),0,.95)
RUSSET='N17 / copper rosette leaf';material(RUSSET,(.37,.13,.065),0,.77)
RUSSETL='N18 / copper leaf edge';material(RUSSETL,(.53,.23,.11),0,.81)
PATHEDGE='N19 / dusty path edge';material(PATHEDGE,(.30,.245,.12),0,.95)
SOILFADE='N20 / loam transition';material(SOILFADE,(.205,.18,.067),0,.96)

# Portable repeating surface maps. Tiny mineral/bark/earth variation is in the
# exported normal maps, not in a render-only procedural shader.
def surface_finish(mat,kind,seed):
    rg=np.random.default_rng(seed);yy,xx=np.mgrid[0:n,0:n]
    h=np.zeros((n,n),dtype=np.float32)
    # Periodic random value noise has no crossed sinusoidal stripes. Smooth
    # interpolation keeps it seamless while avoiding a woven/plaid appearance.
    for freq,amp in [(3,.22),(7,.12),(17,.06),(45,.03)]:
        grid=rg.uniform(-1,1,(freq,freq));q=np.arange(n)*freq/n
        lo=np.floor(q).astype(int);hi=(lo+1)%freq;w=q-lo;w=w*w*(3-2*w)
        row0=grid[lo[:,None],lo[None,:]]*(1-w[None,:])+grid[lo[:,None],hi[None,:]]*w[None,:]
        row1=grid[hi[:,None],lo[None,:]]*(1-w[None,:])+grid[hi[:,None],hi[None,:]]*w[None,:]
        h+=amp*(row0*(1-w[:,None])+row1*w[:,None])
    h+=rg.uniform(-.012,.012,(n,n))
    if kind=='bark':h+=.12*np.sin(2*math.pi*19*xx/n+.8*np.sin(2*math.pi*yy/n))
    dx=np.roll(h,1,1)-np.roll(h,-1,1);dy=np.roll(h,1,0)-np.roll(h,-1,0)
    normal=image_map(kind+'-normal',np.stack((.5+dx*.9,.5+dy*.9,np.ones_like(h)),axis=-1))
    m=materials[mat];p=m.node_tree.nodes.get('Principled BSDF')
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=normal
    nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.55
    m.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    # Base color variation remains subtle and periodic on each UV tile.
    base=np.array(p.inputs['Base Color'].default_value[:3]);rgb=np.clip(base[None,None,:]*(1+h[:,:,None]*.5),0,1)
    encoded=np.where(rgb<=.0031308,rgb*12.92,1.055*np.power(rgb,1/2.4)-.055)
    written=image_map(kind+'-color',encoded.astype(np.float32));bpy.data.images.remove(written)
    teximg=bpy.data.images.load(str(TEX/(kind+'-color.png')),check_existing=False)
    teximg.colorspace_settings.name='sRGB';teximg.pack()
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=teximg
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
surface_finish(STONE,'granite',4);surface_finish(BARK,'bark',8)
surface_finish(GROUND,'meadow',15);surface_finish(PATH,'earth',19)

def tapered_branch(name,points,radii,mat=BARK,sides=9):
    vs=[]
    for j,p in enumerate(points):
        p=Vector(p);direction=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
        direction.normalize();u=direction.cross(Vector((0,1,0)))
        if u.length<.01:u=direction.cross(Vector((1,0,0)))
        u.normalize();v=direction.cross(u).normalized()
        for i in range(sides):
            t=2*math.pi*i/sides;rough=1+.07*math.sin(i*7+j*1.2)
            vs.append(tuple(p+(u*math.cos(t)+v*math.sin(t))*radii[j]*rough))
    fs=[tuple(range(sides-1,-1,-1))]
    for j in range(len(points)-1):
        for i in range(sides):a=j*sides+i;b=j*sides+(i+1)%sides;fs.append((a,b,b+sides,a+sides))
    fs.append(tuple(range((len(points)-1)*sides,len(points)*sides)))
    o=mesh(name,vs,fs,mat)
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return o

def leaf_geometry(p,direction,length,width,roll=0,bend=.14):
    p=Vector(p);axis=Vector(direction).normalized();side=axis.cross(Vector((0,0,1)))
    if side.length<.05:side=axis.cross(Vector((0,1,0)))
    side.normalize();normal=side.cross(axis).normalized()
    q=Matrix.Rotation(roll,4,axis);side=q@side;normal=q@normal
    # A pointed, folded lanceolate leaf: twelve triangles, no transparent card.
    vs=[tuple(p)]
    for t,w in [(.28,.68),(.58,1),(.82,.62)]:
        center=p+axis*(length*t)+normal*(length*bend*math.sin(math.pi*t))
        vs.extend([tuple(center-side*width*w*.5),tuple(center+normal*width*.12),tuple(center+side*width*w*.5)])
    vs.append(tuple(p+axis*length+normal*length*bend*.3))
    fs=[(0,1,2),(0,2,3),(1,4,5,2),(2,5,6,3),(4,7,8,5),(5,8,9,6),(7,10,8),(8,10,9)]
    return vs,fs

def leaf_batch(name,specs,mat):
    if not specs:return None
    vs=[];fs=[]
    for spec in specs:
        verts,faces=leaf_geometry(*spec);base=len(vs);vs.extend(verts);fs.extend(tuple(base+i for i in f) for f in faces)
    return mesh(name,vs,fs,mat,smooth=True)

def rock(name,p,size,seed,mat=STONE,sub=3):
    rg=random.Random(seed);bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=p);o=bpy.context.object
    for v in o.data.vertices:
        x,y,z=v.co;factor=1+.10*math.sin(4*x+3*y+seed)+.065*math.sin(6*z-2*y)+rg.uniform(-.035,.035)
        v.co.x=x*size[0]*.5*factor+.06*size[0]*z
        v.co.y=y*size[1]*.5*factor
        v.co.z=max(-.62,z*factor)*size[2]/1.62+.62*size[2]/1.62
    register(o,name,mat)
    # Broad planes with small rounded transitions look weathered without a toy
    # sphere silhouette; stone profile and texture carry detail at camera range.
    bevel(o,.012*min(size),2)
    return o

def terrain_tile(name,loam=False):
    start(name);k=20;vs=[]
    for j in range(k+1):
        y=-2+4*j/k
        for i in range(k+1):
            x=-2+4*i/k
            z=0
            vs.append((x,y,z))
    fs=[]
    for j in range(k):
        for i in range(k):a=j*(k+1)+i;fs.append((a,a+1,a+k+2,a+k+1))
    edge=list(range(k+1))+[j*(k+1)+k for j in range(1,k+1)]+[k*(k+1)+i for i in range(k-1,-1,-1)]+[j*(k+1) for j in range(k-1,0,-1)]
    base=len(vs);vs.extend((vs[i][0],vs[i][1],-.16) for i in edge)
    for i,a in enumerate(edge):b=edge[(i+1)%len(edge)];fs.append((a,base+i,base+(i+1)%len(edge),b))
    fs.append(tuple(range(base+len(edge)-1,base-1,-1)))
    mesh('Tile with shared level boundary',vs,fs,GROUND)
    if loam:
        # A curved, softly colored soil patch replaces pixel-shaped face masks.
        rings=[];count=64
        for radius in [.73,.88,1.0]:
            rings.append([(1.48*radius*(1+.055*math.sin(5*t)+.04*math.cos(9*t))*math.cos(t),1.10*radius*(1+.06*math.cos(7*t))*math.sin(t),.0015) for t in [i*2*math.pi/count for i in range(count)]])
        mesh('Loam center',rings[0],[tuple(range(count))],SOIL)
        for i,mat in enumerate([SOILFADE,GROUND]):
            rv=rings[i]+rings[i+1];rf=[(j,(j+1)%count,(j+1)%count+count,j+count) for j in range(count)]
            mesh('Soft loam perimeter '+str(i),rv,rf,mat)
    finish(name,[4,4,.18],{'west':[-2,0,0],'east':[2,0,0],'south':[0,-2,0],'north':[0,2,0]})
terrain_tile('terrain-meadow-4m');terrain_tile('terrain-loam-4m',True)

def path_strip(name,turn=False):
    start(name);steps=20
    widths=[-.83,-.65,-.55,.55,.65,.83];heights=[0,.018,.027,.027,.018,0]
    for lane in range(5):
        vs=[];fs=[]
        for j in range(steps+1):
            t=j/steps
            if turn:
                angle=t*math.pi/2;center=Vector((1-math.cos(angle),-1+math.sin(angle),0));side=Vector((-math.cos(angle),math.sin(angle),0))
            else:center=Vector((0,-1+2*t,0));side=Vector((1,0,0))
            for i in [lane,lane+1]:
                # Ends stay exact. Natural edge variation tapers to zero there.
                delta=(.022 if i in [0,5] else .016)*math.sin(11*t+i)*math.sin(math.pi*t)
                point=center+side*(widths[i]+delta);point.z=heights[i]
                vs.append(tuple(point))
        for j in range(steps):fs.append((2*j,2*j+1,2*j+3,2*j+2))
        mesh('Earth path band '+str(lane),vs,fs,PATH if lane==2 else PATHEDGE if lane in [1,3] else GROUND,smooth=True)
    sockets={'south':[0,-1,0],('east' if turn else 'north'):([1,0,0] if turn else [0,1,0])}
    finish(name,[2,2,.03],sockets)
path_strip('path-straight-2m');path_strip('path-turn-2m',True)

start('path-junction-2m')
# Three arms: north, west and east. The south edge blends back into meadow.
k=40;vs=[]
for j in range(k+1):
    for i in range(k+1):
        x=-1+i*2/k;y=-1+j*2/k
        dist=min(abs(y),abs(x) if y>=0 else math.hypot(x,y))
        z=.027 if dist<=.55 else .027-(dist-.55)*.09 if dist<=.65 else max(0,.018-(dist-.65)*.018/.18)
        vs.append((x,y,z))
groups=[[],[],[]]
for j in range(k):
    for i in range(k):
        a=j*(k+1)+i;x=-1+(i+.5)*2/k;y=-1+(j+.5)*2/k
        d=min(abs(y),abs(x) if y>=0 else math.hypot(x,y));group=0 if d<=.55 else 1 if d<=.65 else 2
        if d>.83:continue
        groups[group].append((a,a+1,a+k+2,a+k+1))
for label,faces,mat in zip(['Walkable earth','Soft loam edge','Meadow transition'],groups,[PATH,PATHEDGE,GROUND]):
    used=sorted({i for face in faces for i in face});mapping={v:i for i,v in enumerate(used)}
    mesh(label,[vs[i] for i in used],[tuple(mapping[v] for v in face) for face in faces],mat,smooth=True)
finish(current,[2,2,.03],{'west':[-1,0,0],'east':[1,0,0],'north':[0,1,0]})

start('stepping-stone-060');rock('Flat walking stone',(0,0,0),(.64,.49,.095),70,STRATA)
finish(current,[.64,.49,.10],{'ground':[0,0,0]})
for name,size,seed in [('boulder-large-250',(2.5,1.85,1.58),18),('boulder-medium-120',(1.2,.91,.79),31),('rock-slab-160',(1.6,1.12,.38),43)]:
    start(name);rock('Weathered stone', (0,0,0),size,seed)
    # A few embedded pale inclusions and a natural base complement the silhouette.
    rg=random.Random(seed)
    for j in range(3):
        p=(rg.uniform(-.28,.28)*size[0],rg.uniform(-.28,.28)*size[1],size[2]*rg.uniform(.45,.65))
        rock('Pale mineral inclusion',p,(size[0]*.22,size[1]*.16,size[2]*.14),seed+j+60,STRATA,2)
    finish(name,list(size),{'ground':[0,0,0]})
start('pebble-cluster-060')
for i in range(9):
    rg=random.Random(40+i);rock('Loose pebble',(rg.uniform(-.25,.25),rg.uniform(-.22,.22),0),(rg.uniform(.08,.16),rg.uniform(.06,.12),rg.uniform(.035,.08)),100+i,STONE,2)
finish(current,[.65,.60,.08],{'ground':[0,0,0]})

# The crown and trunk for each tree share the ground/root origin. Crown sockets
# match the twig ends, making foliage replaceable without repositioning the tree.
mature_centers=[(-1.42,-.64,3.50),(-1.48,.72,3.88),(-.33,-1.05,4.07),(.9,-.88,3.71),(1.47,.14,4.0),(1.02,1.05,4.38),(-.55,1.17,4.57),(.05,-.02,5.0),(-.72,.12,4.70)]
young_centers=[(-.62,-.18,2.04),(.67,-.27,2.22),(.39,.61,2.57),(-.43,.53,2.65),(.03,.02,3.12)]
def tree_trunk(name,centers,height,radius):
    start(name)
    tapered_branch('Curving main trunk',[(0,0,0),(.05,0,.22),(-.09,.04,height*.32),(.10,.03,height*.59),(.02,.03,height*.82),centers[-2 if len(centers)>6 else -1]],
        [radius*1.9,radius*1.16,radius*.90,radius*.64,radius*.36,.025],BARK,14)
    for i,tip in enumerate(centers):
        base=Vector((.02,.02,height*(.35+.04*(i%4))))
        middle=base.lerp(Vector(tip),.55);middle.z+=.18
        tapered_branch('Spreading branch '+str(i),[base,middle,Vector(tip)], [radius*.50,.07 if height>3 else .042,.018],BARK,9)
        for a in [-.8,.8]:
            end=Vector(tip)+Vector((.36*math.cos(i+a),.36*math.sin(i+a),.12))
            tapered_branch('Crown twig '+str(i),[middle.lerp(Vector(tip),.6),Vector(tip),end],[.028,.016,.006],BARK,6)
    for i in range(5):
        a=i*2*math.pi/5+.17
        tapered_branch('Root flare',[(0,0,.20),(radius*1.5*math.cos(a),radius*1.5*math.sin(a),.07),(radius*2.5*math.cos(a),radius*2.5*math.sin(a),.005)],[radius*.65,radius*.35,.025],BARK,8)
    finish(name,[radius*5,radius*5,height],{'root':[0,0,0],**{'crown-'+str(i):list(p) for i,p in enumerate(centers)}})

def tree_crown(name,centers,seed,young=False):
    start(name);rg=random.Random(seed);groups=[[],[],[]]
    for j,center in enumerate(centers):
        c=Vector(center);spread=.70 if young else .98
        # Many small leaf sprays build an irregular, porous canopy. No hidden
        # sphere or solid blob is used under the visible foliage.
        for sprig in range(36 if young else 48):
            direction=Vector((rg.uniform(-1,1),rg.uniform(-1,1),rg.uniform(-.35,.8))).normalized()
            origin=c+Vector((rg.uniform(-.56,.56),rg.uniform(-.56,.56),rg.uniform(-.35,.35)))*spread
            stemlen=rg.uniform(.19,.43)
            end=origin+direction*stemlen
            tapered_branch('Fine foliage twig',[origin,end],[.006,.0025],BARK,5)
            for side in [-1,1]:
                for t in [.22,.52,.82]:
                    p=origin+direction*stemlen*t
                    d=Vector((-direction.y*side,direction.x*side,.20))+direction*.35
                    groups[rg.choices([0,1,2],[.26,.52,.22])[0]].append((p,d,rg.uniform(.18,.30),rg.uniform(.065,.11),rg.uniform(-.65,.65),.16))
    for i,mat in enumerate([LEAFD,LEAFM,LEAFL]):leaf_batch('Canopy leaves '+str(i),groups[i],mat)
    finish(name,[3,3,3.6] if young else [5.2,4.8,5.7],{'root':[0,0,0],**{'crown-'+str(i):list(p) for i,p in enumerate(centers)}})
tree_trunk('tree-trunk-mature',mature_centers,4.50,.18)
tree_crown('tree-crown-mature',mature_centers,104)
tree_trunk('tree-trunk-young',young_centers,2.8,.10)
tree_crown('tree-crown-young',young_centers,118,True)

def flower_head(p,r,mat,phase=0):
    specs=[]
    for j in range(8):
        a=j*math.pi/4+phase;specs.append((p,(math.cos(a),math.sin(a),.20),r,.055 if r>.1 else .035,.05,.08))
    leaf_batch('Individual flower petals',specs,mat)
    cylinder('Pollen center',Vector(p)-Vector((0,0,.006)),Vector(p)+Vector((0,0,.017)),r*.28,SEED,12)

def shrub(name,seed,flowers=False):
    start(name);rg=random.Random(seed);groups=[[],[],[]]
    for i in range(15):
        angle=i*2.399;height=rg.uniform(.43,.77);tip=Vector((math.cos(angle)*.33,math.sin(angle)*.33,height))
        tapered_branch('Woody shrub stem',[(0,0,0),tip*.50,tip],[.022,.012,.004],BARK,6)
        for j in range(14):
            p=tip*rg.uniform(.35,1.05)+Vector((rg.uniform(-.18,.18),rg.uniform(-.18,.18),rg.uniform(-.06,.12)))
            a=rg.uniform(0,2*math.pi);groups[rg.randrange(3)].append((p,(math.cos(a),math.sin(a),rg.uniform(.05,.6)),rg.uniform(.13,.23),rg.uniform(.06,.11),rg.uniform(-.3,.3),.12))
        if flowers and i%2==0:flower_head(tip+Vector((0,0,.05)),.09,CREAM,angle)
    for i,mat in enumerate([LEAFD,LEAFM,LEAFL]):leaf_batch('Shrub foliage '+str(i),groups[i],mat)
    finish(name,[1.2,1.2,.95],{'root':[0,0,0]})
shrub('shrub-rounded-090',12);shrub('shrub-flowering-080',24,True)

start('fern-clump-060');specs=[]
for j in range(10):
    a=j*2.399;length=.50+.13*math.sin(j*1.3);dx,dy=math.cos(a),math.sin(a)
    pts=[]
    for i in range(9):
        t=i/8;pts.append((dx*length*t,dy*length*t,.05+.62*math.sin(t*math.pi*.70)))
    tapered_branch('Fern central rib',pts,[.006*(1-i/10) for i in range(9)],LEAFM,5)
    for i in range(1,8):
        p=Vector(pts[i]);t=i/8
        for side in [-1,1]:specs.append((p,(-dy*side+dx*.32,dx*side+dy*.32,.16),.18*(1-t*.78),.045*(1-t*.6),0,.14))
leaf_batch('Paired fern pinnae',specs,LEAFM)
finish(current,[1.25,1.25,.68],{'root':[0,0,0]})

def grass_tuft(name,seed,clusters,height):
    start(name);rg=random.Random(seed);groups=[[],[],[]]
    for c in range(clusters):
        cx=rg.uniform(-.23,.23) if clusters>1 else 0;cy=rg.uniform(-.23,.23) if clusters>1 else 0
        for i in range(32):
            a=rg.uniform(0,2*math.pi);p=(cx+rg.uniform(-.055,.055),cy+rg.uniform(-.055,.055),0)
            groups[rg.choices([0,1,2],[.4,.5,.1])[0]].append((p,(math.cos(a)*.55,math.sin(a)*.55,1),rg.uniform(height*.45,height),rg.uniform(.012,.025),rg.uniform(-.3,.3),.28))
    for specs,mat in zip(groups,[GRASS,LEAFL,DRY]):leaf_batch('Curved grass blades',specs,mat)
    finish(name,[.35,.35,height] if clusters==1 else [.9,.9,height],{'root':[0,0,0]})
grass_tuft('grass-tuft-035',81,1,.35);grass_tuft('grass-clump-065',91,5,.65)

def wildflowers(name,seed,mat,height):
    start(name);rg=random.Random(seed);specs=[]
    for j in range(7):
        a=j*2.399;root=Vector((math.cos(a)*.16,math.sin(a)*.16,0));tip=root+Vector((rg.uniform(-.09,.09),rg.uniform(-.09,.09),height*rg.uniform(.64,1)))
        tapered_branch('Flower stem',[root,root.lerp(tip,.5),tip],[.005,.004,.002],LEAFM,6)
        flower_head(tip,.095 if mat==PETAL else .10,mat,a)
        for t in [.23,.45,.66]:
            aa=a+t*9;specs.append((root.lerp(tip,t),(math.cos(aa),math.sin(aa),.22),.12,.045,0,.14))
    leaf_batch('Flower lanceolate leaves',specs,LEAFM)
    finish(name,[.65,.65,height+.05],{'root':[0,0,0]})
wildflowers('flower-amber-045',51,PETAL,.45);wildflowers('flower-ivory-055',66,CREAM,.55)

start('alien-rosette-070');specs=[[],[]]
for j in range(26):
    a=j*2.399;outer=j<15;length=.53 if outer else .38
    specs[j%2].append(((0,0,.035),(math.cos(a),math.sin(a),.45 if outer else 1.6),length,.10 if outer else .085,0,.36))
for group,mat in zip(specs,[RUSSET,RUSSETL]):leaf_batch('Curved copper rosette leaves',group,mat)
finish(current,[1.0,1.0,.53],{'root':[0,0,0]})

start('moss-patch-100');specs=[];rg=random.Random(122)
for i in range(180):
    a=rg.uniform(0,2*math.pi);r=math.sqrt(rg.random())*.48;p=(r*math.cos(a),r*.74*math.sin(a),.006)
    specs.append((p,(rg.uniform(-.4,.4),rg.uniform(-.4,.4),1),rg.uniform(.025,.067),.015,0,.20))
leaf_batch('Small moss leaflets',specs,MOSS)
finish(current,[1,.75,.08],{'ground':[0,0,0]})
start('ground-leaf-litter-080');groups=[[],[]];rg=random.Random(138)
for i in range(35):
    a=rg.uniform(0,2*math.pi);p=(rg.uniform(-.33,.33),rg.uniform(-.3,.3),.004)
    groups[i%2].append((p,(math.cos(a),math.sin(a),.04),rg.uniform(.07,.14),rg.uniform(.025,.045),rg.uniform(-.2,.2),.07))
for specs,mat in zip(groups,[DRY,BARKLIGHT]):leaf_batch('Curled fallen leaves',specs,mat)
finish(current,[.86,.80,.04],{'ground':[0,0,0]})

# -- End natural modules --

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

assembly=bpy.data.collections.new('ASSEMBLY / garden neighborhood');scene.collection.children.link(assembly)
def place(name,p=(0,0,0),angle=0,coll=assembly,record=True,zone=''):
    if zone in ['tree-trunk','tree-crown','understory','moss','botanical-detail','rock']:
        p=(p[0],p[1],p[2]-.008)
    root=bpy.data.objects.new(name+' instance',None);coll.objects.link(root)
    root.location=p;root.rotation_euler.z=math.radians(angle);root['asset']=name;root['zone']=zone
    for original in assets[name]['parts']:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:layout.append({'asset':name,'positionZUp':list(p),'yawZ':angle,'zone':zone})
    return root

for item in json.loads((PROJECT/'art/source/connections-v1/assembly.json').read_text(encoding='utf-8')):
    if item['zone']=='furniture':continue
    name=item['asset']
    if name.startswith('habitat/'):key=load_dependency('habitat','habitat-v2',name.split('/')[1])
    elif name.startswith('garden/'):key=load_dependency('garden','greenhouse-v1',name.split('/')[1])
    else:key=load_dependency('connections','connections-v1',name)
    place(key,item['positionZUp'],item['yawZ'],zone='architecture')
for item in json.loads((PROJECT/'art/source/living-v1/assembly.json').read_text(encoding='utf-8')):
    if item['zone'] not in ['terrace-social','terrace-dining','welcome','lighting'] or item['positionZUp'][1]>0:continue
    name=item['asset']
    key=load_dependency('habitat','habitat-v2',name.split('/')[1]) if name.startswith('habitat/') else load_dependency('living','living-v1',name)
    place(key,item['positionZUp'],item['yawZ'],zone='outdoor-furniture')

# 4 m repeatable tiles: a 24 x 24 m art study, not a planetary terrain system.
for x in [-8,-4,0,4,8,12]:
    for y in [-12,-8,-4,0,4,8]:
        name='terrain-loam-4m' if (x,y) in [(12,-4),(-8,4),(8,4)] else 'terrain-meadow-4m'
        place(name,(x,y,0),zone='terrain')

# The path is laid on a 2 m grid; socket positions are shared by straight, turn
# and T pieces. Building landings are completed with independent stepping stones.
for x in [-5,-3,-1,1,3,5,7,9]:
    if x in [-3,5]:name='path-junction-2m';a=0
    elif x==9:name='path-turn-2m';a=180
    else:name='path-straight-2m';a=90
    place(name,(x,-11,0),a,zone='path')
for x in [5,9]:place('path-straight-2m',(x,-9,0),zone='path')
for p,a in [((-3,-10.03,0),0),((5.6,-7.75,0),-24),((9.25,-7.7,0),25),((9.48,-7.2,0),-14)]:
    place('stepping-stone-060',p,a,zone='landing-stone')

def tree(p,young=False,angle=0):
    size='young' if young else 'mature'
    place('tree-trunk-'+size,p,angle,zone='tree-trunk');place('tree-crown-'+size,p,angle,zone='tree-crown')
for p,a in [((-9.0,3.6,0),14),((-4.6,7.7,0),104),((3.0,7.7,0),228),((11.8,5.7,0),312)]:tree(p,False,a)
for p,a in [((-8.3,-4.2,0),88),((5.7,4.9,0),185),((12,-.4,0),270),((11.8,-8.3,0),126)]:tree(p,True,a)
for name,p,a in [
    ('boulder-large-250',(-8.1,6.5,0),18),('boulder-large-250',(10.5,7.8,0),112),
    ('boulder-medium-120',(-8.7,-7.8,0),70),('boulder-medium-120',(7.65,-9.0,0),150),
    ('boulder-medium-120',(12.3,-4.8,0),23),('rock-slab-160',(7.1,-12.6,0),-10),
    ('rock-slab-160',(-7.8,-.2,0),55),('rock-slab-160',(4.3,5.6,0),9)]:place(name,p,a,zone='rock')

blocked=[(-7.0,3.0,-5.0,5.0),(-6.5,2.6,-9.1,-4.0),(2.1,6.8,-2.6,.7),(6.0,11.1,-4.6,3.0),
    (8.0,10.9,-7.8,-3.5),(1.7,6.4,-8.8,-6.2),(-6.2,10.,-11.95,-10.05),(4.05,5.95,-10.1,-7.7),(8.05,9.95,-10.1,-7.65)]
def permitted(x,y,margin=0):
    return not any(x0-margin<x<x1+margin and y0-margin<y<y1+margin for x0,x1,y0,y1 in blocked)

rg=random.Random(440)
for i in range(170):
    for attempt in range(100):
        x=rg.uniform(-9.0,13.0);y=rg.uniform(-13.0,8.8)
        if permitted(x,y,.35):break
    else:continue
    name=rg.choices(['grass-tuft-035','grass-clump-065','flower-amber-045','flower-ivory-055','fern-clump-060','shrub-rounded-090','shrub-flowering-080','alien-rosette-070','pebble-cluster-060'],[22,18,11,9,9,5,4,3,5])[0]
    if name.startswith('shrub') and not permitted(x,y,.75):name='grass-tuft-035'
    place(name,(x,y,0),rg.uniform(0,360),zone='understory')
for x,y in [(-9.0,3.6),(-4.6,7.7),(3,7.7),(11.8,5.7),(-8.3,-4.2),(12,-.4)]:
    for i in range(4):
        a=i*2.399;place('ground-leaf-litter-080',(x+.65*math.cos(a),y+.65*math.sin(a),0),i*55,zone='litter')
    place('moss-patch-100',(x+.3,y-.2,0),43,zone='moss')
# Deliberately composed foreground botanical group for the close art review.
for name,p,a in [('fern-clump-060',(6.8,-9.0,0),30),('flower-ivory-055',(7.55,-9.65,0),55),
    ('flower-amber-045',(6.9,-9.65,0),14),('alien-rosette-070',(8.8,-12.6,0),-20),
    ('grass-clump-065',(8,-12.8,0),33),('moss-patch-100',(7.7,-9.1,0),0)]:place(name,p,a,zone='botanical-detail')

catalog={'stage':'art-review','units':'metres','sourceUp':'Z','glbUp':'Y','assets':manifest,'dependencies':dependencies,
    'assembly':'24 x 24 m landscape around the existing house, greenhouse and terrace. All assembly scales 1.',
    'scope':'Static natural art modules and editable scene only; no terrain generation, wind, collisions or engine performance acceptance.'}
(HERE/'asset-catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'assembly.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

studio=bpy.data.collections.new('STUDIO / review only');scene.collection.children.link(studio)
material('Nature studio ground',(.235,.25,.205),0,.92)
start('studio');ground=box('Studio backdrop',(0,0,-.21),(200,200,.1),'Nature studio ground',0)
for c in list(ground.users_collection):c.objects.unlink(ground)
studio.objects.link(ground)
def light(name,p,power,size,color,target=(0,0,0)):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=p
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
sun_data=bpy.data.lights.new('Late afternoon sun','SUN');sun_data.energy=2.1;sun_data.angle=math.radians(9);sun_data.color=(1,.88,.66)
sun=bpy.data.objects.new('Late afternoon sun',sun_data);studio.objects.link(sun);sun.rotation_euler=(math.radians(27),math.radians(-24),math.radians(-32))
light('Soft sky fill',(4,-12,14),1800,14,(.70,.84,1),(1,-2,0))
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.48,.61,.72,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.43
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.name='Natural environment review camera'
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.cycles.max_bounces=14;scene.cycles.transmission_bounces=12
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.15
scene.render.resolution_x=2400;scene.render.resolution_y=1800;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene['reference']='art/concepts/selected-warm-sci-fi.png';scene['stage']='Natural art kit review only'
camera_at((28,-37,26),(1,-1.5,1.0),49)
scene.render.filepath=str(REVIEW/'01-landscaped-home.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'nature-v1.blend'))
if os.environ.get('NATURE_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
camera_at((5,-20,6.8),(-.5,-6.5,1.2),46)
scene.render.resolution_x=2200;scene.render.resolution_y=1500;scene.render.filepath=str(REVIEW/'02-garden-arrival.png')
if os.environ.get('NATURE_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
camera_at((11.1,-13.3,3.1),(7.7,-9.6,.35),55)
scene.render.resolution_x=1920;scene.render.resolution_y=1440;scene.render.filepath=str(REVIEW/'05-botanical-detail.png')
if os.environ.get('NATURE_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)

assembly.hide_render=True
board=bpy.data.collections.new('REVIEW / natural parts');scene.collection.children.link(board)
scale_map={'terrain-meadow-4m':.7,'terrain-loam-4m':.7,'tree-trunk-mature':.48,'tree-crown-mature':.48,'tree-trunk-young':.70,'tree-crown-young':.70}
for name in ['grass-tuft-035','flower-amber-045','flower-ivory-055','moss-patch-100','ground-leaf-litter-080','pebble-cluster-060','stepping-stone-060']:scale_map[name]=2
for i,entry in enumerate(manifest):
    name=entry['id'];x=(i%6-2.5)*3.8;z=(1.5-i//6)*3.65
    root=place(name,(x,0,z),-25,board,False);root.rotation_euler.x=math.radians(25)
    s=scale_map.get(name,1);root.scale=(s,s,s)
    bpy.context.view_layer.update();points=[o.matrix_world@Vector(c) for o in root.children for c in o.bound_box]
    root.location.x+=x-(min(p.x for p in points)+max(p.x for p in points))/2
    root.location.z+=z-(min(p.z for p in points)+max(p.z for p in points))/2
    label=f'{i+1:02} / '+name.upper().replace('-',' ')+(f' x{s:g}' if s!=1 else '')
    start('label');o=text3d(label,(x,-2.8,z-1.48),.13,INK)
    for c in list(o.users_collection):c.objects.unlink(o)
    board.objects.link(o)
start('board');back=box('Natural catalog backdrop',(0,3,0),(45,.1,30),'Nature studio ground',0)
for c in list(back.users_collection):c.objects.unlink(back)
board.objects.link(back);ground.hide_render=True;sun.hide_render=True
boardlight=light('Natural catalog fill',(0,-12,5),4800,16,(1,.94,.82))
camera_at((0,-40,0),(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=24.5
scene.render.resolution_x=2800;scene.render.resolution_y=1850;scene.render.filepath=str(REVIEW/'03-nature-modules.png')
if os.environ.get('NATURE_SKIP_RENDER')!='1':bpy.ops.render.render(write_still=True)
board.hide_render=True;board.hide_viewport=True;boardlight.hide_render=True;boardlight.hide_viewport=True
ground.hide_render=False;sun.hide_render=False;assembly.hide_render=False;camera.data.type='PERSP'
camera_at((28,-37,26),(1,-1.5,1.0),49)
scene.render.resolution_x=2400;scene.render.resolution_y=1800;scene.render.filepath=str(REVIEW/'01-landscaped-home.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'nature-v1.blend'))
print(json.dumps({'assets':len(manifest),'dependencies':len(dependencies),'instances':len(layout)}))
