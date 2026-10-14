"""Prepare spatial baseline paths or preserve recorded human samples and timing.

The default keeps the existing RDP/0.6-key-pitch geometry and 20 ms replay.
Its optional timestamps are interpolated alongside the selected spatial samples
so they cannot silently refer to different points. ``--timing recorded`` retains
every original point/time pair for replay at the original relative timestamps.
"""
import argparse
import json
import math
from pathlib import Path


def simplify_indices(points, tolerance=0.04):
  if len(points) <= 2:
    return list(range(len(points)))
  a, b = points[0], points[-1]
  dx, dy = b[0] - a[0], b[1] - a[1]
  denominator = dx * dx + dy * dy

  def distance(point):
    ratio = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator)) if denominator else 0
    return math.hypot(point[0] - a[0] - ratio * dx, point[1] - a[1] - ratio * dy)

  maximum, index = max((distance(points[i]), i) for i in range(1, len(points) - 1))
  if maximum <= tolerance:
    return [0, len(points) - 1]
  return (simplify_indices(points[:index + 1], tolerance)[:-1]
          + [index + i for i in simplify_indices(points[index:], tolerance)])


def simplify(points, tolerance=0.04):
  return [points[i] for i in simplify_indices(points, tolerance)]


def prepare_with_times(points, times=None):
  corners = simplify_indices(points)
  result = [points[corners[0]]]
  result_times = [times[corners[0]]] if times is not None else None
  for start, end in zip(corners, corners[1:]):
    a, b = points[start], points[end]
    steps = max(1, math.ceil(math.dist(a, b) / 0.6))
    for i in range(1, steps + 1):
      ratio = i / steps
      result.append([a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps])
      if result_times is not None:
        result_times.append(times[start] + (times[end] - times[start]) * ratio)
  return result, result_times


def prepare(points):
  return prepare_with_times(points)[0]


def validate(points, times, require_times=False):
  if len(points) < 2:
    raise ValueError('A gesture needs at least two samples')
  if any(len(p) != 2 or any(not math.isfinite(v) for v in p) for p in points):
    raise ValueError('Gesture points must be finite coordinate pairs')
  if times is None:
    if require_times:
      raise ValueError('Recorded replay requires a timestamp for every point')
    return
  if len(times) != len(points):
    raise ValueError('Gesture points and times must have identical lengths')
  if any(not math.isfinite(t) for t in times):
    raise ValueError('Gesture timestamps must be finite seconds')
  if any(b < a for a, b in zip(times, times[1:])):
    raise ValueError('Gesture timestamps must be nondecreasing')


def prepare_item(item, timing='uniform20ms'):
  result = dict(item)
  points, times = item['points'], item.get('times')
  validate(points, times, require_times=timing == 'recorded')
  if timing == 'recorded':
    # Keep raw samples, including stationary samples and irregular time gaps.
    result['points'] = [list(p) for p in points]
    result['times'] = list(times)
  else:
    result['points'], aligned_times = prepare_with_times(points, times)
    if aligned_times is not None:
      result['times'] = aligned_times
  result['replayTiming'] = timing
  result['sourcePointCount'] = len(points)
  return result


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('input', type=Path)
  parser.add_argument('output', type=Path)
  parser.add_argument('--timing', choices=('uniform20ms', 'recorded'), default='uniform20ms')
  args = parser.parse_args()
  items = json.loads(args.input.read_text())
  args.output.write_text(json.dumps([prepare_item(item, args.timing) for item in items]))
