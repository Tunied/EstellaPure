"""Builds the geometry of one lab scene in Blender and exports it as a GLB both renderers then draw.
blender --background --python build_lab.py -- <lab> <out.glb>
"""
import json
import os
import struct
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lab_specs as S  # noqa: E402
from lab_png import write_png  # noqa: E402

lab, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
g2b = S.to_blender
CUTOUTS = {}


def principled(name, base, metallic=0.0, roughness=0.5, image=None, alpha_clip=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if image is not None:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_clip is not None:
            m.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            CUTOUTS[name] = alpha_clip
    return m


def sphere(name, centre, radius, mat, segments=96, rings=64):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=g2b(centre))
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def box(name, centre, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=g2b(centre))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


def flat_face(name, pts_gltf, uvs, mat):
    """One quad from four glTF-space corners (listed counter-clockwise seen from the side it should face)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(g2b(p)) for p in pts_gltf]
    face = bm.faces.new(verts)
    layer = bm.loops.layers.uv.new('UVMap')
    for loop, (u, v) in zip(face.loops, uvs):
        loop[layer].uv = (u, v)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def card(name, centre, width, height, mat):
    """A flat card facing -Z (the camera), `width` along glTF X and `height` along Y, uvs 0..1 with (0, 0) at the bottom left of the picture."""
    cx, cy, cz = centre
    hw, hh = width / 2, height / 2
    # Seen from -Z, +X is to the left: counter-clockwise from the picture's bottom left is bottom-left, bottom-right, top-right, top-left.
    pts = [(cx + hw, cy - hh, cz), (cx - hw, cy - hh, cz), (cx - hw, cy + hh, cz), (cx + hw, cy + hh, cz)]
    return flat_face(name, pts, ((0, 0), (1, 0), (1, 1), (0, 1)), mat)


def load_png(rgba, name):
    path = os.path.join(os.path.dirname(os.path.abspath(out)), name + '.png')
    write_png(path, rgba)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'sRGB'
    img.pack()
    return img


def stripes_image(name, size, period, duty, dark, bright, alpha_cut):
    """Vertical strands, `period` texels apart: bright in the middle of each, dark at its edge; with `alpha_cut` the gaps are clear."""
    x = np.arange(size)
    phase = (x % period) / period
    prof = 0.5 + 0.5 * np.cos(2 * np.pi * (phase - 0.5))                 # 1 at the strand's centre, 0 at its edge
    col = dark + (bright - dark) * prof
    alpha = np.where(np.abs(phase - 0.5) < duty / 2, 1.0, 0.0) if alpha_cut else np.ones(size)
    row = np.stack([col, col, col, alpha], axis=1)
    return load_png(np.tile(row[None, :, :], (size, 1, 1)), name)


def hair_image(name, size, alpha_cut, seed=7):
    """Strands as hair has them: each 1 to 3 texels wide at a random place, brighter down the middle, with 40% of the width between them clear."""
    rng = np.random.default_rng(seed)
    col = np.zeros(size)
    alpha = np.zeros(size)
    x = 0.0
    while x < size:
        w = rng.uniform(1.0, 3.0)
        lo, hi = int(x), int(min(size, np.ceil(x + w)))
        for t in range(lo, hi):
            p = (t + 0.5 - x) / w
            col[t] = 0.15 + 0.55 * np.sin(np.pi * np.clip(p, 0, 1))
            alpha[t] = 1.0
        x += w / 0.6
    if not alpha_cut:
        col = np.where(alpha > 0, col, 0.15)
        alpha = np.ones(size)
    row = np.stack([col, col, col, alpha], axis=1)
    return load_png(np.tile(row[None, :, :], (size, 1, 1)), name)


def ramp_image(name, size):
    x = np.linspace(0.05, 0.95, size)
    row = np.stack([x, x, x, np.ones(size)], axis=1)
    return load_png(np.tile(row[None, :, :], (size, 1, 1)), name)


if lab.startswith('balls'):
    for i, (centre, base, metal, rough) in enumerate(S.BALLS):
        sphere('ball%d' % i, centre, S.BALL_RADIUS, principled('m%d' % i, base, metal, rough))
elif lab.startswith('shadow'):
    # The floor faces +Y: counter-clockwise seen from above.
    flat_face('floor', [(-6, 0, -6), (-6, 0, 6), (6, 0, 6), (6, 0, -6)], ((0, 0), (0, 1), (1, 1), (1, 0)), principled('floor', (0.6, 0.6, 0.6), 0.0, 1.0))
    box('box', (-0.9, 0.5, 0.4), (1.0, 1.0, 1.0), principled('boxm', (0.8, 0.3, 0.25), 0.0, 0.8))
    sphere('ball', (1.1, 0.55, -0.3), 0.55, principled('ballm', (0.3, 0.55, 0.8), 0.0, 0.5))
elif lab == 'strands':
    n = 1024
    fine = hair_image('fine', n, True)
    solid = hair_image('solid', n, False)
    ramp = ramp_image('ramp', n)
    card('cut', (0.4, 0.0, 0.0), 0.25, 0.25, principled('cut', (1, 1, 1), 0.0, 1.0, fine, 0.5))
    card('opaque', (0.0, 0.0, 0.0), 0.25, 0.25, principled('opaque', (1, 1, 1), 0.0, 1.0, solid))
    card('ramp', (-0.4, 0.0, 0.0), 0.25, 0.25, principled('ramp', (1, 1, 1), 0.0, 1.0, ramp))

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)

# The exporter writes a linked alpha as BLEND; a cut-out is MASK with its cutoff, which is what the importer on either side then reads.
if CUTOUTS:
    data = open(out, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + jlen])
    for m in doc['materials']:
        if m['name'] in CUTOUTS:
            m['alphaMode'] = 'MASK'
            m['alphaCutoff'] = CUTOUTS[m['name']]
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    rest = data[20 + jlen:]
    total = 12 + 8 + len(js) + len(rest)
    open(out, 'wb').write(data[:8] + struct.pack('<I', total) + struct.pack('<I', len(js)) + data[16:20] + js + rest)
print('exported', out)
