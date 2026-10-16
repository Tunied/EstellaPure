# Reference OpenEXR files

Written by Blender 5.2.1 (`blender -b --python make_exr.py`), as an independent producer: the
decoder is checked against files it did not help write.

Each file is a 16x8 RGB image, one file per compression (`none`, `rle`, `zips`, `zip`, `piz`,
`pxr24`, `dwaa`) at half (`_16`) and float (`_32`) precision. The value at texel (x, y), counted
from the top of the picture, is

    r = x + 0.25
    g = y + 0.5
    b = (x * 3 + y) / 4 + (100 if x == 5 and y == 2 else 0)

so every channel differs from its neighbours and one texel is far past 1.

The generator script:

```python
import bpy, sys, os
out = sys.argv[sys.argv.index('--') + 1]
os.makedirs(out, exist_ok=True)
W, H = 16, 8
def value(x, y):
    return (x + 0.25, y + 0.5, (x * 3 + y) / 4 + (100.0 if (x == 5 and y == 2) else 0.0))
img = bpy.data.images.new('ref', W, H, alpha=True, float_buffer=True)
px = []
for row in range(H):          # Blender stores rows bottom to top
    y = H - 1 - row
    for x in range(W):
        r, g, b = value(x, y)
        px += [r, g, b, 1.0]
img.pixels = px
scene = bpy.context.scene
s = scene.render.image_settings
for codec in ('NONE', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'DWAA'):
    for depth in ('16', '32'):
        s.file_format = 'OPEN_EXR'; s.color_mode = 'RGB'; s.color_depth = depth; s.exr_codec = codec
        img.save_render(os.path.join(out, f'ref_{codec.lower()}_{depth}.exr'), scene=scene)
```
