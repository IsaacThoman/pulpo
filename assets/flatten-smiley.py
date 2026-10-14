"""Flatten the icon's depth while retaining its original front-view shading.

From the repository root:
    blender --background assets/smiley.blend --python-exit-code 1 \
        --python assets/flatten-smiley.py -- --depth-scale 0.1

Original positions and appearance normals remain in mesh attributes, so rerunning
with a different depth scale does not compound the flattening.
"""

import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector


POSITION_ATTRIBUTE = 'pulpo_original_position'
NORMAL_ATTRIBUTE = 'pulpo_original_normal'
ATTRIBUTE_NODE = 'Pulpo original appearance normal'
NORMALIZE_NODE = 'Pulpo normalize appearance normal'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--depth-scale', type=float, default=0.1)
    parser.add_argument('--output', type=Path, default=Path(bpy.data.filepath))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not 0 < args.depth_scale <= 1:
        parser.error('--depth-scale must be greater than zero and at most one')

    scene = bpy.context.scene
    if scene.camera is None or scene.camera.data.type != 'ORTHO':
        parser.error('preserving the front silhouette requires the source orthographic camera')
    axis = (scene.camera.matrix_world.to_quaternion() @ Vector((0, 0, 1))).normalized()
    materials = set()

    for name in ('yellow', 'left eye', 'right eye', 'smile'):
        obj = scene.objects[name]
        mesh = obj.data
        positions = mesh.attributes.get(POSITION_ATTRIBUTE)
        normals = mesh.attributes.get(NORMAL_ATTRIBUTE)
        if positions is None:
            source_positions = [vertex.co.copy() for vertex in mesh.vertices]
            normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
            source_normals = [(normal_matrix @ normal.vector).normalized()
                              for normal in mesh.corner_normals]
            positions = mesh.attributes.new(POSITION_ATTRIBUTE, 'FLOAT_VECTOR', 'POINT')
            positions.data.foreach_set('vector', [value for co in source_positions for value in co])
            normals = mesh.attributes.new(NORMAL_ATTRIBUTE, 'FLOAT_VECTOR', 'CORNER')
            normals.data.foreach_set('vector', [value for normal in source_normals for value in normal])
        elif normals is None:
            parser.error(f'{name} has original positions but no original appearance normals')

        # Move only along the camera axis. The orthographic X/Z projection and
        # front-to-back ordering of the body, eyes and smile remain unchanged.
        inverse = obj.matrix_world.inverted()
        for vertex, position in zip(mesh.vertices, positions.data):
            world = obj.matrix_world @ position.vector
            world -= axis * (world.dot(axis) * (1 - args.depth_scale))
            vertex.co = inverse @ world
        mesh.update()
        obj['pulpo_depth_scale'] = args.depth_scale
        materials.update(mesh.materials)

    # These emission materials encode the artwork as a function of the original
    # normals. Normalize their interpolated values just like Geometry > Normal,
    # while leaving the actual flattened surface normals geometrically correct.
    for material in materials:
        tree = material.node_tree
        attribute = tree.nodes.get(ATTRIBUTE_NODE)
        if attribute is None:
            destinations = [link.to_socket for link in tree.links
                            if link.from_node.type == 'NEW_GEOMETRY'
                            and link.from_socket.name == 'Normal']
            if not destinations:
                parser.error(f'{material.name} has no source normal shading to preserve')
            attribute = tree.nodes.new('ShaderNodeAttribute')
            attribute.name = ATTRIBUTE_NODE
            attribute.label = 'Original front-view shading'
            attribute.attribute_name = NORMAL_ATTRIBUTE
            attribute.location = (-1100, 300)
            normalize = tree.nodes.new('ShaderNodeVectorMath')
            normalize.name = NORMALIZE_NODE
            normalize.label = 'Normalize original appearance normal'
            normalize.operation = 'NORMALIZE'
            normalize.location = (-900, 300)
            tree.links.new(attribute.outputs['Vector'], normalize.inputs[0])
            for socket in destinations:
                tree.links.new(normalize.outputs['Vector'], socket)

    notes = bpy.data.texts.get('Pulpo flattened icon') or bpy.data.texts.new('Pulpo flattened icon')
    notes.clear()
    notes.write(
        f'The icon has {args.depth_scale:.0%} of its original depth.\n'
        'The camera, front silhouette, face placement and emission artwork are preserved.\n'
        f'{POSITION_ATTRIBUTE}: original mesh positions, for reversible depth changes.\n'
        f'{NORMAL_ATTRIBUTE}: original world-space corner normals, for appearance only.\n'
        'Run assets/flatten-smiley.py with --depth-scale to change the thickness; 1 restores it.\n'
        'Use assets/render-smiley.py to render the aligned full/body/face layers.\n'
    )
    bpy.context.view_layer.update()
    # Keep automatic Blender backup files out of the source assets.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))


if __name__ == '__main__':
    main()
