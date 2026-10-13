"""Keep swipe corners and sample their segments at most 0.6 key pitches apart.

Both decoders receive the resulting spatial path. Android's input dispatcher
otherwise drops corner events when dense synthetic paths are injected too fast.
"""
import json
import math
import sys
from pathlib import Path


def simplify(points, tolerance=0.04):
  if len(points) <= 2:
    return points
  a, b = points[0], points[-1]
  dx, dy = b[0] - a[0], b[1] - a[1]
  denominator = dx * dx + dy * dy

  def distance(point):
    ratio = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator)) if denominator else 0
    return math.hypot(point[0] - a[0] - ratio * dx, point[1] - a[1] - ratio * dy)

  maximum, index = max((distance(points[i]), i) for i in range(1, len(points) - 1))
  if maximum <= tolerance:
    return [a, b]
  return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def prepare(points):
  corners = simplify(points)
  result = [corners[0]]
  for a, b in zip(corners, corners[1:]):
    steps = max(1, math.ceil(math.dist(a, b) / 0.6))
    for i in range(1, steps + 1):
      result.append([a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps])
  return result


if __name__ == '__main__':
  items = json.loads(Path(sys.argv[1]).read_text())
  for item in items:
    item['points'] = prepare(item['points'])
  Path(sys.argv[2]).write_text(json.dumps(items))
