"""An 8-bit RGBA PNG written without any library: Blender will not save the pixels of an image made in a script."""
import struct
import zlib

import numpy as np


def write_png(path, rgba):
    """`rgba` is an (h, w, 4) float array in 0..1."""
    h, w, _ = rgba.shape
    bytes8 = np.clip(np.round(rgba * 255.0), 0, 255).astype(np.uint8)
    raw = b''.join(b'\x00' + bytes8[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
