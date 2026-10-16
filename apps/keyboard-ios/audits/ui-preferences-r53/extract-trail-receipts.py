"""Functional frame alignment only; no latency or performance oracle.

Read the full recording and each of the six native glide attachments. Inspect a
fixed window surrounding every attachment; retain one strongest blue-path frame
per flow, including flows with zero blue pixels. Outputs are visual witnesses,
not an accuracy benchmark or a replacement for native settings/text assertions.
"""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

video, manifest, output = map(Path, sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
metadata = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries', 'format_tags=creation_time',
    '-of', 'json', str(video)]))
begin = datetime.datetime.fromisoformat(metadata['format']['tags']['creation_time'].replace('Z', '+00:00')).timestamp()
attachments = sorted([x for t in json.loads(manifest.read_text()) for x in t['attachments']
                      if x['suggestedHumanReadableName'].startswith('r53-installed-glide')], key=lambda x: x['timestamp'])
assert len(attachments) == 6, len(attachments)
rows = []
for index, item in enumerate(attachments):
    start = max(0, item['timestamp'] - begin - 4)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(start), '-i', str(video),
        '-t', '4.5', '-vf', 'fps=12,scale=471:1024',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    size = 471 * 1024 * 3
    counts = []
    selected = None
    maximum = -1
    while True:
        data = p.stdout.read(size)
        if len(data) != size:
            break
        # Require stable, unshifted Q/W/E caps; exclude app-navigation frames.
        glyphs = b''.join(data[(y * 471 + x) * 3:(y * 471 + x + 18) * 3]
                          for y in range(708, 735) for x in [18, 65, 112])
        black = sum(r < 90 and g < 90 and b < 90
                    for r, g, b in zip(glyphs[::3], glyphs[1::3], glyphs[2::3]))
        crop = data[700 * 471 * 3:900 * 471 * 3]
        count = sum(b > r + 70 and b > g + 30 and r < 150
                    for r, g, b in zip(crop[::3], crop[1::3], crop[2::3])) if black >= 45 else -1
        counts.append(count)
        if count > maximum:
            maximum = count
            selected = data
    assert p.wait() == 0 and counts
    chosen = max(range(len(counts)), key=counts.__getitem__)
    image = output / f'flow-{index + 1}.png'
    assert selected is not None, 'Stable native keyboard frame must be available'
    # Encode the exact inspected raw frame, avoiding a second variable-frame seek.
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                    '-s', '471x1024', '-i', '-', '-frames:v', '1', '-y', str(image)],
                   input=selected, check=True)
    rows.append({'flow': index + 1, 'attachment': item, 'frame': str(image),
                 'frameSHA256': hashlib.sha256(image.read_bytes()).hexdigest(),
                 'sampledFrames': len(counts), 'strongestBluePixelCount': max(counts),
                 'allBluePixelCounts': counts})
(output / 'receipts.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps([{k: x[k] for k in ['flow', 'sampledFrames', 'strongestBluePixelCount', 'frame']} for x in rows]))
