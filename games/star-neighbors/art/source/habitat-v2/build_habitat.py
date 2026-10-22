"""Editable habitat art kit. Run in background Blender; no game logic is authored.

Source: Blender Z-up, metres. GLB: standard Y-up. Wall fronts face -Y in source
and +Z in GLB. Object names retain the assembly's individual manufactured parts.
"""
from pathlib import Path
import bpy, bmesh, math, json, random, os
import numpy as np
from mathutils import Vector, Matrix

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
KIT_SLUG = globals().get('KIT_SLUG', 'habitat-v2')
OUT = PROJECT / 'art/models' / KIT_SLUG
REVIEW = PROJECT / 'art/reviews' / KIT_SLUG
TEX = HERE / 'textures'
for p in (OUT, REVIEW, TEX): p.mkdir(parents=True, exist_ok=True)
random.seed(1022)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for s in list(bpy.data.scenes)[1:]: bpy.data.scenes.remove(s)
scene = bpy.context.scene
scene.name = '01 / Assembled habitat'
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
library = bpy.data.collections.new('LIBRARY / Independent modules')
scene.collection.children.link(library)
materials, assets, parts, manifest, layout = {}, {}, [], [], []
current = None

# Portable microfinish maps; the same image nodes are exported with each GLB.
# No render-only noise shader or geometry-node dependency in the delivered kit.
n = 512
rng = np.random.default_rng(82)
height = rng.random((n, n)).astype(np.float32)
height = sum(np.roll(np.roll(height, a, 0), b, 1) for a,b in [(0,0),(1,0),(-1,0),(0,1),(0,-1)]) / 5
rough = np.clip(.52 + (height-.5)*.30, .40, .64)
dx = np.roll(height,1,1)-np.roll(height,-1,1)
dy = np.roll(height,1,0)-np.roll(height,-1,0)
normal = np.stack((.5+dx*.08, .5+dy*.08, np.ones_like(height)), axis=-1)

def image_map(name, rgb):
    image = bpy.data.images.new(name, n, n, alpha=False)
    rgba = np.concatenate([rgb, np.ones((n,n,1), dtype=np.float32)],axis=-1)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(rgba.ravel())
    image.update()
    image.filepath_raw = str(TEX/(name+'.png')); image.file_format = 'PNG'; image.save()
    image.pack()
    return image

rough_image = image_map('paint-roughness', np.repeat(rough[:,:,None],3,axis=-1))
normal_image = image_map('paint-normal', normal)

def material(name, color, metal=0, roughness=.5, finish=False, emission=0):
    m = bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=roughness
    if finish:
        tex=m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=rough_image
        m.node_tree.links.new(tex.outputs['Color'],p.inputs['Roughness'])
        tex=m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=normal_image
        nm=m.node_tree.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.32
        m.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color'])
        m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1)
        p.inputs['Emission Strength'].default_value=emission
    m.diffuse_color=(*color,1); materials[name]=m
    return m

material('01 • warm porcelain paint',(.68,.62,.49),.14,finish=True)
material('02 • inner shell',(.45,.44,.36),.08,.63)
material('03 • ochre enamel',(.72,.265,.042),.22,finish=True)
material('04 • graphite gasket',(.025,.038,.039),.05,.68)
material('05 • brushed titanium',(.23,.29,.28),.76,.30)
material('06 • dark anodized frame',(.065,.096,.101),.70,.35)
material('07 • smoked teal glass',(.91,.97,.95),0,.018)
p=materials['07 • smoked teal glass'].node_tree.nodes.get('Principled BSDF')
p.inputs['Transmission Weight'].default_value=1
p.inputs['IOR'].default_value=1.45
p.inputs['Coat Weight'].default_value=.25
material('08 • cyan indicator',(.10,.63,.62),.1,.24,emission=2)
material('09 • warm diffuser',(.95,.59,.24),0,.4,emission=3)
material('10 • slate upholstery',(.063,.135,.14),0,.88)
material('11 • dark graphic',(.045,.071,.067),0,.70)
material('12 • warm white graphic',(.84,.79,.64),0,.70)
material('13 • amber indicator',(.94,.35,.04),0,.4,emission=1)
material('14 • olive leaf',(.135,.25,.055),0,.75)
material('15 • interior timber',(.24,.115,.047),0,.58)
PAINT,INNER,ORANGE,RUBBER,METAL,DARK,GLASS,CYAN,LAMP,FABRIC,INK,WHITE,AMBER,LEAF,WOOD=list(materials)

def start(name):
    global parts, current
    parts=[]; current=name

def register(obj, name, mat):
    obj.name=name
    obj.data.materials.append(materials[mat])
    parts.append(obj)
    return obj

