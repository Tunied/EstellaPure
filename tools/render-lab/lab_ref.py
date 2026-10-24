"""The Blender (Cycles) picture of a lab scene, from the same GLB, camera, sun and sky the engine is given.
blender --background --python lab_ref.py -- <lab> <scene.glb> <out.png>   (env SAMPLES, DENOISE=0 to turn the denoiser off)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lab_specs as S  # noqa: E402

lab, glb, out = sys.argv[sys.argv.index('--') + 1:][:3]
spec = S.LABS[lab]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get('SAMPLES', '128'))
scene.cycles.use_denoising = os.environ.get('DENOISE', '1') == '1'
scene.cycles.device = 'CPU'
scene.cycles.max_bounces = 12
scene.render.resolution_x, scene.render.resolution_y = S.SIZE
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

world = bpy.data.worlds.new('W')
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (1, 1, 1, 1)
bg.inputs['Strength'].default_value = spec['ambient']
scene.world = world
# The sky shows behind the picture in the engine too (drawEnvironment), so the background is the sky.

pos, target, fov = spec['cam']
to_b = lambda v: Vector(S.to_blender(v))
cam_data = bpy.data.cameras.new('C')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(fov)
cam_data.clip_start, cam_data.clip_end = 0.05, 100
cam = bpy.data.objects.new('C', cam_data)
scene.collection.objects.link(cam)
cam.location = to_b(pos)
cam.rotation_euler = (to_b(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

if spec['sun']:
    sun = bpy.data.lights.new('S', 'SUN')
    sun.energy = spec['sun']['intensity'] * S.SUN_STRENGTH_PER_INTENSITY
    sun.angle = math.radians(spec['sun']['angle'])
    ob = bpy.data.objects.new('S', sun)
    scene.collection.objects.link(ob)
    ob.rotation_euler = to_b(spec['sun']['dir']).to_track_quat('-Z', 'Y').to_euler()

scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
