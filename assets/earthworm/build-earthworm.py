"""Build and render a Pulpo-style earthworm mascot in Blender.

Matches the smiley icon: satin body with a soft upper-left key light, and a
faceted dark-grey face (low-poly eyes and smile).

From the repository root:
    blender --background --python-exit-code 1 \
        --python assets/earthworm/build-earthworm.py -- --size 2048

The app icon is the headshot (earthworm-icon*). Its Icon Composer layers are
rendered separately: earthworm-icon-body (no face) and earthworm-icon-face
(face only, the body held out so hidden parts of the eyes stay hidden). Stack
them without moving or resizing. earthworm-android-foreground is the same
headshot framed inside the Android adaptive-icon safe zone.

Regenerate the app icon files with:
    blender --background --python-exit-code 1 \
        --python assets/earthworm/build-earthworm.py -- --size 2048 --samples 512 \
        --only earthworm-icon,earthworm-icon-body,earthworm-icon-face,earthworm-android-foreground
then run assets/earthworm/install-app-icon.py (see README.md).
"""

import argparse
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent


def srgb(hex_color):
    hex_color = hex_color.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(hex_color[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# --------------------------------------------------------------------------
# Centreline
# --------------------------------------------------------------------------

def catmull_rom(points, samples_per_span=40):
    pts = [points[0]] + points + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(samples_per_span):
            t = k / samples_per_span
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(points[-1].copy())
    return out


def resample(points, count):
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    out, j = [], 0
    for i in range(count):
        s = total * i / (count - 1)
        while j < len(lengths) - 2 and lengths[j + 1] < s:
            j += 1
        seg = lengths[j + 1] - lengths[j]
        f = 0 if seg == 0 else (s - lengths[j]) / seg
        out.append(points[j].lerp(points[j + 1], f))
    return out, total


def frames(points):
    tangents = []
    for i in range(len(points)):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        tangents.append((b - a).normalized())
    # Parallel transport, seeded so the first normal points up.
    n = Vector((0, 0, 1))
    n = (n - tangents[0] * n.dot(tangents[0])).normalized()
    normals = [n]
    for i in range(1, len(points)):
        t0, t1 = tangents[i - 1], tangents[i]
        axis = t0.cross(t1)
        if axis.length > 1e-8:
            angle = math.acos(max(-1, min(1, t0.dot(t1))))
            n = Matrix.Rotation(angle, 3, axis.normalized()) @ n
        n = (n - t1 * n.dot(t1)).normalized()
        normals.append(n)
    binormals = [t.cross(n) for t, n in zip(tangents, normals)]
    return tangents, normals, binormals


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------

def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Worm:
    def __init__(self, control, radius=0.2, rings=0.085, clitellum=(0.26, 0.36)):
        raw = catmull_rom([Vector(p) for p in control])
        self.points, self.length = resample(raw, 420)
        self.tangents, self.normals, self.binormals = frames(self.points)
        self.radius = radius
        self.ring_period = rings
        self.clitellum = clitellum  # fraction of length, measured from the head

    def base_radius(self, u):
        """u = 0 at the tail, 1 at the head."""
        tail = 0.28 + 0.72 * smoothstep(0.0, 0.45, u)
        head = 1 + 0.14 * smoothstep(0.72, 0.93, u)
        return self.radius * tail * head

    def band(self, u):
        h = 1 - u
        a, b = self.clitellum
        return smoothstep(a - 0.015, a + 0.01, h) * (1 - smoothstep(b - 0.01, b + 0.015, h))

    def surface_radius(self, u):
        s = u * self.length
        groove = 0.5 - 0.5 * math.cos(2 * math.pi * s / self.ring_period)
        # Rings fade out over the face so the features sit on a clean dome.
        fade = 1 - smoothstep(0.80, 0.88, u)
        fade *= 1 - 0.6 * self.band(u)
        r = self.base_radius(u) * (1 - 0.045 * groove * fade)
        return r * (1 + 0.07 * self.band(u))

    def build(self, name, segments=64, cap_rings=16):
        mesh = bpy.data.meshes.new(name)
        bm = bmesh.new()
        band_layer = bm.verts.layers.float.new('clitellum')
        n = len(self.points)
        ring_list = []

        def ring(center, t, nrm, bin_, r, band_value):
            verts = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                v = bm.verts.new(center + (math.cos(a) * nrm + math.sin(a) * bin_) * r)
                v[band_layer] = band_value
                verts.append(v)
            return verts

        # Tail cap.
        c0, t0, n0, b0 = self.points[0], self.tangents[0], self.normals[0], self.binormals[0]
        r0 = self.surface_radius(0)
        tail_tip = bm.verts.new(c0 - t0 * r0 * 1.4)
        for k in range(1, cap_rings):
            phi = math.pi / 2 * k / cap_rings
            ring_list.append(ring(c0 - t0 * r0 * 1.4 * math.cos(phi), t0, n0, b0, r0 * math.sin(phi), 0))
        for i in range(n):
            u = i / (n - 1)
            ring_list.append(ring(self.points[i], self.tangents[i], self.normals[i], self.binormals[i],
                                  self.surface_radius(u), self.band(u)))
        c1, t1, n1, b1 = self.points[-1], self.tangents[-1], self.normals[-1], self.binormals[-1]
        r1 = self.surface_radius(1)
        for k in range(cap_rings - 1, 0, -1):
            phi = math.pi / 2 * k / cap_rings
            ring_list.append(ring(c1 + t1 * r1 * math.cos(phi), t1, n1, b1, r1 * math.sin(phi), 0))
        head_tip = bm.verts.new(c1 + t1 * r1)

        for a, b in zip(ring_list, ring_list[1:]):
            for k in range(segments):
                bm.faces.new((a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]))
        for k in range(segments):
            bm.faces.new((tail_tip, ring_list[0][(k + 1) % segments], ring_list[0][k]))
            bm.faces.new((head_tip, ring_list[-1][k], ring_list[-1][(k + 1) % segments]))
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        mesh.shade_smooth()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def at(self, u):
        x = max(0.0, min(1.0, u)) * (len(self.points) - 1)
        i = min(int(x), len(self.points) - 2)
        f = x - i
        lerp = lambda seq: seq[i].lerp(seq[i + 1], f)
        t = lerp(self.tangents).normalized()
        return lerp(self.points), t, lerp(self.normals).normalized(), lerp(self.binormals).normalized()

    def surface_point(self, u, direction_angle, toward):
        """Point on the worm's skin at length fraction u, rotated around the
        tangent by direction_angle (radians) from the side facing `toward`."""
        c, t, _, _ = self.at(u)
        f = toward - t * toward.dot(t)
        f.normalize()
        side = t.cross(f)
        d = math.cos(direction_angle) * f + math.sin(direction_angle) * side
        return c + d * self.surface_radius(u), d, t


# --------------------------------------------------------------------------
# Face
# --------------------------------------------------------------------------

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def eye(name, position, outward, up, size):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    side = up.cross(outward).normalized()
    up = outward.cross(side).normalized()
    rot = Matrix((side, up, outward)).transposed().to_4x4()
    # Slightly tall ellipse, pushed half out of the skin.
    scale = Matrix.Diagonal((size, size * 1.12, size * 0.55, 1))
    obj.matrix_world = Matrix.Translation(position + outward * size * 0.12) @ rot @ scale
    return obj


def smile(name, worm, u_center, toward, width_angle, drop, thickness, segments=18, sides=8):
    """A crescent that wraps around the head, thick in the middle and
    tapering to rounded ends, like the smiley's mouth."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for i in range(segments + 1):
        f = i / segments * 2 - 1  # -1..1
        angle = f * width_angle
        u = u_center + drop * (1 - f * f) * -1  # sag down the body in the middle
        p, out, t = worm.surface_point(u, angle, toward)
        nxt, _, _ = worm.surface_point(u_center + drop * (1 - (f + 0.01) ** 2) * -1,
                                       (f + 0.01) * width_angle, toward)
        along = (nxt - p).normalized()
        across = out.cross(along).normalized()
        w = thickness * (0.35 + 0.65 * math.sqrt(max(0.0, 1 - f ** 4)))
        ring_verts = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            v = p + out * (math.sin(a) * w * 0.35 + w * 0.08) + across * math.cos(a) * w
            ring_verts.append(bm.verts.new(v))
        rings.append(ring_verts)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return link(bpy.data.objects.new(name, mesh))


# --------------------------------------------------------------------------
# Materials, lights, scene
# --------------------------------------------------------------------------

def body_material():
    mat = bpy.data.materials.new('Earthworm pink • smooth satin')
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'clitellum'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = srgb('#e2766f')
    mix.inputs['B'].default_value = srgb('#b9474d')
    nt.links.new(attr.outputs['Fac'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.48
    bsdf.inputs['Subsurface Weight'].default_value = 0.12
    bsdf.inputs['Subsurface Radius'].default_value = (0.25, 0.08, 0.06)
    bsdf.inputs['Subsurface Scale'].default_value = 0.05
    bsdf.inputs['Coat Weight'].default_value = 0.08
    bsdf.inputs['Coat Roughness'].default_value = 0.35
    return mat


def face_material():
    mat = bpy.data.materials.new('Face charcoal • faceted satin')
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = srgb('#262626')
    bsdf.inputs['Roughness'].default_value = 0.38
    return mat


def area(name, location, target, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.size = size
    data.color = color
    obj = link(bpy.data.objects.new(name, data))
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    return obj


def setup_scene(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new('Icon dark')
    scene.world = world
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = srgb('#101014')
    bg.inputs['Strength'].default_value = 0.0
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 90
    return scene


def camera(name, location, target, lens=85, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    if ortho_scale:
        data.type = 'ORTHO'
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    obj = link(bpy.data.objects.new(name, data))
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    return obj


def frame_ortho(cam, objects, margin=1.12, offset=(0, 0)):
    """Centre the orthographic camera on the objects and fit them."""
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = []
    for obj in objects:
        for v in obj.data.vertices:
            pts.append(inv @ (obj.matrix_world @ v.co))
    xs = [p.x for p in pts]; ys = [p.y for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cam.data.ortho_scale = max(max(xs) - min(xs), max(ys) - min(ys)) * margin
    cam.location = cam.matrix_world @ Vector((cx + offset[0] * cam.data.ortho_scale,
                                              cy + offset[1] * cam.data.ortho_scale, 0))
    cam.data.clip_end = 100


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, default=2048)
    parser.add_argument('--samples', type=int, default=256)
    parser.add_argument('--output', type=Path, default=HERE / 'renders')
    parser.add_argument('--only', default='')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = setup_scene(args.samples)
    args.output.mkdir(parents=True, exist_ok=True)

    r = 0.2
    # Tail curls along the ground, then the front third rears up to face the camera.
    control = [
        (-1.75, 0.30, r * 0.3),
        (-1.35, 0.42, r * 0.4),
        (-0.95, 0.10, r * 0.6),
        (-0.55, -0.40, r * 0.8),
        (-0.05, -0.45, r * 0.95),
        (0.32, -0.05, r),
        (0.36, 0.22, r * 1.5),
        (0.30, 0.20, 0.60),
        (0.26, 0.14, 0.98),
        (0.28, 0.10, 1.28),
    ]
    worm = Worm(control, radius=r)
    body = worm.build('earthworm')
    body.data.materials.append(body_material())

    toward = Vector((-0.12, -1.0, 0.05)).normalized()
    face_u = 0.955
    charcoal = face_material()
    eye_size = r * 0.27
    parts = []
    for name, angle in (('left eye', -0.5), ('right eye', 0.5)):
        p, out, t = worm.surface_point(face_u, angle, toward)
        e = eye(name, p, out, t, eye_size)
        e.data.materials.append(charcoal)
        parts.append(e)
    mouth = smile('smile', worm, face_u - 0.05, toward, width_angle=0.92, drop=0.024,
                  thickness=r * 0.12)
    mouth.data.materials.append(charcoal)
    parts.append(mouth)

    # Upper-left key, as on the smiley icon, plus gentle fill and a rim to
    # separate the silhouette from the dark background.
    head, _, _, _ = worm.at(0.95)
    area('Key', (-2.6, -3.4, 3.6), head, 620, 3.6, (1.0, 0.98, 0.94))
    area('Fill', (3.2, -2.4, 1.2), (0, 0, 0.5), 90, 3.0, (0.92, 0.95, 1.0))
    area('Rim', (1.5, 3.5, 3.0), head, 220, 2.5)

    # Faint shadow catcher so the worm sits on something in transparent renders.
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'ground'
    ground.is_shadow_catcher = True

    figure = [body] + parts
    hero = camera('Hero camera', (2.2, -6.5, 3.6), (-0.4, 0.0, 0.45), ortho_scale=3)
    frame_ortho(hero, figure, margin=1.14)
    front = camera('Front camera', (0.6, -7.0, 1.2), (-0.4, 0.0, 0.45), ortho_scale=3)
    frame_ortho(front, figure, margin=1.14)
    icon = camera('Icon camera', head + Vector((-0.5, -5.0, 0.6)), head, ortho_scale=1)
    icon.data.ortho_scale = 1.05
    bpy.context.view_layer.update()
    icon.location += icon.matrix_world.to_3x3() @ Vector((0.035, -0.02, 0))
    # Same headshot, zoomed out so the head fits the adaptive icon's safe
    # zone (the inner 66 % of the canvas).
    android = camera('Android camera', (0, 0, 0), (0, 0, -1), ortho_scale=1)
    android.matrix_world = icon.matrix_world.copy()
    android.data.ortho_scale = 1.6
    bpy.context.view_layer.update()
    android.location += android.matrix_world.to_3x3() @ Vector((0, -0.03, 0))
    renders = {
        'earthworm-icon': dict(cam=icon, transparent=False, ground=False),
        'earthworm-icon-body': dict(cam=icon, transparent=True, ground=False, hide=parts),
        'earthworm-icon-face': dict(cam=icon, transparent=True, ground=False, holdout=[body]),
        'earthworm-android-foreground': dict(cam=android, transparent=True, ground=False),
        'earthworm-hero': dict(cam=hero, transparent=True, ground=True),
        'earthworm-hero-dark': dict(cam=hero, transparent=False, ground=False),
        'earthworm-front': dict(cam=front, transparent=True, ground=True),
    }
    only = {s for s in args.only.split(',') if s}
    for filename, cfg in renders.items():
        if only and filename not in only:
            continue
        scene.camera = cfg['cam']
        scene.render.film_transparent = cfg['transparent']
        ground.hide_render = not cfg['ground']
        for obj in figure:
            obj.hide_render = obj in cfg.get('hide', ())
            obj.is_holdout = obj in cfg.get('holdout', ())
        scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = (
            0.0 if cfg['transparent'] else 1.0)
        scene.render.resolution_x = scene.render.resolution_y = args.size
        scene.render.filepath = str((args.output / f'{filename}.png').resolve())
        print(f'Rendering {filename}', flush=True)
        bpy.ops.render.render(write_still=True)

    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'earthworm.blend'))


if __name__ == '__main__':
    main()