def bevel(obj, width=.02, segments=3):
    if width:
        mod=obj.modifiers.new('Manufactured edge radius','BEVEL');mod.width=width;mod.segments=segments
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for poly in obj.data.polygons: poly.use_smooth=True
        mod=obj.modifiers.new('Panel normals','WEIGHTED_NORMAL');mod.keep_sharp=True;mod.weight=40
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def box(name,p,s,mat=PAINT,r=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p)
    o=bpy.context.object;o.scale=s
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel(o,min(r,min(s)*.43),3)
    return register(o,name,mat)

def mesh(name,verts,faces,mat=PAINT,r=0,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o)
    bm=bmesh.new();bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
    if smooth:
        for f in data.polygons: f.use_smooth=True
    bevel(o,r,3)
    return register(o,name,mat)

def cylinder(name,a,b,r,mat=METAL,sides=24):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=(b-a).length,location=(a+b)/2)
    o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    for f in o.data.polygons: f.use_smooth=len(f.vertices)==4
    return register(o,name,mat)

def outline(w,h,r,cx=0,cz=0,steps=10):
    result=[]
    for x,z,a in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
        for i in range(steps):
            t=math.radians(a+i*90/(steps-1))
            result.append((cx+x+r*math.cos(t),cz+z+r*math.sin(t)))
    return result

def panel(name,w,h,r,center,y,depth,mat=PAINT):
    pts=outline(w,h,r,*center)
    count=len(pts)
    vs=[(x,yy,z) for yy in [y,y+depth] for x,z in pts]
    fs=[tuple(range(count-1,-1,-1)),tuple(range(count,2*count))]
    fs += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return mesh(name,vs,fs,mat,.004)

def frame(name,outer,inner,center,y,depth,mat=PAINT,outercenter=None):
    op=outline(*outer,*(outercenter or center));ip=outline(*inner,*center)
    count=len(op)
    vs=[(x,yy,z) for yy in [y,y+depth] for loop in [op,ip] for x,z in loop]
    fs=[]
    for i in range(count):
        j=(i+1)%count
        fs += [(i,j,j+count,i+count),(i+2*count,i+3*count,j+3*count,j+2*count),
               (i,i+2*count,j+2*count,j),(i+count,j+count,j+3*count,i+3*count)]
    return mesh(name,vs,fs,mat,.006)

def text3d(body,p,size=.06,mat=INK,align='CENTER',rotation=(math.pi/2,0,0)):
    cu=bpy.data.curves.new('marking '+body,'FONT');cu.body=body;cu.align_x=align;cu.size=size
    cu.extrude=.00035;cu.resolution_u=3
    o=bpy.data.objects.new('Marking / '+body,cu);scene.collection.objects.link(o)
    o.location=p;o.rotation_euler=rotation
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH')
    return register(bpy.context.object,'Marking / '+body,mat)

def screw(x,y,z):
    cylinder('Captive screw recess',(x,y,z),(x,y-.009,z),.022,DARK,16)
    cylinder('Captive screw head',(x,y-.01,z),(x,y-.014,z),.014,METAL,12)
    box('Screw slot',(x,y-.016,z),(.019,.002,.003),RUBBER,.0005)

def wall_trim(w=2,entrance=False):
    for x in [-w/2+.035,w/2-.035]:
        box('Module seam gasket',(x,.077,1.4),(.025,.16,2.79),RUBBER,.003)
        box('Removable joint cover',(x,-.017,1.4),(.058,.052,2.62),PAINT,.018)
    if entrance:
        for x in [-.87,.87]:box('Foot rail',(x,-.025,.105),(.17,.15,.18),DARK,.025)
    else:
        box('Foot rail',(0,-.025,.105),(w-.10,.15,.18),DARK,.025)
    box('Upper enamel ribbon',(0,-.033,2.565),(w-.12,.055,.13),ORANGE,.025)
    box('Ribbon inset',(0,-.065,2.57),(.65,.015,.067),DARK,.016)
    box('Status light',(0,-.076,2.57),(.31,.012,.023),CYAN,.008)
    for x in [-w/2+.14,w/2-.14]:
        screw(x,-.035,2.55);screw(x,-.02,.34)
    if entrance:
        for x in [-.87,.87]:box('Lower rain joint',(x,-.023,.45),(.15,.026,.018),DARK,.005)
    else:
        box('Lower rain joint',(0,-.023,.45),(w-.18,.026,.018),DARK,.005)

