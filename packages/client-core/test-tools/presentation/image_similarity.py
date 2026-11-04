#!/usr/bin/env python3
"""Similarity of two slide renderings, for the visual fidelity check.

    image_similarity.py <ours.png> <reference.png> [--diff out.png]

Both images are scaled to 320 px wide, converted to grayscale, and compared two ways:
- `similarity`: 1 - mean absolute pixel difference / 255 (1.0 = identical).
- `structure`: the same on 8×8 block means, which forgives anti-aliasing and font hinting but
  not misplaced shapes or missing content.
Prints one JSON object. Run with `python -I`.
"""
import json
import sys

from PIL import Image, ImageChops


def load(path, size):
    image = Image.open(path).convert("RGB")
    background = Image.new("RGB", image.size, (255, 255, 255))
    background.paste(image)
    return background.convert("L").resize(size, Image.LANCZOS)


def mean_difference(a, b):
    diff = ImageChops.difference(a, b)
    histogram = diff.histogram()
    total = sum(index * count for index, count in enumerate(histogram))
    return total / (a.size[0] * a.size[1]) / 255, diff


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    reference = Image.open(argv[2])
    width = 320
    height = max(1, round(reference.height * width / reference.width))
    ours = load(argv[1], (width, height))
    theirs = load(argv[2], (width, height))
    pixel, diff = mean_difference(ours, theirs)
    blocks = (width // 8, height // 8)
    block, _ = mean_difference(ours.resize(blocks, Image.BOX), theirs.resize(blocks, Image.BOX))
    if "--diff" in argv:
        diff.point(lambda value: min(255, value * 3)).save(argv[argv.index("--diff") + 1])
    print(json.dumps({"similarity": round(1 - pixel, 4), "structure": round(1 - block, 4)}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
