"""Build a low-poly, textured antique typewriter in Blender.

Generates the palette/wood/legend texture atlas, models every part with
bmesh, saves assets/typewriter/typewriter.blend, and exports a GLB. Pass
--render to also write preview renders.

From the repository root:
    blender --background --python-exit-code 1 \
        --python assets/typewriter/build-typewriter.py -- --render
"""

import argparse
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
import numpy as np

HERE = Path(__file__).resolve().parent

# --------------------------------------------------------------------------
# Texture atlas
# --------------------------------------------------------------------------

ATLAS_W, ATLAS_H = 2048, 1024
SWATCH = 32
TILE = 64
PAPER_RECT = (512, 0, 512, 384)  # x, y, w, h in pixels, top-left origin
BADGE_RECT = (0, 448, 512, 112)
SCALE_RECT = (0, 576, 512, 32)
WOOD_RECT = (1024, 0, 1024, 1024)
WOOD_SPAN = 0.4  # metres of wood covered by WOOD_RECT

# name: (sRGB hex, roughness, metallic)
PALETTE = {
    'wood': ('#3e2615', 0.4, 0.0),
    'black': ('#161515', 0.35, 0.0),
    'rubber': ('#121212', 0.85, 0.0),
    'nickel': ('#d8d4cc', 0.22, 1.0),
    'steel': ('#8d8a85', 0.35, 1.0),
    'brass': ('#c9a04a', 0.28, 1.0),
    'key': ('#ece2c6', 0.3, 0.0),
    'legend': ('#1b1612', 0.3, 0.0),
    'ribbon_black': ('#232325', 0.9, 0.0),
    'ribbon_red': ('#a8302a', 0.85, 0.0),
    'felt': ('#5a2a20', 1.0, 0.0),
    'opening': ('#0e0c0b', 0.9, 0.0),
    'paper': ('#f2ead6', 0.95, 0.0),
    'cream': ('#e8dcbc', 0.5, 0.0),
    'ink': ('#1d1b1f', 0.9, 0.0),
}
SWATCHES = {name: i for i, name in enumerate(PALETTE)}

GLYPHS = {
    'A': '.###. #...# #...# ##### #...# #...# #...#',
    'B': '####. #...# #...# ####. #...# #...# ####.',
    'C': '.###. #...# #.... #.... #.... #...# .###.',
    'D': '###.. #..#. #...# #...# #...# #..#. ###..',
    'E': '##### #.... #.... ####. #.... #.... #####',
    'F': '##### #.... #.... ####. #.... #.... #....',
    'G': '.###. #...# #.... #.### #...# #...# .####',
    'H': '#...# #...# #...# ##### #...# #...# #...#',
    'I': '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
    'J': '..### ...#. ...#. ...#. ...#. #..#. .##..',
    'K': '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
    'L': '#.... #.... #.... #.... #.... #.... #####',
    'M': '#...# ##.## #.#.# #.#.# #...# #...# #...#',
    'N': '#...# #...# ##..# #.#.# #..## #...# #...#',
    'O': '.###. #...# #...# #...# #...# #...# .###.',
    'P': '####. #...# #...# ####. #.... #.... #....',
    'Q': '.###. #...# #...# #...# #.#.# #..#. .##.#',
    'R': '####. #...# #...# ####. #.#.. #..#. #...#',
    'S': '.#### #.... #.... .###. ....# ....# ####.',
    'T': '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    'U': '#...# #...# #...# #...# #...# #...# .###.',
    'V': '#...# #...# #...# #...# #...# .#.#. ..#..',
    'W': '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
    'X': '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    'Y': '#...# #...# #...# .#.#. ..#.. ..#.. ..#..',
    'Z': '##### ....# ...#. ..#.. .#... #.... #####',
    '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
    '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    '2': '.###. #...# ....# ...#. ..#.. .#... #####',
    '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
    '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
    '5': '##### #.... ####. ....# ....# #...# .###.',
    '6': '..##. .#... #.... ####. #...# #...# .###.',
    '7': '##### ....# ...#. ..#.. .#... .#... .#...',
    '8': '.###. #...# #...# .###. #...# #...# .###.',
    '9': '.###. #...# #...# .#### ....# ...#. .##..',
    '.': '..... ..... ..... ..... ..... .##.. .##..',
    ',': '..... ..... ..... ..... .##.. ..#.. .#...',
    ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
    ':': '..... .##.. .##.. ..... .##.. .##.. .....',
    '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
    '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    "'": '..#.. ..#.. .#... ..... ..... ..... .....',
    '-': '..... ..... ..... ##### ..... ..... .....',
    '/': '....# ....# ...#. ..#.. .#... #.... #....',
    '^': '...#... ..###.. .#####. ####### ..###.. ..###.. ..###..',
    ' ': '..... ..... ..... ..... ..... ..... .....',
}

KEY_ROWS = ('1234567890-', 'QWERTYUIOP', 'ASDFGHJKL;', 'ZXCVBNM,./')
LEGENDS = [c for row in KEY_ROWS for c in row] + ['^']

