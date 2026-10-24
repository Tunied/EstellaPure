"""Compares the engine's picture of a lab scene with Blender's, region by region, and writes a side-by-side.
python lab_compare.py <lab> <ref.png> <engine.png> [out.png]
For the ball scenes each sphere is read in three places: where the light faces it (diffuse), at its highlight, and at its rim (Fresnel).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lab_specs as S  # noqa: E402

lab, ref_path, eng_path = sys.argv[1:4]
spec = S.LABS[lab]
ref = np.array(Image.open(ref_path).convert('RGB')).astype(float)
eng = np.array(Image.open(eng_path).convert('RGB')).astype(float)
print('mean abs difference over the frame: %.2f / 255' % np.abs(ref - eng).mean())


def disc(cx, cy, r):
    ys, xs = np.mgrid[0:S.SIZE[1], 0:S.SIZE[0]]
    return (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r


def report(name, mask):
    r, e = ref[mask].mean(0), eng[mask].mean(0)
    d = np.abs(ref[mask] - eng[mask]).mean()
    print('%-22s ref %5.1f %5.1f %5.1f   engine %5.1f %5.1f %5.1f   ratio %.3f %.3f %.3f   mean|d| %.2f' % ((name,) + tuple(r) + tuple(e) + tuple(e / np.maximum(r, 0.5)) + (d,)))


if lab.startswith('balls'):
    for i, (centre, base, metal, rough) in enumerate(S.BALLS):
        px, py, z = S.project(centre, spec['cam'])
        rpx = S.BALL_RADIUS / z / np.tan(np.radians(spec['cam'][2]) / 2) * S.SIZE[1] / 2
        report('ball%d %s r%.2f all' % (i, 'metal' if metal else 'diel', rough), disc(px, py, rpx * 0.97))
        report('   core', disc(px, py, rpx * 0.5))
        ring = disc(px, py, rpx * 0.97) & ~disc(px, py, rpx * 0.8)
        report('   rim', ring)
else:
    print('(whole frame only)')

side = np.concatenate([ref, eng, np.clip(np.abs(ref - eng) * 4, 0, 255)], axis=1).astype(np.uint8)
im = Image.fromarray(side)
d = ImageDraw.Draw(im)
for k, t in enumerate(('blender', 'engine', 'difference x4')):
    d.text((8 + k * S.SIZE[0], 6), t, fill=(255, 255, 0))
im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(sys.argv[4] if len(sys.argv) > 4 else eng_path.replace('.png', '_cmp.png'))