def finish(name,nominal,sockets):
    coll=bpy.data.collections.new('MODULE / '+name);library.children.link(coll)
    root=bpy.data.objects.new(name,None);coll.objects.link(root)
    root['module_id']=name;root['metres']=True;root['source_sockets_z_up']=json.dumps(sockets)
    root['glb_sockets_y_up']=json.dumps({k:[v[0],v[2],-v[1]] for k,v in sockets.items()})
    for o in parts:
        for c in list(o.users_collection): c.objects.unlink(o)
        coll.objects.link(o);o.parent=root
        if o.type=='MESH':
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.cube_project(cube_size=1.0,correct_aspect=True)
            bpy.ops.object.mode_set(mode='OBJECT')
    assets[name]={'root':root,'parts':list(parts),'collection':coll}
    # Export an optimized copy, preserving the individual modeling pieces in the BLEND.
    temp=[]
    for o in parts:
        c=o.copy();c.data=o.data.copy();scene.collection.objects.link(c);c.parent=None;temp.append(c)
    merged=[]
    groups={mat:[o for o in temp if o.data.materials[0].name==mat] for mat in materials}
    for mat in materials:
        group=groups[mat]
        if not group:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        if len(group)>1:bpy.ops.object.join()
        o=bpy.context.object;o.name=name+' / '+mat
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.parent=root;merged.append(o)
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for o in merged:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,
        export_apply=True,export_animations=False,export_extras=True,export_yup=True)
    triangles=0
    for o in merged:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
    bounds=[o.matrix_world@Vector(c) for o in parts for c in o.bound_box]
    dims=[round(max(p[i] for p in bounds)-min(p[i] for p in bounds),4) for i in range(3)]
    manifest.append({'id':name,'nominal':nominal,'sourceDimensionsXYZ':dims,'triangles':triangles,
        'drawMeshes':len(merged),'editablePieces':len(parts),'sourceSockets':sockets,
        'glb':str((OUT/(name+'.glb')).relative_to(PROJECT)).replace('\\','/')})
    for o in merged:bpy.data.objects.remove(o,do_unlink=True)
    coll.hide_render=True
    for o in parts:o.hide_set(True)

# -- End shared art helpers --
wall_sockets={'left':[-1,0,0],'right':[1,0,0],'roof':[0,0,2.8]}

start('floor-2m')
box('Foundation tray',(0,0,.085),(2,2,.17),DARK,.025)
box('Finished floor',(0,0,.183),(1.982,1.982,.054),INNER,.018)
for x in [-.93,.93]:box('Inlaid perimeter rail',(x,0,.212),(.018,1.86,.004),METAL,.001)
for y in [-.93,.93]:box('Inlaid perimeter rail',(0,y,.212),(1.86,.018,.004),METAL,.001)
for x in [-.84,.84]:
    for y in [-.84,.84]:cylinder('Floor fastener',(x,y,.207),(x,y,.215),.021,METAL,12)
finish(current,[2,2,.21],{'top':[0,0,.21],'left':[-1,0,0],'right':[1,0,0]})

start('foundation-edge-2m')
box('Edge foundation',(0,.25,.085),(2,.5,.17),DARK,.015)
box('Edge top',(0,.25,.184),(1.982,.50,.052),PAINT,.012)
box('Drainage reveal',(0,-.01,.105),(1.9,.022,.05),RUBBER,.005)
for x in [-.7,.7]:box('Foot bracket',(x,-.025,.082),(.18,.075,.15),METAL,.018)
finish(current,[2,.5,.21],{'wall':[0,0,.21],'floor':[0,.5,0]})

def arc_section(name,r0,r1,z0,z1,mat,steps=32):
    if r0<=.001:
        # Solid quarter sectors have a true center, not a tiny beveled inner hole.
        arc=[(r1*math.cos(-math.pi/2+i*math.pi/2/steps),r1*math.sin(-math.pi/2+i*math.pi/2/steps)) for i in range(steps+1)]
        vs=[(0,0,z0),(0,0,z1)]+[(x,y,z) for z in [z0,z1] for x,y in arc]
        k=steps+1;fs=[]
        for i in range(steps):
            a=2+i;b=a+k
            fs += [(0,a+1,a),(1,b,b+1),(a,a+1,b+1,b)]
        fs += [(0,1,2+k,2),(0,2+k-1,2+2*k-1,1)]
        return mesh(name,vs,fs,mat,.003)
    vs=[]
    for z in [z0,z1]:
        for r in [r0,r1]:
            vs += [(r*math.cos(-math.pi/2+i*math.pi/2/steps),r*math.sin(-math.pi/2+i*math.pi/2/steps),z) for i in range(steps+1)]
    k=steps+1;fs=[]
    for i in range(steps):
        fs += [(i,i+1,i+1+2*k,i+2*k),(i+k,i+3*k,i+1+3*k,i+1+k),
               (i,i+k,i+1+k,i+1),(i+2*k,i+1+2*k,i+1+3*k,i+3*k)]
    fs += [(0,2*k,3*k,k),(k-1,2*k-1,4*k-1,3*k-1)]
    return mesh(name,vs,fs,mat,.003)

start('foundation-corner-r050')
arc_section('Foundation quarter',.001,.5,0,.17,DARK)
arc_section('Floor corner cap',.001,.5,.17,.21,PAINT)
finish(current,[.5,.5,.21],{'front':[0,-.5,.21],'side':[.5,0,.21]})

