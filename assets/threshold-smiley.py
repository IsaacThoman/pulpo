"""Render the flat, thresholded smiley used inside Pulpo Keyboard's app.

The body becomes a perfect circle in the logo's yellow, and the face is the
rendered face layer thresholded to a single dark tone. Edges are only
antialiased by the final downscale.

From the repository root (requires Pillow and NumPy):
    python3 assets/threshold-smiley.py
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
YELLOW = (196, 192, 52)
FACE = (38, 38, 38)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'assets/highres')
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'apps/keyboard-ios/App/Assets.xcassets/PulpoSmiley.imageset')
    parser.add_argument('--points', type=int, default=64)
    parser.add_argument('--work-size', type=int, default=2048)
    args = parser.parse_args()

    Image.MAX_IMAGE_PIXELS = None
    body = alpha(args.source / 'pulpo-smiley-noface.png', args.work_size)
    face = alpha(args.source / 'pulpo-smiley-justface.png', args.work_size)

    # Fit the circle by area and centroid so the face stays where the logo has it.
    ys, xs = np.nonzero(body > 0.5)
    cx, cy = xs.mean() + 0.5, ys.mean() + 0.5
    radius = np.sqrt(len(xs) / np.pi)

    side = int(np.ceil(radius * 2))
    left, top = round(cx - side / 2), round(cy - side / 2)
    face = face[top:top + side, left:left + side] > 0.5
    yy, xx = np.mgrid[0:side, 0:side] + 0.5
    circle = (xx - (cx - left)) ** 2 + (yy - (cy - top)) ** 2 <= radius ** 2

    pixels = np.zeros((side, side, 4), dtype=np.uint8)
    pixels[circle] = (*YELLOW, 255)
    pixels[face & circle] = (*FACE, 255)
    image = Image.fromarray(pixels)

    for scale in (2, 3):
        size = args.points * scale
        image.resize((size, size), Image.LANCZOS).save(args.output / f'pulpo-smiley@{scale}x.png', optimize=True)


def alpha(path, size):
    image = Image.open(path).convert('RGBA')
    return np.asarray(image.resize((size, size), Image.BOX).getchannel('A'), dtype=np.float32) / 255


if __name__ == '__main__':
    main()
