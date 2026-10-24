"""The render lab: small scenes whose answer is known, drawn by Blender (Cycles) and by the engine from one glTF.

A scene here is a few primitives and one light, so every pixel has an explanation: a sphere's brightness is a formula, a shadow's edge is where
a ray goes, a stack of cards lets through a fraction of the light that can be written down. What the two renderers disagree about is a bug
in one of them, and the scene says which formula to look at, which a character never does.

Coordinates are glTF's (metres, +Y up, the camera looks along +Z); Blender's are (x, -z, y) of these.
"""
import math

SUN_STRENGTH_PER_INTENSITY = math.pi   # Blender's sun in W/m^2 against the engine's: a white diffuse surface facing the sun shows `intensity` in the engine and S / pi in Blender.

CAM_BALLS = ((0.0, 0.0, -13.5), (0.0, 0.0, 0.0), 30.0)

LABS = {
    # Six spheres: a dielectric and a metal at three roughnesses, lit by a sun alone (no sky), which shows diffuse, the GGX lobe and Fresnel on their own.
    'balls_sun': dict(cam=CAM_BALLS, sun=dict(dir=(0.5, -0.45, 0.74), intensity=1.0, angle=0.0), ambient=0.0),
    # The same six under a uniform white sky and no sun: the diffuse irradiance is exactly the albedo, and the specular is the split-sum environment term.
    'balls_env': dict(cam=CAM_BALLS, sun=None, ambient=1.0),
    # A floor, a box and a sphere under a sun: the position and the edge of a shadow.
    'shadow': dict(cam=((0.0, 3.4, -6.2), (0.0, 0.2, 0.0), 32.0), sun=dict(dir=(0.45, -0.7, 0.55), intensity=1.0, angle=0.0), ambient=0.0),
    'shadow_soft': dict(cam=((0.0, 3.4, -6.2), (0.0, 0.2, 0.0), 32.0), sun=dict(dir=(0.45, -0.7, 0.55), intensity=1.0, angle=3.4), ambient=0.0),
    # Constant-colour cards under a uniform white sky: what a surface of a known albedo shows, with and without the light its specular takes.
    'cards': dict(cam=((0.0, 0.0, -4.0), (0.0, 0.0, 0.0), 20.0), sun=None, ambient=1.0),
    'cards_sun': dict(cam=((0.0, 0.0, -4.0), (0.0, 0.0, 0.0), 20.0), sun=dict(dir=(0.3, -0.3, 0.9), intensity=1.0, angle=0.0), ambient=0.0),
    # Three cards of fine stripes seen from a distance that shrinks them below a texel a pixel: a cut-out card, an opaque one, and a smooth ramp.
    'strands': dict(cam=((0.0, 0.0, -3.0), (0.0, 0.0, 0.0), 20.0), sun=None, ambient=1.0),
    # The middle card seen from close enough that one texel covers about a pixel: what the card averages to without the mip chain.
    'strands_near': dict(cam=((0.0, 0.0, -0.36), (0.0, 0.0, 0.0), 20.0), sun=None, ambient=1.0),
}

SIZE = (1280, 720)


def to_blender(v):
    return (v[0], -v[2], v[1])


def project(point, cam, size=SIZE):
    """Where a world point lands, in pixels, for a camera (position, target, vertical fov degrees) looking along its target."""
    pos, target, fov = cam
    f = [target[i] - pos[i] for i in range(3)]
    n = math.sqrt(sum(c * c for c in f))
    f = [c / n for c in f]
    right = [-f[2], 0.0, f[0]]   # cross(f, up) with up = +Y
    rn = math.sqrt(sum(c * c for c in right))
    right = [c / rn for c in right]
    up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]]
    d = [point[i] - pos[i] for i in range(3)]
    z = sum(d[i] * f[i] for i in range(3))
    x = sum(d[i] * right[i] for i in range(3))
    y = sum(d[i] * up[i] for i in range(3))
    t = math.tan(math.radians(fov) / 2)
    aspect = size[0] / size[1]
    px = (x / (z * t * aspect) * 0.5 + 0.5) * size[0]
    py = (0.5 - y / (z * t) * 0.5) * size[1]
    return px, py, z


def cam_quaternion(cam):
    """The engine camera's rotation (it looks along its local -Z, up is +Y), as (w, x, y, z)."""
    pos, target, _ = cam
    f = [target[i] - pos[i] for i in range(3)]
    n = math.sqrt(sum(c * c for c in f))
    f = [c / n for c in f]
    right = [-f[2], 0.0, f[0]]   # cross(f, +Y)
    rn = math.sqrt(sum(c * c for c in right))
    right = [c / rn for c in right]
    up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]]
    back = [-c for c in f]
    m = [[right[0], up[0], back[0]], [right[1], up[1], back[1]], [right[2], up[2], back[2]]]
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        return (0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s)
    if m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2
        return ((m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s)
    if m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2
        return ((m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s)
    s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2
    return ((m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s)


def sun_quaternion(d):
    """A light shines along its local -Z: the rotation that turns -Z onto direction d (shortest arc), as (w, x, y, z)."""
    a = (0.0, 0.0, -1.0)
    n0 = math.sqrt(sum(c * c for c in d))
    d = [c / n0 for c in d]
    cx, cy, cz = a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]
    w = 1 + (a[0] * d[0] + a[1] * d[1] + a[2] * d[2])
    n = math.sqrt(cx * cx + cy * cy + cz * cz + w * w)
    return (w / n, cx / n, cy / n, cz / n)


# Spheres of `balls_*`: (centre, base colour, metallic, roughness). The top row is dielectric and the bottom a metal, left to right 0.15 / 0.45 / 0.9.
BALLS = []
for row, (y, base, metal) in enumerate(((1.4, (0.8, 0.8, 0.8), 0.0), (-1.4, (0.95, 0.64, 0.54), 1.0))):
    for col, rough in enumerate((0.15, 0.45, 0.9)):
        BALLS.append(((-3.0 + 3.0 * col, y, 0.0), base, metal, rough))
BALL_RADIUS = 0.5


CARD_ALBEDOS = (0.0, 0.05, 0.2, 0.5, 1.0)


def card_centre(row, col):
    return (0.8 - 0.4 * col, 0.25 - 0.5 * row, 0.0)