PAPER_TEXT = (
    'OCT 13, 2026',
    '',
    'DEAR READER,',
    '',
    'THIS LITTLE MACHINE WAS',
    'BUILT FROM BOXES, TUBES',
    'AND A FEW THOUSAND',
    'TRIANGLES.',
    '',
    'CLACK CLACK... DING!',
)


def hex_rgb(value):
    value = value.lstrip('#')
    return np.array([int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def glyph_mask(char):
    rows = GLYPHS[char].split()
    return np.array([[c == '#' for c in row] for row in rows])


def stamp(img, mask, x, y, scale, color, alpha=1.0, bold=0):
    block = np.kron(mask, np.ones((scale, scale), dtype=bool))
    for _ in range(bold):  # widen strokes to the right
        block = np.pad(block, ((0, 0), (0, 1)))
        block[:, 1:] |= block[:, :-1]
    h, w = block.shape
    region = img[y:y + h, x:x + w]
    region[block] = region[block] * (1 - alpha) + np.asarray(color) * alpha


def swatch_px(name):
    i = SWATCHES[name]
    return (i % 16) * SWATCH, (i // 16) * SWATCH


def tile_px(index):
    return (index % 8) * TILE, 64 + (index // 8) * TILE


def px_to_uv(x, y):
    return x / ATLAS_W, 1 - y / ATLAS_H


def value_noise(rng, size, cells_y, cells_x):
    """Smooth value noise; few cells along x keeps the grain running horizontally."""
    grid = rng.random((cells_y + 2, cells_x + 2))
    ys = np.linspace(0, cells_y, size, endpoint=False)
    xs = np.linspace(0, cells_x, size, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    top = grid[y0][:, x0] + (grid[y0][:, x0 + 1] - grid[y0][:, x0]) * fx
    bottom = grid[y0 + 1][:, x0] + (grid[y0 + 1][:, x0 + 1] - grid[y0 + 1][:, x0]) * fx
    return top + (bottom - top) * fy[:, None]


def wood_grain(size):
    """Dark walnut: warped growth rings, long fibres and sparse open pores."""
    rng = np.random.default_rng(3)
    rows = np.linspace(0, 1, size, endpoint=False)[:, None]
    warp = value_noise(rng, size, 5, 3) * 0.7 + value_noise(rng, size, 11, 5) * 0.3
    rings = 0.5 + 0.5 * np.sin((rows * 26 + warp * 5.5) * 2 * math.pi)
    rings = rings ** 4
    streaks = value_noise(rng, size, 90, 5) * 0.6 + value_noise(rng, size, 320, 9) * 0.4
    pores = value_noise(rng, size, 520, 90) > 0.86
    light, mid, dark = hex_rgb('#3f2918'), hex_rgb('#29190e'), hex_rgb('#110904')
    tone = np.clip(streaks * 1.4 - 0.25, 0, 1)[..., None]
    color = mid + (light - mid) * tone * 0.8
    color = color + (dark - color) * (rings * 0.55)[..., None]
    color[pores] = color[pores] * 0.7
    roughness = 0.38 + 0.08 * rings + 0.04 * pores
    return color, roughness


def build_atlas():
    color = np.zeros((ATLAS_H, ATLAS_W, 3))
    rough_metal = np.zeros((ATLAS_H, ATLAS_W, 3))
    rough_metal[..., 0] = 1.0  # glTF occlusion channel

    def fill(img, rect, value):
        x, y, w, h = rect
        img[y:y + h, x:x + w] = value

    def fill_mr(rect, name):
        _, roughness, metallic = PALETTE[name]
        fill(rough_metal, rect, (1.0, roughness, metallic))

    for name, (hex_value, _, _) in PALETTE.items():
        x, y = swatch_px(name)
        rect = (x, y, SWATCH, SWATCH)
        fill(color, rect, hex_rgb(hex_value))
        fill_mr(rect, name)

    # Key legends: dark glyph on an ivory cap.
    for index, char in enumerate(LEGENDS):
        x, y = tile_px(index)
        rect = (x, y, TILE, TILE)
        fill(color, rect, hex_rgb(PALETTE['key'][0]))
        fill_mr(rect, 'key')
        mask, scale, bold = glyph_mask(char), 5, 2
        gx = x + (TILE - mask.shape[1] * scale - bold) // 2
        gy = y + (TILE - mask.shape[0] * scale) // 2
        stamp(color, mask, gx, gy, scale, hex_rgb(PALETTE['legend'][0]), bold=bold)

    # Typed sheet of paper, ink density varies a little per strike.
    rng = random.Random(7)
    x, y, w, h = PAPER_RECT
    fill(color, PAPER_RECT, hex_rgb(PALETTE['paper'][0]))
    fill_mr(PAPER_RECT, 'paper')
    ink = hex_rgb(PALETTE['ink'][0])
    scale, margin, line_height = 2, 44, 22
    for row, line in enumerate(PAPER_TEXT):
        for col, char in enumerate(line):
            if char == ' ':
                continue
            cx = x + margin + col * 6 * scale
            cy = y + 36 + row * line_height + rng.choice((0, 0, 0, 1))
            stamp(color, glyph_mask(char), cx, cy, scale, ink, rng.uniform(0.7, 0.95))

    # Brass nameplate with an engraved PULPO logotype and border.
    x, y, w, h = BADGE_RECT
    engraved = hex_rgb('#2a1d10')
    engraved_mr = (1.0, 0.7, 0.0)
    fill(color, BADGE_RECT, hex_rgb(PALETTE['brass'][0]))
    fill_mr(BADGE_RECT, 'brass')
    for rect in ((x + 10, y + 10, w - 20, 4), (x + 10, y + h - 14, w - 20, 4),
                 (x + 10, y + 10, 4, h - 20), (x + w - 14, y + 10, 4, h - 20)):
        fill(color, rect, engraved)
        fill(rough_metal, rect, engraved_mr)
    scale = 10
    text_w = (5 * 6 - 1) * scale
    tx, ty = x + (w - text_w) // 2, y + (h - 7 * scale) // 2
    for i, char in enumerate('PULPO'):
        mask = glyph_mask(char)
        stamp(color, mask, tx + i * 6 * scale, ty, scale, engraved, bold=3)
        stamp(rough_metal, mask, tx + i * 6 * scale, ty, scale, engraved_mr, bold=3)

    # Paper scale strip with tick marks.
    x, y, w, h = SCALE_RECT
    fill(color, SCALE_RECT, hex_rgb(PALETTE['cream'][0]))
    fill_mr(SCALE_RECT, 'cream')
    for i in range(0, w, 8):
        tick = 20 if i % 40 == 0 else 10
        fill(color, (x + i, y, 2, tick), hex_rgb(PALETTE['black'][0]))

    x, y, w, h = WOOD_RECT
    wood, wood_rough = wood_grain(w)
    color[y:y + h, x:x + w] = wood
    rough_metal[y:y + h, x:x + w, 1] = wood_rough
    rough_metal[y:y + h, x:x + w, 2] = 0.0

    return color, rough_metal


def save_image(name, pixels, path, colorspace):
    scratch = bpy.data.images.new(name, ATLAS_W, ATLAS_H, alpha=False)
    rgba = np.ones((ATLAS_H, ATLAS_W, 4), dtype=np.float32)
    rgba[..., :3] = pixels
    scratch.pixels.foreach_set(rgba[::-1].ravel())
    scratch.filepath_raw = str(path)
    scratch.file_format = 'PNG'
    scratch.save()
    bpy.data.images.remove(scratch)
    image = bpy.data.images.load(str(path))
    image.name = name
    image.colorspace_settings.name = colorspace
    image.pack()
    return image


# --------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def frame_along(p0, p1, up=(0, 0, 1)):
    """Matrix whose local Z runs from p0 to p1 (origin at the midpoint)."""
    p0, p1 = Vector(p0), Vector(p1)
    z = (p1 - p0).normalized()
    ref = Vector(up) if abs(z.dot(Vector(up))) < 0.99 else Vector((1, 0, 0))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    rot = Matrix((x, y, z)).transposed().to_4x4()
    return Matrix.Translation((p0 + p1) / 2) @ rot, (p1 - p0).length


def bevel(bm, verts, offset):
    edges = list({e for v in verts for e in v.link_edges})
    bmesh.ops.bevel(
        bm, geom=list(verts) + edges, offset=offset, offset_type='OFFSET',
        segments=1, profile=0.5, affect='EDGES', clamp_overlap=True,
    )


def box(bm, size, loc, rot=(0, 0, 0), chamfer=0.0):
    verts = bmesh.ops.create_cube(bm, size=1.0, matrix=trs(loc, rot, size))['verts']
    if chamfer:
        bevel(bm, verts, chamfer)


def beam(bm, p0, p1, width, height, up=(0, 0, 1)):
    matrix, length = frame_along(p0, p1, up)
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix @ Matrix.Diagonal((width, height, length, 1)))


def cylinder(bm, radius, depth, loc, rot=(0, 0, 0), segments=10, radius2=None, chamfer=0.0):
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
        radius2=radius if radius2 is None else radius2, depth=depth, matrix=trs(loc, rot),
    )['verts']
    if chamfer:
        bevel(bm, verts, chamfer)


def rod(bm, p0, p1, radius, segments=6):
    matrix, length = frame_along(p0, p1)
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
        radius2=radius, depth=length, matrix=matrix,
    )


def prism(bm, outline, offset, chamfer=0.0):
    """Extrude a closed planar outline of 3D points along an offset vector."""
    offset = Vector(offset)
    a = [bm.verts.new(p) for p in outline]
    b = [bm.verts.new(Vector(p) + offset) for p in outline]
    faces = [bm.faces.new(a), bm.faces.new(b[::-1])]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    if chamfer:
        bevel(bm, a + b, chamfer)


def side_prism(bm, profile_yz, x0, x1, chamfer=0.0):
    prism(bm, [(x0, y, z) for y, z in profile_yz], (x1 - x0, 0, 0), chamfer)


def arc_ring(bm, center, r_in, r_out, z0, z1, a0, a1, segments):
    cx, cy = center
    rings = []
    for k in range(segments + 1):
        t = math.radians(a0 + (a1 - a0) * k / segments)
        c, s = math.cos(t), math.sin(t)
        rings.append([
            bm.verts.new((cx + r * c, cy + r * s, z))
            for r, z in ((r_in, z0), (r_out, z0), (r_out, z1), (r_in, z1))
        ])
    faces = [bm.faces.new(rings[0]), bm.faces.new(rings[-1][::-1])]
    for k in range(segments):
        for i in range(4):
            j = (i + 1) % 4
            faces.append(bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


class Part:
    """One output object; geometry is added in painted batches."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()

    def add(self, build, paint):
        before = set(self.bm.faces)
        build(self.bm)
        new = [f for f in self.bm.faces if f not in before]
        for face in new:
            face.normal_update()
            face.smooth = False
        if isinstance(paint, str):
            u, v = swatch_uv(paint)
            for face in new:
                for loop in face.loops:
                    loop[self.uv].uv = (u, v)
        else:
            paint(new, self.uv)

    def finish(self, collection, parent, material):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.materials.append(material)
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        obj.parent = parent
        return obj


def swatch_uv(name):
    x, y = swatch_px(name)
    return px_to_uv(x + SWATCH / 2, y + SWATCH / 2)


def rect_uv(rect, s, t):
    """UV for normalized (s, t) inside a pixel rect; t=1 is the rect's top."""
    x, y, w, h = rect
    return px_to_uv(x + s * w, y + (1 - t) * h)


def wood_paint(vertical=False):
    """Box-project faces onto the wood grain.

    Grain runs along X (or Y on side faces); vertical=True turns it upright.
    """

    def paint(faces, uv):
        for face in faces:
            axis = max(range(3), key=lambda i: abs(face.normal[i]))
            for loop in face.loops:
                x, y, z = loop.vert.co
                n = (x / WOOD_SPAN + 0.5, y / WOOD_SPAN + 0.5, z / WOOD_SPAN + 0.1)
                s, t = {0: (n[1], n[2]), 1: (n[0], n[2]), 2: (n[0], n[1])}[axis]
                if vertical:
                    s, t = t, s
                s, t = min(max(s, 0.002), 0.998), min(max(t, 0.002), 0.998)
                loop[uv].uv = rect_uv(WOOD_RECT, s, t)

    return paint


wood = wood_paint()


def planar(rect, matrix, size, fallback):
    """Map faces facing the matrix's local +Z onto rect; paint the rest with a swatch."""
    inverse = matrix.inverted()
    up = (matrix.to_3x3() @ Vector((0, 0, 1))).normalized()
    width, height = size

    def paint(faces, uv):
        fu, fv = swatch_uv(fallback)
        for face in faces:
            front = face.normal.dot(up) > 0.99
            for loop in face.loops:
                if front:
                    local = inverse @ loop.vert.co
                    loop[uv].uv = rect_uv(rect, local.x / width + 0.5, local.y / height + 0.5)
                else:
                    loop[uv].uv = (fu, fv)

    return paint


# --------------------------------------------------------------------------
# Typewriter
# --------------------------------------------------------------------------

FOOT = 0.008
BASE_TOP = 0.026
SIDE_X = (0.14, 0.155)
# The side frames stop at the hood so the keyboard is open from the sides.
SIDE_PROFILE = [(-0.075, BASE_TOP), (0.135, BASE_TOP), (0.135, 0.15), (0.115, 0.162),
                (-0.035, 0.162), (-0.065, 0.135), (-0.075, 0.09)]
HOOD_PROFILE = [(-0.07, BASE_TOP), (0.132, BASE_TOP), (0.132, 0.148), (0.112, 0.155),
                (-0.04, 0.155), (-0.06, 0.14), (-0.07, 0.1)]
DECK_Z = 0.155
KEY_PITCH = 0.019
KEY_ROW_Y = (-0.087, -0.108, -0.129, -0.150)
KEY_ROW_Z = (0.109, 0.092, 0.075, 0.058)
KEY_ROW_SHIFT = (0.0, 0.5, 0.75, 1.25)
KEY_RADIUS = 0.0075
KEY_TILT = math.radians(15)
LEVER_Z = 0.036
PLATEN_Y, PLATEN_Z, PLATEN_R = 0.088, 0.2, 0.025
FAN_CENTER = (0.0, 0.055)
SPOOL_X, SPOOL_Y = 0.112, 0.04


def body_parts():
    body = Part('Body')
    body.add(lambda bm: side_prism(bm, HOOD_PROFILE, -SIDE_X[0], SIDE_X[0], 0.003), wood)
    for x0, x1 in ((-SIDE_X[1], -SIDE_X[0]), SIDE_X):
        body.add(lambda bm, x0=x0, x1=x1: side_prism(bm, SIDE_PROFILE, x0, x1, 0.004), wood)

    base = Part('Base')
    base.add(lambda bm: box(bm, (0.33, 0.335, BASE_TOP - FOOT), (0, -0.0175, (FOOT + BASE_TOP) / 2), chamfer=0.004), wood)
    for x in (-0.14, 0.14):
        for y in (-0.16, 0.125):
            base.add(lambda bm, x=x, y=y: cylinder(bm, 0.012, FOOT, (x, y, FOOT / 2), segments=8), 'rubber')

    # Raised, cross-grained side panels held by brass screws.
    trim = Part('Side Panels')
    panel = [(-0.045, 0.045), (0.115, 0.045), (0.115, 0.14), (0.0, 0.14)]
    screws = [(-0.054, 0.037), (0.124, 0.037), (0.124, 0.149), (-0.008, 0.149)]
    for sign in (-1, 1):
        x = sign * SIDE_X[1]
        trim.add(lambda bm, x=x: side_prism(bm, panel, x, x + sign * 0.003, 0.0015), wood_paint(vertical=True))
        for y, z in screws:
            trim.add(lambda bm, x=x, y=y, z=z: cylinder(
                bm, 0.0028, 0.0016, (x + sign * 0.0006, y, z), (0, math.pi / 2, 0), segments=6), 'brass')
    return [body, base, trim]


def badge_parts():
    # Brass nameplate on the chamfer between the hood front and the deck.
    (y0, z0), (y1, z1) = HOOD_PROFILE[-2], HOOD_PROFILE[-3]
    along = Vector((y1 - y0, z1 - z0)).normalized()
    normal = Vector((-along.y, along.x))
    tilt = math.atan2(-normal.x, normal.y)
    center = Vector(((y0 + y1) / 2, (z0 + z1) / 2)) + normal * 0.0006
    size = (0.075, 0.016)
    matrix = trs((0, center.x, center.y), (tilt, 0, 0))
    badge = Part('Nameplate')
    badge.add(lambda bm: box(bm, (*size, 0.0012), (0, center.x, center.y), (tilt, 0, 0)),
              planar(BADGE_RECT, matrix, size, 'brass'))
    return [badge]


def key_parts():
    keys = Part('Keys')
    rings = Part('Key Rings')
    levers = Part('Key Levers')
    span_center = 5.5  # between the left (-0.25) and right (11.25) shift keys

    def key(x, y, z, radius, legend_index):
        matrix = trs((x, y, z), (KEY_TILT, 0, 0))
        tx, ty = tile_px(legend_index)
        legend = (tx, ty, TILE, TILE)
        keys.add(lambda bm: bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=10, radius1=radius, radius2=radius,
            depth=0.005, matrix=matrix), planar(legend, matrix, (2.17 * radius, 2.17 * radius), 'key'))
        rings.add(lambda bm: bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=10, radius1=radius + 0.0012,
            radius2=radius + 0.0012, depth=0.0035, matrix=matrix @ Matrix.Translation((0, 0, -0.0012))), 'brass')
        levers.add(lambda bm: box(bm, (0.0024, 0.0024, z - LEVER_Z), (x, y, (z + LEVER_Z) / 2 - 0.002)), 'nickel')
        levers.add(lambda bm: box(bm, (0.0026, -0.066 - y, 0.004), (x, (y - 0.066) / 2, LEVER_Z - 0.003)), 'black')

    index = 0
    for chars, shift, y, z in zip(KEY_ROWS, KEY_ROW_SHIFT, KEY_ROW_Y, KEY_ROW_Z):
        for i, _ in enumerate(chars):
            key((shift + i - span_center) * KEY_PITCH, y, z, KEY_RADIUS, index)
            index += 1
    for pos in (-0.25, 11.25):
        key((pos - span_center) * KEY_PITCH, KEY_ROW_Y[3] - 0.004, KEY_ROW_Z[3] - 0.002,
            KEY_RADIUS + 0.0015, LEGENDS.index('^'))

    space = Part('Space Bar')
    bar_y, bar_z = -0.171, 0.047
    space.add(lambda bm: box(bm, (0.15, 0.009, 0.007), (0.005, bar_y, bar_z), chamfer=0.0018), wood)
    for x in (-0.05, 0.06):
        space.add(lambda bm, x=x: beam(bm, (x, bar_y + 0.002, bar_z - 0.002), (x, -0.14, LEVER_Z - 0.003),
                                       0.004, 0.003, up=(0, 1, 0)), 'black')
    return [keys, rings, levers, space]


def basket_parts():
    basket = Part('Type Basket')
    cx, cy = FAN_CENTER
    top = DECK_Z
    a0, a1 = 198, 342

    def plate(bm):
        outline = [(cx, cy, top)]
        for k in range(11):
            t = math.radians(a0 + (a1 - a0) * k / 10)
            outline.append((cx + 0.09 * math.cos(t), cy + 0.09 * math.sin(t), top))
        prism(bm, outline, (0, 0, 0.0008))

    basket.add(plate, 'opening')
    basket.add(lambda bm: arc_ring(bm, FAN_CENTER, 0.03, 0.038, top, top + 0.007, a0, a1, 10), 'nickel')
    basket.add(lambda bm: arc_ring(bm, FAN_CENTER, 0.08, 0.088, top, top + 0.004, a0, a1, 10), 'felt')

    bars = Part('Typebars')
    count = 21
    for k in range(count):
        t = math.radians(202 + 136 * k / (count - 1))
        d = Vector((math.cos(t), math.sin(t), 0))
        base = Vector((cx, cy, top + 0.0045))
        bars.add(lambda bm, d=d, base=base: beam(bm, base + d * 0.034, base + d * 0.081, 0.0022, 0.0016), 'steel')
        bars.add(lambda bm, d=d, base=base: beam(bm, base + d * 0.079, base + d * 0.085, 0.0034, 0.003), 'nickel')
    return [basket, bars]


def ribbon_parts():
    spools = Part('Ribbon Spools')
    top = DECK_Z
    for sign in (-1, 1):
        x = sign * SPOOL_X
        spools.add(lambda bm, x=x: cylinder(bm, 0.024, 0.002, (x, SPOOL_Y, top + 0.001), segments=12), 'brass')
        spools.add(lambda bm, x=x: cylinder(bm, 0.019, 0.008, (x, SPOOL_Y, top + 0.006), segments=12), 'ribbon_black')
        spools.add(lambda bm, x=x: cylinder(bm, 0.022, 0.0015, (x, SPOOL_Y, top + 0.0105), segments=12), 'brass')
        spools.add(lambda bm, x=x: cylinder(bm, 0.005, 0.006, (x, SPOOL_Y, top + 0.013), segments=6), 'nickel')

    ribbon = Part('Ribbon')
    # The ribbon leaves the back of each spool and runs straight across the
    # front of the platen, rising through the guide at the printing point.
    guide_y = PLATEN_Y - PLATEN_R - 0.004
    guide_z = PLATEN_Z - 0.014
    path = [(-SPOOL_X, guide_y, top + 0.003), (-0.016, guide_y, guide_z),
            (0.016, guide_y, guide_z), (SPOOL_X, guide_y, top + 0.003)]

    def band(bm, lo, hi):
        verts = [(bm.verts.new((x, y, z + lo)), bm.verts.new((x, y, z + hi))) for x, y, z in path]
        for (a, b), (c, d) in zip(verts, verts[1:]):
            bm.faces.new((a, c, d, b))

    ribbon.add(lambda bm: band(bm, 0.0, 0.004), 'ribbon_red')
    ribbon.add(lambda bm: band(bm, 0.004, 0.008), 'ribbon_black')
    for x in (-0.017, 0.017):
        ribbon.add(lambda bm, x=x: box(bm, (0.003, 0.004, 0.012), (x, guide_y, guide_z + 0.004)), 'nickel')
    return [spools, ribbon]


def carriage_parts():
    carriage = Part('Carriage')
    frame_z = (0.162, 0.175)
    carriage.add(lambda bm: box(bm, (0.344, 0.057, frame_z[1] - frame_z[0]), (0, 0.0965, sum(frame_z) / 2), chamfer=0.002), 'black')
    carriage.add(lambda bm: box(bm, (0.36, 0.004, 0.006), (0, 0.127, frame_z[0] + 0.005)), 'nickel')
    for sign in (-1, 1):
        carriage.add(lambda bm, sign=sign: box(bm, (0.008, 0.067, 0.062), (sign * 0.172, 0.0915, 0.193), chamfer=0.002), 'black')

    scale_z = frame_z[1] + 0.004
    scale_size = (0.336, 0.006)
    scale_matrix = trs((0, PLATEN_Y - PLATEN_R - 0.0075, scale_z), (math.pi / 2, 0, 0))
    carriage.add(lambda bm: box(bm, (scale_size[0], 0.003, scale_size[1]), (0, PLATEN_Y - PLATEN_R - 0.0075, scale_z)),
                 planar(SCALE_RECT, scale_matrix, scale_size, 'cream'))

    platen = Part('Platen')
    platen.add(lambda bm: cylinder(bm, PLATEN_R, 0.334, (0, PLATEN_Y, PLATEN_Z), (0, math.pi / 2, 0), segments=12), 'rubber')
    knobs = Part('Platen Knobs')
    for sign in (-1, 1):
        knobs.add(lambda bm, sign=sign: rod(bm, (sign * 0.167, PLATEN_Y, PLATEN_Z), (sign * 0.186, PLATEN_Y, PLATEN_Z), 0.0045), 'nickel')
        knobs.add(lambda bm, sign=sign: cylinder(bm, 0.022, 0.024, (sign * 0.197, PLATEN_Y, PLATEN_Z), (0, math.pi / 2, 0), segments=12, chamfer=0.0025), 'black')
        knobs.add(lambda bm, sign=sign: cylinder(bm, 0.011, 0.003, (sign * 0.209, PLATEN_Y, PLATEN_Z), (0, math.pi / 2, 0), segments=12), 'brass')

    bail = Part('Paper Bail')
    bail_y, bail_z = PLATEN_Y - PLATEN_R - 0.007, PLATEN_Z + 0.015
    bail.add(lambda bm: rod(bm, (-0.15, bail_y, bail_z), (0.15, bail_y, bail_z), 0.002), 'nickel')
    for sign in (-1, 1):
        bail.add(lambda bm, sign=sign: rod(bm, (sign * 0.15, bail_y, bail_z), (sign * 0.168, PLATEN_Y - 0.008, PLATEN_Z + 0.012), 0.002), 'nickel')
    for x in (-0.055, 0.055):
        bail.add(lambda bm, x=x: cylinder(bm, 0.005, 0.011, (x, bail_y, bail_z), (0, math.pi / 2, 0), segments=8), 'rubber')

    lever = Part('Return Lever')
    points = [(-0.176, 0.07, PLATEN_Z + 0.015), (-0.196, 0.035, PLATEN_Z + 0.034), (-0.206, -0.005, PLATEN_Z + 0.036)]
    for p0, p1 in zip(points, points[1:]):
        lever.add(lambda bm, p0=p0, p1=p1: beam(bm, p0, p1, 0.006, 0.0035), 'nickel')
    lever.add(lambda bm: box(bm, (0.013, 0.028, 0.0045), (-0.208, -0.018, PLATEN_Z + 0.036), (0, 0.15, 0.1), chamfer=0.0012), 'nickel')
    return [carriage, platen, knobs, bail, lever]


def paper_parts():
    width = 0.2159
    pts = []
    for deg in (-40, -20, 0, 15):
        t = math.radians(deg)
        r = PLATEN_R + 0.0008
        pts.append(Vector((PLATEN_Y - r * math.cos(t), PLATEN_Z + r * math.sin(t))))
    for elevation, length in ((75, 0.045), (75, 0.045), (66, 0.03), (55, 0.02)):
        e = math.radians(elevation)
        pts.append(pts[-1] + Vector((math.cos(e), math.sin(e))) * length)
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]

    paper = Part('Paper')

    def sheet(bm, back):
        offset = Vector((0.0004, -0.0001)) if back else Vector((0, 0))
        rows = [(bm.verts.new((-width / 2, p.x + offset.x, p.y + offset.y)),
                 bm.verts.new((width / 2, p.x + offset.x, p.y + offset.y))) for p in pts]
        # Front faces point at the typist; the back layer faces the other way.
        for (a, b), (c, d) in zip(rows, rows[1:]):
            bm.faces.new((c, d, b, a) if back else (a, b, d, c))

    def front_paint(faces, uv):
        for face in faces:
            for loop in face.loops:
                co = loop.vert.co
                index = min(range(len(pts)), key=lambda i: (pts[i] - Vector((co.y, co.z))).length)
                loop[uv].uv = rect_uv(PAPER_RECT, (co.x + width / 2) / width, lengths[index] / total)

    paper.add(lambda bm: sheet(bm, False), front_paint)
    paper.add(lambda bm: sheet(bm, True), 'paper')

    support = Part('Paper Table')
    d = (pts[5] - pts[4]).normalized()
    n = Vector((d.y, -d.x))  # points back, away from the typist
    start = pts[3] + d * 0.032 + n * 0.005
    end = pts[3] + d * 0.1 + n * 0.005
    outline = [(-0.1, start.x, start.y), (0.1, start.x, start.y), (0.1, end.x, end.y), (-0.1, end.x, end.y)]
    support.add(lambda bm: prism(bm, outline, (0, n.x * 0.002, n.y * 0.002), chamfer=0.0006), 'black')
    for x in (-0.08, 0.08):
        support.add(lambda bm, x=x: rod(bm, (x, start.x + n.x * 0.002, start.y + n.y * 0.002), (x, 0.12, 0.175), 0.002), 'nickel')
    return [paper, support]


