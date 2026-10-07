# Renders the Pulpo smiley from assets/smiley.blend as transparent layers for
# the Apple TV icons:
#
#   blender -b assets/smiley.blend --python apps/tv/scripts/render-smiley.py -- <output-directory>
#
# Writes smiley.png (complete), smiley-noface.png (sphere only), and
# smiley-justface.png (eyes and mouth only), 1600 × 1600 each.
import sys

import bmesh
import bpy

output = sys.argv[sys.argv.index("--") + 1]
scene = bpy.context.scene
scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.cycles.samples = 256
scene.cycles.use_denoising = True

try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"
except Exception as error:  # Fall back to the CPU.
    print("GPU rendering unavailable:", error)

FACE = {"left eye", "right eye", "smile"}

# The eyes' faces don't share vertices and carry custom normals, so they
# render faceted. Weld and smooth every mesh, then subdivide it so low-poly
# outlines stay round at icon sizes. The .blend file itself is not changed.
for item in bpy.data.objects:
    if item.type != "MESH":
        continue
    mesh = item.data
    if "custom_normal" in mesh.attributes:
        mesh.attributes.remove(mesh.attributes["custom_normal"])
    welded = bmesh.new()
    welded.from_mesh(mesh)
    bmesh.ops.remove_doubles(welded, verts=welded.verts, dist=1e-4)
    for edge in welded.edges:
        edge.smooth = True
    for face in welded.faces:
        face.smooth = True
    welded.to_mesh(mesh)
    welded.free()
    subdivision = item.modifiers.new("Render smoothing", "SUBSURF")
    subdivision.levels = 0
    subdivision.render_levels = 2


def render(name, hidden):
    for item in bpy.data.objects:
        if item.type == "MESH":
            item.hide_render = item.name in hidden
    scene.render.filepath = f"{output}/{name}.png"
    bpy.ops.render.render(write_still=True)


render("smiley", set())
render("smiley-noface", FACE)
render("smiley-justface", {"yellow"})
