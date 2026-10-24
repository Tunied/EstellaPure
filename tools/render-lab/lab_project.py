"""The engine's side of a lab scene: a project holding the lab GLB, the camera, the sun and the sky of its spec.
python lab_project.py <projectDir> <lab> <scene.glb>   (env BACKEND, EFFECTS (json), Q (json quality), EXTENT)
"""
import json
import math
import os
import shutil
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lab_specs as S  # noqa: E402

proj, lab, glb = sys.argv[1:4]
spec = S.LABS[lab]
os.makedirs(proj + '/assets/models/lab', exist_ok=True)
os.makedirs(proj + '/assets/env', exist_ok=True)
os.makedirs(proj + '/assets/scenes', exist_ok=True)
shutil.copy(glb, proj + '/assets/models/lab/lab.glb')
json.dump({'uuid': str(uuid.uuid4()), 'version': '2.0', 'type': 'model', 'importer': {}}, open(proj + '/assets/models/lab/lab.glb.meta', 'w'), indent=2)
json.dump({'formatVersion': '1', 'name': 'Lab', 'version': '0.1.0', 'tag': '3D', 'defaultScene': 'assets/scenes/lab.esscene',
           'designResolution': {'width': S.SIZE[0], 'height': S.SIZE[1]}, 'spineVersion': 'none',
           'features': {'rendering': {'backend': os.environ.get('BACKEND', 'webgl2'), 'colorSpace': 'linear', 'outputTransform': 'none',
                                      'quality': dict({'mode': 'high'}, **json.loads(os.environ.get('Q', '{}')))}}},
          open(proj + '/project.esproject', 'w'), indent=2)

ambient = spec['ambient']
w, h = 64, 32


def rgbe(v):
    if v <= 0:
        return bytes((0, 0, 0, 0))
    m, e = math.frexp(v)
    return bytes((int(m * 256),) * 3 + (e + 128,))


with open(proj + '/assets/env/uniform.hdr', 'wb') as f:
    f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n' % (h, w))
    f.write(rgbe(max(ambient, 1e-6)) * (w * h))

pos, target, fov = spec['cam']
qw, qx, qy, qz = S.cam_quaternion(spec['cam'])
entities = [
    {'id': 0, 'name': 'Camera', 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'Transform', 'data': {'position': {'x': pos[0], 'y': pos[1], 'z': pos[2]}, 'rotation': {'w': qw, 'x': qx, 'y': qy, 'z': qz}}},
        {'type': 'Camera', 'data': {'projectionType': 0, 'fov': fov, 'nearPlane': 0.05, 'farPlane': 100.0, 'isActive': True, 'priority': 0, 'clearFlags': 3}}]},
]
if ambient > 0:
    entities.append({'id': 1, 'name': 'Sky', 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'Transform', 'data': {}},
        {'type': 'Light', 'data': {'type': 2, 'color': {'r': 1, 'g': 1, 'b': 1, 'a': 1}, 'intensity': 1.0, 'enabled': True,
                                   'environment': 'assets/env/uniform.esenv', 'drawEnvironment': True}}]})
if spec['sun']:
    sw, sx, sy, sz = S.sun_quaternion(spec['sun']['dir'])
    entities.append({'id': 5, 'name': 'Sun', 'parent': None, 'children': [], 'visible': True, 'components': [
        {'type': 'Transform', 'data': {'rotation': {'w': sw, 'x': sx, 'y': sy, 'z': sz}}},
        {'type': 'Light', 'data': {'type': 1, 'color': {'r': 1, 'g': 1, 'b': 1, 'a': 1}, 'intensity': spec['sun']['intensity'], 'enabled': True,
                                   'meshShadows': os.environ.get('SHADOW', '1') == '1', 'shadowExtent': float(os.environ.get('EXTENT', '0')), 'shadowStrength': 1.0,
                                   'sourceAngle': spec['sun']['angle']}}]})
effects = json.loads(os.environ.get('EFFECTS', '[]'))
if effects:
    entities[0]['components'].append({'type': 'PostProcessVolume', 'data': {'isGlobal': True, 'weight': 1, 'priority': 0, 'effects': effects}})
json.dump({'version': 4, 'name': 'Lab', 'entities': entities}, open(proj + '/assets/scenes/lab.esscene', 'w'), indent=1)
print('project ready')