def build_typewriter(material):
    collection = bpy.data.collections.new('Typewriter')
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new('Typewriter', None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.05
    collection.objects.link(root)
    parts = (body_parts() + badge_parts() + key_parts() + basket_parts()
             + ribbon_parts() + carriage_parts() + paper_parts())
    objects = [part.finish(collection, root, material) for part in parts]
    return root, objects


def build_material(color_image, rm_image):
    material = bpy.data.materials.new('Typewriter Atlas')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.location = (300, 0)
    color = nodes.new('ShaderNodeTexImage')
    color.image = color_image
    color.location = (-300, 200)
    rm = nodes.new('ShaderNodeTexImage')
    rm.image = rm_image
    rm.location = (-300, -150)
    split = nodes.new('ShaderNodeSeparateColor')
    split.location = (0, -150)
    links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(rm.outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    return material


# --------------------------------------------------------------------------
# Stage, export and previews
# --------------------------------------------------------------------------

TARGET = (0, -0.01, 0.12)


def build_stage():
    scene = bpy.context.scene
    collection = bpy.data.collections.new('Stage')
    scene.collection.children.link(collection)

    ground_mat = bpy.data.materials.new('Ground')
    ground_mat.use_nodes = True
    ground_bsdf = ground_mat.node_tree.nodes['Principled BSDF']
    ground_bsdf.inputs['Base Color'].default_value = (0.46, 0.41, 0.35, 1)
    ground_bsdf.inputs['Roughness'].default_value = 0.9
    mesh = bpy.data.meshes.new('Ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(ground_mat)
    ground = bpy.data.objects.new('Ground', mesh)
    collection.objects.link(ground)

    world = bpy.data.worlds.new('Studio')
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    hdri = nodes.new('ShaderNodeTexEnvironment')
    hdri_path = Path(bpy.utils.system_resource('DATAFILES')) / 'studiolights' / 'world' / 'interior.exr'
    hdri.image = bpy.data.images.load(str(hdri_path))
    hdri.image.pack()  # CC0 Poly Haven studio light; keeps the .blend portable
    env = nodes.new('ShaderNodeBackground')
    env.inputs['Strength'].default_value = 0.4
    backdrop = nodes.new('ShaderNodeBackground')
    backdrop.inputs['Color'].default_value = (0.46, 0.41, 0.35, 1)
    path = nodes.new('ShaderNodeLightPath')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(hdri.outputs['Color'], env.inputs['Color'])
    links.new(path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    links.new(env.outputs['Background'], mix.inputs[1])
    links.new(backdrop.outputs['Background'], mix.inputs[2])
    links.new(mix.outputs['Shader'], nodes['World Output'].inputs['Surface'])

    target = Vector(TARGET)

    def light(name, loc, energy, size, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.color = color
        data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        collection.objects.link(obj)

    light('Key Light', (-0.7, -0.8, 1.0), 60, 0.8, (1.0, 0.95, 0.88))
    light('Fill Light', (0.9, -0.5, 0.4), 18, 1.0, (0.85, 0.92, 1.0))
    light('Rim Light', (0.3, 0.9, 0.8), 45, 0.6)

    camera_data = bpy.data.cameras.new('Camera')
    camera_data.lens = 50
    camera = bpy.data.objects.new('Camera', camera_data)
    collection.objects.link(camera)
    scene.camera = camera
    aim(camera, *VIEWS['hero'])
    return camera


def aim(camera, loc, target):
    camera.location = loc
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def configure_render(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = 'GPU'
    except Exception as error:  # Fall back to CPU rendering.
        print(f'GPU unavailable: {error}', flush=True)
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.image_settings.file_format = 'PNG'


VIEWS = {
    'hero': ((-0.6, -0.78, 0.55), TARGET),
    'front': ((0.0, -1.0, 0.36), (0, 0, 0.12)),
    'right': ((0.82, 0.25, 0.4), TARGET),
    'left': ((-0.8, -0.28, 0.22), (0, -0.04, 0.1)),
    'top': ((0.001, -0.1, 0.95), (0, -0.01, 0.12)),
    'back': ((0.55, 0.8, 0.6), TARGET),
    'keys': ((-0.14, -0.45, 0.33), (0, -0.1, 0.09)),
}


def render_previews(camera, output, only=None):
    output.mkdir(parents=True, exist_ok=True)
    for name, (loc, look_at) in VIEWS.items():
        if only and name not in only:
            continue
        aim(camera, loc, look_at)
        bpy.context.scene.render.filepath = str(output / f'{name}.png')
        print(f'Rendering {name}', flush=True)
        bpy.ops.render.render(write_still=True)
    aim(camera, *VIEWS['hero'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--samples', type=int, default=96)
    parser.add_argument('--views', nargs='*', help='limit --render to these preview names')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'

    textures = args.output / 'textures'
    textures.mkdir(parents=True, exist_ok=True)
    color, rough_metal = build_atlas()
    color_image = save_image('typewriter_basecolor', color, textures / 'typewriter_basecolor.png', 'sRGB')
    rm_image = save_image('typewriter_orm', rough_metal, textures / 'typewriter_orm.png', 'Non-Color')
    material = build_material(color_image, rm_image)

    root, objects = build_typewriter(material)
    camera = build_stage()
    configure_render(args.samples)

    triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in objects)
    print(f'Typewriter: {len(objects)} objects, {triangles} triangles', flush=True)

    bpy.context.view_layer.update()
    for obj in bpy.context.view_layer.objects:
        obj.select_set(obj in objects or obj == root)
    bpy.ops.export_scene.gltf(
        filepath=str(args.output / 'typewriter.glb'), export_format='GLB',
        use_selection=True, export_apply=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'typewriter.blend'), compress=True)

    if args.render:
        render_previews(camera, args.output / 'previews', args.views)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'typewriter.blend'), compress=True)


if __name__ == '__main__':
    main()
