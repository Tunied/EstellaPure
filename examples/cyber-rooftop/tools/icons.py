"""Render original inventory objects with Blender's headless Cycles renderer.

The first icon uses the same construction-tool mesh as the playable scene.
All other icons are editable geometry, lit consistently on transparent film.
"""
from pathlib import Path
import bpy, math
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parents[1]/'output/cyber-rooftop/cyber-rooftop.blend'))
tool=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Tool_')]
for o in list(bpy.data.objects):
    if o not in tool: bpy.data.objects.remove(o,do_unlink=True)
for o in tool: o.parent=None;o.hide_render=True

def material(name,color,metal=.4,rough=.3,emission=0):
    m=bpy.data.materials.new('Icon '+name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m

silver=material('silver',(.38,.45,.48),.8,.27)
dark=material('black',(.035,.05,.065),.45,.3)
paint=material('paint',(.6,.61,.56),.45,.35)
gold=material('gold',(.78,.38,.065),.6,.32)
red=material('red',(.55,.035,.045),.3,.32)
white=material('white',(.85,.89,.85),.2,.4)
cyan=material('cyan',(.01,.55,.8),.2,.2,2)
screen=material('screen',(.005,.025,.035),.5,.18)
food=material('food',(.66,.47,.15),.15,.45)
objects=[]

def box(p,s,m,bevel=.06):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p)
    o=bpy.context.object;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(m);objects.append(o)
    if bevel:
        b=o.modifiers.new('Machined edge','BEVEL');b.width=bevel;b.segments=3
        o.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return o

def cylinder(p,r,depth,m,axis='Z',vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=p)
    o=bpy.context.object
    if axis=='Y': o.rotation_euler.x=math.pi/2
    if axis=='X': o.rotation_euler.y=math.pi/2
    o.data.materials.append(m);objects.append(o)
    b=o.modifiers.new('Rim bevel','BEVEL');b.width=.015;b.segments=2
    o.modifiers.new('Normals','WEIGHTED_NORMAL');return o

def bolts(xs,zs,y):
    for x in xs:
        for z in zs: cylinder((x,y,z),.035,.025,silver,'Y',8)

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40
scene.cycles.use_denoising=True;scene.render.film_transparent=True
scene.render.resolution_x=256;scene.render.resolution_y=224;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.world.color=(.18,.18,.18);scene.view_settings.view_transform='AgX'
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
for p,power,size,col in [((-3,-4,6),700,5,(1,.88,.72)),((4,1,4),900,4,(.55,.8,1)),((0,-6,1),250,3,(1,1,1))]:
    bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=col
    o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()

for i in range(1,9):
    for o in objects: bpy.data.objects.remove(o,do_unlink=True)
    objects=[]
    for o in tool:o.hide_render=i!=1
    if i==1:
        visible=tool
    elif i==2:
        cylinder((0,0,.55),.7,.13,dark,'Y');cylinder((0,-.09,.55),.59,.03,silver,'Y')
        for j in range(24):
            a=j*math.tau/24
            b=box((math.cos(a)*.61,-.12,.55+math.sin(a)*.61),(.11,.025,.065),silver,.01);b.rotation_euler.y=-a
        cylinder((0,-.15,.55),.19,.08,dark,'Y');cylinder((0,-.2,.55),.09,.03,red,'Y')
        box((-.20,0,-.27),(.39,.33,.95),red)
        box((-.2,-.19,-.48),(.25,.04,.42),dark,.025)
        bolts([-.30,-.10],[-.68,-.25],-.22)
        visible=objects
    elif i==3:
        box((0,0,0),(1,.42,1.9),paint,.14);box((0,-.23,.21),(.77,.06,1.1),dark,.07)
        box((0,-.27,.25),(.61,.015,.88),cyan,.03);box((0,-.28,.26),(.48,.015,.72),screen,.02)
        for j in range(5):box((-.14+j*.06,-.30,.16),(.025,.015,.16+j*.06),cyan,.005)
        cylinder((0,-.25,-.59),.14,.025,dark,'Y');cylinder((0,-.27,-.59),.08,.025,gold,'Y')
        bolts([-.35,.35],[.79,-.79],-.23);visible=objects
    elif i==4:
        box((0,0,0),(3.2,2.1,.18),silver)
        for x in [-.76,.76]:
            for y in [-.49,.49]:box((x,y,.12),(1.42,.88,.10),paint,.03)
        for x in [-1.5,1.5]:
            for y in [-.94,.94]:
                box((x,y,-.19),(.14,.14,.55),silver,.02);box((x,y,-.46),(.30,.27,.05),dark,.01)
                cylinder((x,y,.18),.045,.03,dark)
        visible=objects
    elif i==5:
        box((0,0,0),(1.9,.28,2.2),dark)
        for x in [-.60,0,.60]:box((x,-.17,0),(.53,.12,1.94),paint,.035)
        for x in [-.89,.89]:
            box((x,-.18,0),(.11,.12,2.2),silver,.02)
            for z in [-.9,.9]:box((x,-.26,z),(.15,.06,.18),gold,.02)
        bolts([-.65,.65],[-.91,.91],-.25);visible=objects
    elif i==6:
        box((0,0,0),(1.5,1.2,1.9),dark)
        for x in [-.64,.64]:
            box((x,-.62,0),(.16,.12,1.94),silver,.03)
            for z in [-.63,-.24,.15,.54]:box((x,-.70,z),(.08,.03,.23),gold,.015)
        box((0,0,1.0),(1.17,.90,.14),silver)
        for y in [-.30,.30]:box((0,y,1.10),(.72,.12,.08),dark,.02)
        for z in [-.5,-.3,-.1]:box((0,-.63,z),(.5,.03,.05),silver,.005)
        box((.1,-.64,.47),(.28,.025,.12),cyan,.01);visible=objects
    elif i==7:
        box((0,0,0),(2,.75,1.6),red,.15)
        for x in [-.82,.82]:box((x,-.39,0),(.08,.06,1.40),silver,.02)
        box((0,-.40,0),(.83,.04,.89),red,.08)
        box((0,-.44,0),(.20,.03,.66),white,.01);box((0,-.44,0),(.63,.03,.20),white,.01)
        for x in [-.4,.4]:box((x,0,.91),(.12,.27,.29),dark,.03)
        box((0,0,1.05),(.87,.25,.13),dark,.03)
        bolts([-.79,.79],[-.61,.61],-.43);visible=objects
    else:
        box((0,0,0),(1.2,.32,1.9),food,.12)
        for z in [-.88,.88]:
            box((0,-.01,z),(1.27,.35,.12),gold,.02)
            for x in range(-5,6):box((x*.1,-.196,z),(.025,.015,.1),food,.003)
        box((0,-.178,.15),(.99,.03,1.1),white,.02)
        for x in [-.27,0,.27]:box((x,-.20,.46),(.18,.015,.22),red,.01)
        cylinder((0,-.22,-.13),.28,.02,food,'Y')
        for j in range(5):box((-.34+j*.17,-.204,-.59),(.045,.01,.11),dark,.002)
        visible=objects
    coords=[o.matrix_world@Vector(v) for o in visible for v in o.bound_box]
    lo=Vector(tuple(min(p[j] for p in coords) for j in range(3)));hi=Vector(tuple(max(p[j] for p in coords) for j in range(3)))
    center=(lo+hi)/2;size=max(hi-lo)
    camera.location=center+Vector((4,-7,4.3)).normalized()*size*5
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=size*1.42
    scene.render.filepath=str(ROOT/f'assets/textures/inventory-{i}.png')
    bpy.ops.render.render(write_still=True)
print('Eight transparent inventory renders written.')
