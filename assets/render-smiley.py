"""Render the source smiley and its aligned body/face layers with Blender.

From the repository root:
    blender --background assets/smiley.blend --python-exit-code 1 \
        --python assets/render-smiley.py -- --size 8192
"""

import argparse
from pathlib import Path
import sys

import bpy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, default=8192)
    parser.add_argument('--samples', type=int, default=256)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'highres')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.size < 1 or args.samples < 1:
        parser.error('--size and --samples must be positive')

    scene = bpy.context.scene
    body = scene.objects['yellow']
    face = [scene.objects[name] for name in ('left eye', 'right eye', 'smile')]
    args.output.mkdir(parents=True, exist_ok=True)

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = args.samples
    scene.cycles.seed = 0
    # The source uses emission shaders for its sculpted shading. Denoising can
    # soften their facet edges, so preserve the rendered pixels directly.
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.001
    scene.cycles.adaptive_min_samples = 16
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1
    scene.render.pixel_aspect_y = 1
    scene.render.use_border = False
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 100

    for filename, show_body, show_face in (
        ('pulpo-smiley', True, True),
        ('pulpo-smiley-noface', True, False),
        ('pulpo-smiley-justface', False, True),
    ):
        body.hide_render = not show_body
        for obj in face:
            obj.hide_render = not show_face
        scene.render.filepath = str(args.output.resolve() / f'{filename}.png')
        print(f'Rendering {filename} at {args.size} × {args.size}', flush=True)
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