for name,w in [('wall-solid-2m',2),('wall-window-2m',2),('wall-panorama-4m',4),('wall-doorway-2m',2)]:
    start(name)
    if 'solid' in name:
        panel('Sandwich wall',w-.014,2.8,.06,(0,1.4),0,.22,INNER)
        panel('Outer shell',w-.12,2.34,.16,(0,1.4),-.022,.035,PAINT)
        frame('Service panel seal',(.94,.68,.10),(.90,.64,.08),(0,1.23),-.052,.018,RUBBER)
        panel('Service panel',.898,.638,.08,(0,1.23),-.065,.027,PAINT)
        for x in [-.37,.37]:screw(x,-.071,1.45);screw(x,-.071,1.02)
        text3d('LIFE SUPPORT',(0,-.10,1.24),.047)
        text3d('SERVICE  /  04',(0,-.10,1.14),.032)
        box('Vent pocket',(0,-.035,.67),(1.30,.035,.20),RUBBER,.028)
        for i in range(11):box('Vent blade',(-.55+i*.11,-.06,.67),(.056,.037,.135),METAL,.009)
    else:
        door='doorway' in name
        iw,ih,ir,cz=(1.29,2.35,.24,1.245) if door else (w-.40,1.63,.24,1.59)
        frame('Insulated wall skin',(w-.014,2.8,.06),(iw,ih,ir),(0,cz),0,.22,INNER,(0,1.4))
        frame('Outer shell',(w-.07,2.73,.07),(iw+.06,ih+.06,ir+.03),(0,cz),-.018,.04,PAINT,(0,1.4))
        frame('Recess gasket',(iw+.12,ih+.12,ir+.06),(iw-.01,ih-.01,ir),(0,cz),-.047,.06,RUBBER)
        frame('Anodized recess',(iw+.055,ih+.055,ir+.03),(iw-.075,ih-.075,ir-.035),(0,cz),-.071,.12,DARK)
        frame('Rolled window or door lip',(iw+.22,ih+.22,ir+.10),(iw+.055,ih+.055,ir+.03),(0,cz),-.085,.067,ORANGE if door else PAINT)
        frame('Interior reveal',(iw+.09,ih+.09,ir+.04),(iw-.09,ih-.09,ir-.04),(0,cz),.18,.065,PAINT)
        if not door:
            panel('Sealed glass pane',iw-.05,ih-.05,ir-.025,(0,cz),.065,.012,GLASS)
            box('Deep interior sill',(0,.18,cz-ih/2-.03),(iw+.11,.40,.075),PAINT,.025)
            box('Sill dark underside',(0,-.08,cz-ih/2-.10),(iw-.04,.13,.045),DARK,.015)
            text3d('HABITAT  /  01',(0,-.055,.55),.053)
            for x in [-iw/2+.11,iw/2-.11]:
                box('Window latch',(x,-.105,cz-ih/2+.07),(.10,.045,.038),METAL,.009)
        else:
            box('Door threshold',(0,.06,.07),(1.35,.45,.085),METAL,.018)
            box('Keypad mount',(.85,-.072,1.22),(.14,.15,.40),DARK,.04)
            panel('Keypad glass',.10,.25,.024,(.85,1.25),-.153,.012,CYAN)
            for z in [1.17,1.23,1.29]:box('Keypad graphic',(.85,-.169,z),(.055,.006,.012),WHITE,.002)
    wall_trim(w,entrance='doorway' in name)
    if 'doorway' in name:
        # Entrance header remains readable above the standardized ribbon.
        text3d('HAB 01',(0,-.029,2.70),.065)
    finish(name,[w,.22,2.8],{'left':[-w/2,0,0],'right':[w/2,0,0],'roof':[0,0,2.8]})

start('door-leaf-110')
frame('Door perimeter seal',(1.235,2.27,.215),(.17,.77,.084),(-.23,1.64),.10,.09,RUBBER,(0,1.205))
frame('Door outer leaf',(1.20,2.23,.195),(.17,.77,.084),(-.23,1.64),.075,.12,PAINT,(0,1.205))
frame('Inset door panel',(.92,1.99,.17),(.17,.77,.084),(-.23,1.64),.055,.032,INNER,(0,1.205))
frame('Vision gasket',(.23,.83,.115),(.17,.77,.085),(-.23,1.64),.028,.05,DARK)
panel('Vision glass',.17,.77,.084,(-.23,1.64),.055,.012,GLASS)
box('Orange safety spine',(.30,.025,1.20),(.065,.03,1.56),ORANGE,.018)
for z in [.90,1.25]:box('Handle standoff',(.32,-.025,z),(.065,.13,.065),DARK,.018)
cylinder('Door pull',(.32,-.09,.90),(.32,-.09,1.25),.026,METAL)
for z in [.62,.70,.78]:box('Lower door emboss',(-.1,.031,z),(.45,.024,.02),DARK,.006)
text3d('01',(-.02,.013,1.55),.19)
text3d('HOME',(-.02,.012,1.43),.048)
finish(current,[1.235,.3,2.34],{'doorway':[0,0,0]})

