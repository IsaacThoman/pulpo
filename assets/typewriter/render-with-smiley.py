"""Render the Pulpo smiley beside the typewriter as a transparent PNG.

The smiley sits on the left, turned toward the camera and slightly right; the
typewriter sits in front of it on the right, seen from its back corner, and
overlaps the smiley's lower right.

From the repository root, after build-typewriter.py has written typewriter.blend:
    blender --background assets/typewriter/typewriter.blend --python-exit-code 1 \
        --python assets/typewriter/render-with-smiley.py -- --size 2048
"""

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
SMILEY_BLEND = HERE.parent / 'smiley.blend'
SMILEY_PARTS = ('yellow', 'left eye', 'right eye', 'smile')
# The camera frames the scene around a smiley of this diameter (metres).
LAYOUT_SMILEY_SIZE = 0.4


def append_smiley(diameter):
    """Append the flattened Pulpo icon as-is, scaled to `diameter`.

    Its emission artwork is shaded from stored appearance normals, so the
    icon keeps its front-view look as it turns.
    """
    with bpy.data.libraries.load(str(SMILEY_BLEND), link=False) as (_, data_to):
        data_to.objects = list(SMILEY_PARTS)
    collection = bpy.data.collections.new('Smiley')
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new('Smiley', None)
    collection.objects.link(root)
    for obj in data_to.objects:
        collection.objects.link(obj)
        obj.parent = root
        # Emission materials do not need to block the typewriter's lights.
        obj.visible_shadow = False

    corners = [obj.matrix_world @ Vector(c) for obj in data_to.objects for c in obj.bound_box]
    size = max(max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3))
    center = sum(corners, Vector()) / len(corners)
    for obj in data_to.objects:
        obj.location -= center
    root.scale = (diameter / size,) * 3
    return root, list(data_to.objects)


def frame_camera(camera, objects, elevation, margin):
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    coords = [obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    tilt = math.radians(90 - elevation)
    camera.rotation_euler = (tilt, 0, 0)
    bpy.context.view_layer.update()
    flat = [value for co in coords for value in co]
    location, _ = camera.camera_fit_coords(depsgraph, flat)
    forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    center = sum(coords, Vector()) / len(coords)
    distance = (center - Vector(location)).dot(forward)
    camera.location = Vector(location) - forward * distance * margin
    scene.camera = camera


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, default=2048)
    parser.add_argument('--samples', type=int, default=256)
    parser.add_argument('--turn', type=float, default=25, help='degrees the smiley turns toward the typewriter')
    parser.add_argument('--typewriter-yaw', type=float, default=-145,
                        help='typewriter heading in degrees; 0 faces the camera')
    parser.add_argument('--smiley-size', type=float, default=0.48,
                        help='smiley diameter in metres; scales in place without reframing')
    parser.add_argument('--output', type=Path, default=HERE / 'pulpo-typewriter.png')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    scene = bpy.context.scene
    typewriter = scene.objects['Typewriter']
    typewriter_parts = list(typewriter.children)
    scene.objects['Ground'].hide_render = True

    smiley, smiley_parts = append_smiley(diameter=LAYOUT_SMILEY_SIZE)
    smiley.location = (-0.16, 0.08, LAYOUT_SMILEY_SIZE / 2)
    smiley.rotation_euler = (0, 0, math.radians(args.turn))
    typewriter.location = (0.08, -0.12, 0)
    typewriter.rotation_euler = (0, 0, math.radians(args.typewriter_yaw))
    bpy.context.view_layer.update()

    camera = scene.objects['Camera']
    camera.data.lens = 70
    frame_camera(camera, typewriter_parts + smiley_parts, elevation=18, margin=0.04)
    smiley.scale *= args.smiley_size / LAYOUT_SMILEY_SIZE
    # Nudge the typewriter left and down in the camera's view without reframing.
    typewriter.location += camera.matrix_world.to_3x3() @ Vector((-0.02, -0.015, 0))

    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 100
    scene.cycles.samples = args.samples
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = 'GPU'
    except Exception as error:  # Fall back to CPU rendering.
        print(f'GPU unavailable: {error}', flush=True)
    # The smiley's emission artwork was authored for the Standard transform.
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.filepath = str(args.output.resolve())
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
