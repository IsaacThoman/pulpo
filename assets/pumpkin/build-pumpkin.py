"""Build the Pulpo pumpkin: the smiley's face on a low-poly jack-o'-lantern.

Replaces the yellow head in assets/smiley.blend with a ribbed pumpkin and stem,
flattened to the face's depth like assets/flatten-smiley.py does, and saves
assets/pumpkin/pumpkin.blend. The camera, lights and face are untouched.

From the repository root:
    blender --background assets/smiley.blend --python-exit-code 1 \
        --python assets/pumpkin/build-pumpkin.py

Then render the aligned full/body/face layers:
    blender --background assets/pumpkin/pumpkin.blend --python-exit-code 1 \
        --python assets/render-smiley.py -- --name pulpo-pumpkin \
        --output assets/pumpkin/highres --size 8192
"""

import argparse
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
FACE = ('left eye', 'right eye', 'smile')
POSITION_ATTRIBUTE = 'pulpo_original_position'
NORMAL_ATTRIBUTE = 'pulpo_original_normal'

RIBS = 8
RIB_SEGMENTS = 4
RINGS = 12
# Body size in the smiley's units; the face spans x -1.3..1.23, z -1.7..0.93.
BODY_RADIUS = 2.1
BODY_BOTTOM = -2.0
BODY_TOP = 1.5
RIB_DEPTH = 0.2
DIMPLE_DEPTH = 0.35
# Degrees the top leans toward the camera, so the stem's hollow shows.
TILT = 12


def body_point(theta, phi):
    """Pumpkin surface at azimuth `theta` from the front and polar `phi` from the top."""
    # Grooves at theta = 0 (between the eyes) and every 1/RIBS turn, so each
    # eye sits on its own lobe.
    u = (theta * RIBS / (2 * math.pi)) % 1
    lobe = math.sin(math.pi * u) ** 0.6
    # Ribs converge into the stem and base dimples.
    rib = 1 - RIB_DEPTH * (1 - lobe) * math.sin(phi) ** 0.5
    radius = BODY_RADIUS * rib * math.sin(phi)
    z = (BODY_TOP + BODY_BOTTOM) / 2 + (BODY_TOP - BODY_BOTTOM) / 2 * math.cos(phi)
    # Pull the poles in so the stem sits in a hollow.
    z -= DIMPLE_DEPTH * math.exp(-(phi / 0.3) ** 2)
    z += DIMPLE_DEPTH * 0.5 * math.exp(-((math.pi - phi) / 0.3) ** 2)
    return Vector((radius * math.sin(theta), -radius * math.cos(theta), z))


