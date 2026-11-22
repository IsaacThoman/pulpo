"""Copy the rendered earthworm headshot into the app icon files.

Needs macOS (sips, iconutil). Run build-earthworm.py with the --only list in
its docstring first, then from the repository root:
    python3 assets/earthworm/install-app-icon.py
"""

from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RENDERS = HERE / 'renders'
MOBILE = ROOT / 'apps' / 'mobile' / 'assets'
DESKTOP = ROOT / 'apps' / 'desktop' / 'assets'


SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'


def tag_srgb(path):
    """Blender writes untagged PNGs; tag them sRGB like the smiley layers."""
    subprocess.run(['sips', '--embedProfile', SRGB, str(path)], check=True, capture_output=True)


def resize(source, size, destination):
    subprocess.run(['sips', '-z', str(size), str(size), str(source), '--out', str(destination)],
                   check=True, capture_output=True)
    tag_srgb(destination)


def write_ico(source, destination, sizes=(256, 128, 64, 48, 32, 24, 16)):
    """Windows icon with a PNG image per size."""
    with tempfile.TemporaryDirectory() as tmp:
        images = []
        for size in sizes:
            png = Path(tmp) / f'{size}.png'
            resize(source, size, png)
            images.append((size, png.read_bytes()))
    offset = 6 + 16 * len(images)
    header = struct.pack('<HHH', 0, 1, len(images))
    entries, data = b'', b''
    for size, png in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset + len(data))
        data += png
    destination.write_bytes(header + entries + data)


def write_icns(source, destination):
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / 'Pulpo.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            resize(source, size, iconset / f'icon_{size}x{size}.png')
            resize(source, size * 2, iconset / f'icon_{size}x{size}@2x.png')
        subprocess.run(['iconutil', '-c', 'icns', '-o', str(destination), str(iconset)], check=True)


def main():
    # Icon Composer layers (iOS, and the macOS desktop app).
    layers = MOBILE / 'Pulpo.icon' / 'Assets'
    layers.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(RENDERS / 'earthworm-icon-body.png', layers / 'earthworm-body.png')
    shutil.copyfile(RENDERS / 'earthworm-icon-face.png', layers / 'earthworm-face.png')
    for layer in ('earthworm-body.png', 'earthworm-face.png'):
        tag_srgb(layers / layer)

    flat = RENDERS / 'earthworm-icon.png'
    # Android legacy icon, docs apple-touch-icon/og:image, desktop DMG check.
    resize(flat, 1024, MOBILE / 'pulpo-app-icon.png')
    resize(RENDERS / 'earthworm-android-foreground.png', 1024, MOBILE / 'earthworm-android-foreground.png')
    write_icns(flat, DESKTOP / 'Pulpo.icns')
    write_ico(flat, DESKTOP / 'Pulpo.ico')


if __name__ == '__main__':
    main()
