"""Trace the smiley's face into the path drawn by Pulpo Keyboard's emoji key.

From the repository root, with Pillow and potrace installed:
    python3 assets/trace-smiley-face.py

Thresholds assets/highres/pulpo-smiley-justface.png to one color, traces it with
potrace, and prints the Swift path for PulpoFaceSymbol.path() in units of the head's
radius about its center, taken from assets/highres/pulpo-smiley.png.
"""

import argparse
from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image


HIGHRES = Path(__file__).resolve().parent / 'highres'


def opaque_bounds(image):
    return image.getchannel('A').point(lambda alpha: 255 if alpha > 128 else 0).getbbox()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--size', type=int, default=256, help='Trace resolution; lower smooths the low-poly edges')
    args = parser.parse_args()

    face = Image.open(HIGHRES / 'pulpo-smiley-justface.png').convert('RGBA')
    left, top, right, bottom = opaque_bounds(Image.open(HIGHRES / 'pulpo-smiley.png').convert('RGBA'))
    scale = args.size / face.width
    center_x, center_y = (left + right) / 2 * scale, (top + bottom) / 2 * scale
    radius = (right - left) / 2 * scale

    mask = face.resize((args.size, args.size), Image.LANCZOS).getchannel('A').point(lambda alpha: 0 if alpha > 128 else 255)
    with tempfile.TemporaryDirectory() as directory:
        bitmap, svg = Path(directory) / 'face.pbm', Path(directory) / 'face.svg'
        mask.convert('1').save(bitmap)
        subprocess.run(['potrace', str(bitmap), '--svg', '--flat', '--unit', '10', '--turdsize', '2',
                        '--alphamax', '1.2', '--opttolerance', '1', '--output', str(svg)], check=True)
        data = re.search(r'<path d="([^"]+)"', svg.read_text()).group(1)

    # potrace writes relative commands in tenths of a pixel with y up.
    def point(x, y):
        return (x / 10 - center_x) / radius, (args.size - y / 10 - center_y) / radius

    def number(value):
        return f'{value:.3f}'.rstrip('0').rstrip('.') if abs(value) >= 0.0005 else '0'

    tokens = re.findall(r'[MmCcLlZz]|-?\d+(?:\.\d+)?', data)
    index, command, x, y = 0, None, 0.0, 0.0
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        if command in 'Zz':
            print('path.close()')
            command = None
        elif command == 'M':
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            print('move({}, {})'.format(*map(number, point(x, y))))
        elif command == 'c':
            dx1, dy1, dx2, dy2, dx, dy = map(float, tokens[index:index + 6])
            index += 6
            control1, control2 = point(x + dx1, y + dy1), point(x + dx2, y + dy2)
            x, y = x + dx, y + dy
            print('curve({}, {}, {}, {}, {}, {})'.format(*map(number, (*point(x, y), *control1, *control2))))
        else:
            raise SystemExit(f'unexpected potrace command {command!r}; trace with --flat and no straight segments')


if __name__ == '__main__':
    main()