def build_body(flat):
    mesh = bpy.data.meshes.new('pumpkin')
    bm = bmesh.new()
    around = RIBS * RIB_SEGMENTS
    rings = []
    for k in range(1, RINGS):
        phi = math.pi * k / RINGS
        rings.append([bm.verts.new(body_point(2 * math.pi * i / around, phi)) for i in range(around)])
    top = bm.verts.new(body_point(0, 0))
    bottom = bm.verts.new(body_point(0, math.pi))
    grooves = {top, bottom} | {ring[i] for ring in rings for i in range(0, around, RIB_SEGMENTS)}
    for i in range(around):
        j = (i + 1) % around
        bm.faces.new((top, rings[0][j], rings[0][i]))
        for upper, lower in zip(rings, rings[1:]):
            bm.faces.new((upper[i], upper[j], lower[j], lower[i]))
        bm.faces.new((bottom, rings[-1][i], rings[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in bm.faces:
        face.smooth = not flat
    # Crease the grooves so each lobe shades separately.
    for edge in bm.edges:
        edge.smooth = not all(v in grooves for v in edge.verts)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def build_stem():
    mesh = bpy.data.meshes.new('stem')
    bm = bmesh.new()
    sides = 6
    base = BODY_TOP - DIMPLE_DEPTH
    # (height above the hollow, radius, lean right, twist) up to the cut tip.
    profile = ((-0.25, 0.4, 0, 0), (0.15, 0.3, 0.02, 6), (0.45, 0.25, 0.08, 12), (0.68, 0.24, 0.18, 18))
    rings = []
    for height, radius, lean, twist in profile:
        angles = (2 * math.pi * (i + 0.5) / sides + math.radians(twist) for i in range(sides))
        rings.append([bm.verts.new((lean + radius * math.sin(a), -radius * math.cos(a), base + height))
                      for a in angles])
    for lower, upper in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bm.faces.new(rings[-1])
    bm.faces.new(list(reversed(rings[0])))
    for face in bm.faces:
        face.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def tinted_material(template, name, hue, saturation, value):
    """Recolor the yellow head's emission shading, keeping its lighting."""
    material = template.copy()
    material.name = name
    tree = material.node_tree
    combine = next(node for node in tree.nodes if node.type == 'COMBXYZ')
    emission = next(node for node in tree.nodes if node.type == 'EMISSION')
    tint = tree.nodes.new('ShaderNodeHueSaturation')
    tint.label = 'Recolor the yellow satin shading'
    tint.location = (emission.location.x - 200, emission.location.y)
    tint.inputs['Hue'].default_value = hue
    tint.inputs['Saturation'].default_value = saturation
    tint.inputs['Value'].default_value = value
    tree.links.new(combine.outputs['Vector'], tint.inputs['Color'])
    tree.links.new(tint.outputs['Color'], emission.inputs['Color'])
    return material


def flatten(obj, axis, depth_scale):
    """Keep full-depth positions and normals, then squash along the camera axis."""
    mesh = obj.data
    normals = mesh.attributes.new(NORMAL_ATTRIBUTE, 'FLOAT_VECTOR', 'CORNER')
    normals.data.foreach_set('vector', [value for normal in mesh.corner_normals for value in normal.vector])
    positions = mesh.attributes.new(POSITION_ATTRIBUTE, 'FLOAT_VECTOR', 'POINT')
    positions.data.foreach_set('vector', [value for vertex in mesh.vertices for value in vertex.co])
    for vertex in mesh.vertices:
        vertex.co -= axis * (vertex.co.dot(axis) * (1 - depth_scale))
    mesh.update()
    obj['pulpo_depth_scale'] = depth_scale


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--flat', action='store_true', help='shade every facet flat, like the eyes')
    parser.add_argument('--output', type=Path, default=HERE / 'pumpkin.blend')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    scene = bpy.context.scene
    yellow = scene.objects['yellow']
    template = yellow.data.materials[0]
    bpy.data.objects.remove(yellow)
    face = [scene.objects[name] for name in FACE]
    depth_scale = face[0]['pulpo_depth_scale']
    axis = (scene.camera.matrix_world.to_quaternion() @ Vector((0, 0, 1))).normalized()
    center = Vector((0, 0, (BODY_TOP + BODY_BOTTOM) / 2))
    tilt = Matrix.Translation(center) @ Matrix.Rotation(math.radians(TILT), 4, 'X') @ Matrix.Translation(-center)

    finish = 'flat facets' if args.flat else 'smooth satin'
    orange = tinted_material(template, f'Pumpkin orange • {finish}', hue=0.39, saturation=1.1, value=1.0)
    green = tinted_material(template, 'Stem green • flat facets', hue=0.62, saturation=0.8, value=0.4)
    parts = []
    for mesh, material in ((build_body(args.flat), orange), (build_stem(), green)):
        mesh.transform(tilt)
        mesh.materials.append(material)
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
        flatten(obj, axis, depth_scale)
        parts.append(obj)

    # Sit the whole pumpkin just behind the face so no facet pokes through it.
    face_back = min((obj.matrix_world @ v.co).dot(axis) for obj in face for v in obj.data.vertices)
    pumpkin_front = max(v.co.dot(axis) for obj in parts for v in obj.data.vertices)
    for obj in parts:
        obj.location = axis * (face_back - pumpkin_front - 0.002)

    notes = bpy.data.texts.get('Pulpo flattened icon') or bpy.data.texts.new('Pulpo flattened icon')
    notes.clear()
    notes.write(
        'The yellow head is replaced by the low-poly pumpkin and stem from\n'
        f'assets/pumpkin/build-pumpkin.py, flattened to {depth_scale:.0%} depth like the face\n'
        'and moved just behind it.\n'
        f'{POSITION_ATTRIBUTE}: full-depth mesh positions.\n'
        f'{NORMAL_ATTRIBUTE}: full-depth corner normals, which drive the emission shading.\n'
        'Render the layers with assets/render-smiley.py -- --name pulpo-pumpkin.\n'
    )
    bpy.context.view_layer.update()
    # Keep automatic Blender backup files out of the source assets.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))


if __name__ == '__main__':
    main()