start('wall-corner-r050')
arc_section('Curved insulated shell',.28,.50,0,2.8,PAINT)
arc_section('Lower corner rail',.28,.53,.015,.20,DARK)
arc_section('Enamel continuation',.498,.535,2.50,2.63,ORANGE)
arc_section('Lower panel joint',.499,.512,.44,.46,DARK)
for a in [-65,-25]:
    t=math.radians(a)
    c=cylinder('Corner lock',(.50*math.cos(t),.50*math.sin(t),2.57),(.54*math.cos(t),.54*math.sin(t),2.57),.026,METAL,16)
finish(current,[.5,.5,2.8],{'front':[0,-.5,0],'side':[.5,0,0],'roof':[0,0,2.8]})

start('roof-center-2m')
box('Roof insulated tray',(0,0,.365),(2,2,.17),INNER,.018)
box('Roof panel',(0,0,.475),(1.982,1.982,.05),PAINT,.023)
for y in [-.91,.91]:box('Roof recessed joint',(0,y,.502),(1.78,.012,.004),DARK,.001)
finish(current,[2,2,.5],{'left':[-1,0,.5],'right':[1,0,.5]})

def roof_roll(name,width,mat=PAINT):
    steps=24;vs=[]
    profile=[(.5-.5*math.cos(i*math.pi/2/steps),.5*math.sin(i*math.pi/2/steps)) for i in range(steps+1)]
    profile += [(.5,.28),(.15,0)]
    for x in [-width/2,width/2]:vs += [(x,y,z) for y,z in profile]
    k=len(profile);fs=[tuple(range(k-1,-1,-1)),tuple(range(k,2*k))]
    fs += [(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
    return mesh(name,vs,fs,mat,.006)

start('roof-edge-2m')
roof_roll('Curved roof shoulder',1.985)
box('Eave shadow channel',(0,-.012,.021),(2,.032,.041),RUBBER,.006)
box('Eave enamel rail',(0,-.035,.07),(1.96,.044,.066),ORANGE,.017)
for x in [-.84,.84]:screw(x,-.060,.07)
finish(current,[2,.5,.5],{'wall':[0,0,0],'roof':[0,.5,.5]})

start('roof-corner-r050')
vs=[];fs=[];rows=24;cols=32
for i in range(rows+1):
    phi=i*math.pi/2/rows;r=.5*math.cos(phi)
    for j in range(cols+1):
        a=-math.pi/2+j*math.pi/2/cols
        vs.append((r*math.cos(a),r*math.sin(a),.5*math.sin(phi)))
for i in range(rows):
    for j in range(cols):
        a=i*(cols+1)+j;fs.append((a,a+1,a+cols+2,a+cols+1))
o=mesh('Compound roof corner',vs,fs,PAINT,smooth=True)
mod=o.modifiers.new('Shell thickness','SOLIDIFY');mod.thickness=.045
bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
arc_section('Corner eave shadow',.49,.518,0,.04,RUBBER)
arc_section('Corner eave enamel',.493,.542,.04,.10,ORANGE)
finish(current,[.5,.5,.5],{'front':[0,-.5,0],'side':[.5,0,0],'roof':[0,0,.5]})

start('entry-step-2m')
box('Entry landing',(0,-.22,.12),(1.65,.60,.24),PAINT,.055)
box('Lower step',(0,-.70,.06),(1.83,.45,.12),PAINT,.04)
for y,z,w in [(-.23,.244,1.39),(-.70,.124,1.56)]:
    box('Tread inset',(0,y,z),(w,.28,.012),DARK,.015)
    for i in range(5):box('Tread ridge',(0,y-.10+i*.05,z+.008),(w-.08,.009,.008),METAL,.002)
    for x in [-w/2+.035,w/2-.035]:box('Step edge marker',(x,y,z+.009),(.035,.19,.009),ORANGE,.005)
finish(current,[1.83,.925,.25],{'doorway':[0,0,.21]})

start('roof-vent')
box('Vent seal',(0,0,.035),(1.38,1.02,.07),RUBBER,.035)
box('Vent housing',(0,0,.20),(1.30,.94,.33),PAINT,.10)
box('Vent top',(0,0,.37),(1.12,.79,.08),ORANGE,.035)
box('Recessed fan grille',(0,0,.414),(.95,.63,.025),DARK,.03)
for x in [-.40+i*.1 for i in range(9)]:box('Cooling fin',(x,0,.44),(.047,.59,.035),METAL,.012)
for x in [-.51,.51]:
    for y in [-.32,.32]:cylinder('Vent fastener',(x,y,.407),(x,y,.425),.025,METAL,12)
text3d('AIR / 02',(0,-.476,.20),.045)
finish(current,[1.38,1.02,.46],{'roof':[0,0,0]})

start('wall-utility')
box('Utility stand-off',(0,.07,.47),(1.40,.13,.78),DARK,.04)
box('Utility cover',(0,-.03,.47),(1.30,.17,.71),PAINT,.065)
box('Utility upper cap',(0,-.12,.78),(1.24,.08,.10),ORANGE,.03)
box('Dark service inlet',(-.33,-.132,.49),(.43,.05,.41),DARK,.045)
for i in range(5):box('Heat exchanger fin',(-.33,-.17,.35+i*.065),(.36,.06,.025),METAL,.008)
panel('Service screen',.37,.24,.045,(.30,.52),-.13,.018,DARK)
for i in range(3):box('Readout',(.29,-.151,.45+i*.065),(.24-i*.04,.008,.012),CYAN,.004)
for x in [-.5,.5]:
    cylinder('Lower connector',(x,.01,.15),(x,.01,.05),.065,METAL)
    cylinder('Orange coupling',(x,.01,.10),(x,.01,.15),.075,ORANGE)
text3d('WATER / POWER',(0,-.127,.25),.039)
finish(current,[1.4,.3,.86],{'wall':[0,.14,0]})

start('interior-bench-2m')
box('Seat plinth',(0,0,.28),(1.8,.70,.56),PAINT,.09)
box('Seat cushion',(0,-.02,.59),(1.68,.64,.17),FABRIC,.07)
box('Back cushion',(0,.25,.88),(1.68,.17,.57),FABRIC,.07)
for x in [-.82,.82]:box('Bench arm',(x,-.04,.70),(.13,.65,.17),PAINT,.06)
box('Front inset',(0,-.359,.29),(1.48,.025,.25),INNER,.025)
for x in [-.35,.35]:box('Storage pull',(x,-.381,.35),(.26,.028,.036),METAL,.01)
finish(current,[1.8,.72,1.165],{'floor':[0,0,0]})

start('interior-console')
box('Storage pedestal',(0,.05,.42),(1.15,.55,.84),PAINT,.045)
box('Desk lip',(0,-.10,.86),(1.5,.85,.10),WOOD,.045)
for x in [-.29,.29]:
    panel('Inset storage door',.52,.61,.035,(x,.42),-.237,.025,INNER)
    box('Drawer grip',(x,-.28,.65),(.20,.04,.025),METAL,.01)
box('Monitor foot',(.10,.08,.94),(.45,.25,.06),DARK,.025)
cylinder('Monitor neck',(.1,.1,.94),(.1,.1,1.14),.045,METAL)
panel('Monitor casing',.84,.50,.065,(.1,1.34),-.04,.10,DARK)
panel('Monitor display',.75,.41,.035,(.1,1.34),-.051,.01,FABRIC)
for i in range(4):box('Display telemetry',(-.03,-.065,1.23+i*.065),(.38-i*.055,.006,.013),CYAN,.002)
text3d('HOME / ONLINE',(.1,-.065,1.45),.035,WHITE)
finish(current,[1.5,.85,1.59],{'floor':[0,0,0]})

start('ceiling-light-2m')
box('Ceiling rail',(0,0,.035),(1.8,.15,.07),DARK,.02)
box('Diffuser',(0,0,-.008),(1.64,.11,.035),LAMP,.012)
finish(current,[1.8,.15,.08],{'ceiling':[0,0,.07]})

start('interior-planter')
bpy.ops.mesh.primitive_cone_add(vertices=48,radius1=.12,radius2=.17,depth=.26,location=(0,0,.13))
o=bpy.context.object;bevel(o,.012);register(o,'Glazed planter',PAINT)
cylinder('Planter rim',(0,0,.245),(0,0,.275),.174,ORANGE,48)
cylinder('Growing medium',(0,0,.271),(0,0,.279),.155,WOOD,32)
for i in range(13):
    a=i*2.399;length=random.uniform(.28,.51);spread=random.uniform(.18,.32)
    origin=Vector((random.uniform(-.055,.055),random.uniform(-.055,.055),.277))
    end=origin+Vector((math.cos(a)*spread,math.sin(a)*spread,length*.72))
    cylinder('Leaf petiole',origin,origin+Vector((0,0,length*.40)),.008,LEAF,8)
    vs=[];fs=[]
    side=Vector((-math.sin(a),math.cos(a),0))
    for j in range(9):
        t=j/8;c=origin+(end-origin)*t;c.z+=math.sin(t*math.pi)*length*.30
        width=math.sin(t*math.pi)**.8*.047
        vs += [tuple(c-side*width),tuple(c+Vector((0,0,width*.22))),tuple(c+side*width)]
    for j in range(8):
        for k in range(2):v=j*3+k;fs.append((v,v+1,v+4,v+3))
    o=mesh('Curved lanceolate leaf',vs,fs,LEAF,smooth=True)
    mod=o.modifiers.new('Leaf thickness','SOLIDIFY');mod.thickness=.001
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
finish(current,[.8,.8,.85],{'support':[0,0,0]})

start('support-column-2p8')
box('Load-bearing core',(0,0,1.4),(.16,.16,2.8),DARK,.025)
for z in [.065,2.735]:
    box('Column shoe',(0,0,z),(.32,.32,.13),METAL,.028)
    box('Enamel collar',(0,0,.15 if z<1 else 2.65),(.24,.24,.07),ORANGE,.018)
box('Column jacket',(0,0,1.4),(.20,.20,2.40),PAINT,.04)
finish(current,[.32,.32,2.8],{'floor':[0,0,0],'ceiling':[0,0,2.8]})

start('ceiling-beam-2m')
box('Beam web',(0,0,-.10),(2,.12,.20),DARK,.016)
box('Beam lower flange',(0,0,-.19),(2,.24,.06),PAINT,.015)
for x in [-.92,.92]:box('Beam splice',(x,0,-.10),(.14,.18,.20),METAL,.02)
box('Recessed ceiling light',(0,0,-.225),(1.55,.075,.025),LAMP,.008)
finish(current,[2,.24,.24],{'left':[-1,0,0],'right':[1,0,0],'ceiling':[0,0,0]})

start('ceiling-beam-end-050')
box('Eave extension web',(0,0,-.10),(.50,.12,.20),DARK,.016)
box('Eave extension flange',(0,0,-.19),(.50,.24,.06),PAINT,.015)
box('Wall connection shoe',(.20,0,-.08),(.10,.32,.28),METAL,.02)
finish(current,[.50,.32,.28],{'inner':[-.25,0,0],'wall':[.25,0,0]})

# The composition is an assembly of linked module meshes, never a fused cabin.
assembly=bpy.data.collections.new('ASSEMBLY / 7 x 5 metre home');scene.collection.children.link(assembly)
def place(name,p=(0,0,0),angle=0,coll=assembly,record=True):
    a=assets[name]
    root=bpy.data.objects.new(name+' instance',None);coll.objects.link(root)
    root.location=p;root.rotation_euler.z=math.radians(angle)
    root['asset']=name
    for original in a['parts']:
        o=original.copy();o.data=original.data;coll.objects.link(o);o.parent=root;o.hide_render=False;o.hide_set(False)
    if record:layout.append({'asset':name,'positionZUp':p,'yawZ':angle})
    return root

for x in [-2,0,2]:
    for y in [-1,1]:
        place('floor-2m',(x,y,0));place('roof-center-2m',(x,y,3.01))
    for y,a in [(-2.5,0),(2.5,180)]:
        place('foundation-edge-2m',(x,y,0),a);place('roof-edge-2m',(x,y,3.01),a)
    place('wall-solid-2m',(x,2.5,.21),180)
place('wall-panorama-4m',(-1,-2.5,.21))
place('wall-doorway-2m',(2,-2.5,.21))
place('door-leaf-110',(2,-2.5,.21))
place('entry-step-2m',(2,-2.53,0))
for x,a in [(3.5,90),(-3.5,270)]:
    for y in [-1,1]:
        place('foundation-edge-2m',(x,y,0),a)
        place('wall-window-2m' if x>0 else 'wall-solid-2m',(x,y,.21),a)
        place('roof-edge-2m',(x,y,3.01),a)
for x,y,a in [(3,-2,0),(3,2,90),(-3,2,180),(-3,-2,270)]:
    place('foundation-corner-r050',(x,y,0),a)
    place('wall-corner-r050',(x,y,.21),a)
    place('roof-corner-r050',(x,y,3.01),a)
place('roof-vent',(-1.5,.6,3.51));place('roof-vent',(1.1,.6,3.51))
place('wall-utility',(3.5,1.0,.13),90)
place('interior-bench-2m',(-1,1.82,.21))
place('interior-console',(-1.8,.05,.21))
place('interior-console',(2,1.8,.21))
place('interior-planter',(-1.27,-.15,1.12))
for x in [-2,0,2]:place('ceiling-light-2m',(x,-.5,2.96))

(HERE/'asset-catalog.json').write_text(json.dumps({'stage':'art-review-v2','units':'metres','sourceUp':'Z','glbUp':'Y',
    'glass':'KHR_materials_transmission; requires renderer support','assets':manifest},indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(HERE/'assembly.json').write_text(json.dumps(layout,indent=2)+'\n',encoding='utf-8')

stage=bpy.data.collections.new('STUDIO / review only');scene.collection.children.link(stage)
groundmat=material('Studio sand',(.26,.285,.265),0,.84)
start('studio')
g=box('Studio ground',(0,0,-.11),(200,200,.2),'Studio sand',.01)
for c in list(g.users_collection):c.objects.unlink(g)
stage.objects.link(g)

def light(name,p,power,size,color,target):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);stage.objects.link(o);o.location=p
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    return o

light('Warm key',(-5,-6,10),1700,7,(1,.83,.60),(0,0,1))
light('Cool fill',(6,-1,6),1100,6,(.61,.79,1),(0,0,1))
light('Roof rim',(-2,6,9),2100,5,(1,.9,.72),(0,0,1))
for x in [-2,0,2]:light('Interior practical',(x,0,2.85),90,1.5,(1,.65,.30),(x,0,.2))
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.43,.57,.68,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.28
camdata=bpy.data.cameras.new('Art review lens');camera=bpy.data.objects.new('Art review camera',camdata);stage.objects.link(camera);scene.camera=camera
def camera_at(p,target,lens=48):
    camera.location=p;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
camera_at((10,-13,7.3),(0,-.10,1.50),48)
scene.render.engine='CYCLES';scene.cycles.samples=80;scene.cycles.use_denoising=True
scene.cycles.transparent_max_bounces=12;scene.cycles.transmission_bounces=8
try:
    pref=bpy.context.preferences.addons['cycles'].preferences;pref.compute_device_type='OPTIX';pref.get_devices()
    for d in pref.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=.25
scene.render.resolution_x=1920;scene.render.resolution_y=1280;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'

# Keep a useful source-file opening view without launching an editor for QA.
bpy.ops.object.select_all(action='DESELECT')
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=15
            ar.spaces.active.region_3d.view_location=(0,0,1.5)
            ar.spaces.active.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
scene['review_status']='Art pass; pending user visual approval. No in-engine acceptance claimed.'
scene['reference']='art/concepts/selected-warm-sci-fi.png'
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'habitat-v2.blend'))
if os.environ.get('HABITAT_SKIP_RENDER')!='1':
    scene.render.filepath=str(REVIEW/'01-assembled.png');bpy.ops.render.render(write_still=True)
    camera_at((2.0,-8.8,3.5),(-.85,-2.15,1.72),54)
    scene.render.filepath=str(REVIEW/'02-window-detail.png');bpy.ops.render.render(write_still=True)

# Nine representative components on a separate studio sheet, with readable labels.
assembly.hide_render=True
board=bpy.data.collections.new('REVIEW / separate modules');scene.collection.children.link(board)
items=[('wall-panorama-4m','01  /  PANORAMA 4 M'),('wall-doorway-2m','02  /  ENTRANCE 2 M'),('wall-solid-2m','03  /  SOLID WALL 2 M'),
       ('wall-window-2m','04  /  WINDOW 2 M'),('wall-corner-r050','05  /  CORNER R 0.5 M'),('roof-edge-2m','06  /  ROLLED EAVE 2 M'),
       ('floor-2m','07  /  FLOOR 2 M'),('roof-corner-r050','08  /  ROOF CORNER'),('roof-vent','09  /  ROOF VENT')]
for i,(name,label) in enumerate(items):
    col=i%3;row=i//3;x=(col-1)*5.3;z=(1-row)*4.7
    root=place(name,(x,0,z),-12,board,False)
    root.rotation_euler.x=math.radians(20)
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(c) for o in root.children for c in o.bound_box]
    root.location.z+=z-(min(p.z for p in points)+max(p.z for p in points))/2
    start('board')
    o=text3d(label,(x,-1.2,z-1.85),.19,INK)
    for c in list(o.users_collection):c.objects.unlink(o)
    board.objects.link(o)
start('board')
backdrop=box('Sheet backdrop',(0,3,0),(40,.1,40),'Studio sand',0)
for c in list(backdrop.users_collection):c.objects.unlink(backdrop)
board.objects.link(backdrop)
g.hide_render=True
boardlight=light('Sheet fill',(0,-9,1),1900,12,(1,.95,.85),(0,0,0))
camera_at((0,-30,0),(0,0,0),46)
camera.data.type='ORTHO';camera.data.ortho_scale=18.5
scene.render.resolution_x=2100;scene.render.resolution_y=1700
if os.environ.get('HABITAT_SKIP_RENDER')!='1':
    scene.render.filepath=str(REVIEW/'03-module-sheet.png');bpy.ops.render.render(write_still=True)
board.hide_render=True;board.hide_viewport=True;assembly.hide_render=False
g.hide_render=False;boardlight.hide_render=True;boardlight.hide_viewport=True
camera.data.type='PERSP'
camera_at((10,-13,7.3),(0,-.10,1.50),48)
scene.render.resolution_x=1920;scene.render.resolution_y=1280
scene.render.filepath=str(REVIEW/'01-assembled.png')
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'habitat-v2.blend'))
print(json.dumps({'assets':len(manifest),'instances':len(layout),'triangles':sum(a['triangles'] for a in manifest),'source':str(HERE/'habitat-v2.blend')}))
