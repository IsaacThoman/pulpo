"""Verify badge toggles preserve Android layout on an already-open empty chat.

Requires adb, an authenticated app with a model selected, and automatic expiration
configured in settings. Start with the keyboard closed and both chat toggles off.
Only changes unsent draft flags; does not submit or delete conversations.
"""
import argparse
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--adb', default='adb')
parser.add_argument('--device', default='emulator-5554')
parser.add_argument('--model', required=True, help='Visible model name')
parser.add_argument('--output', type=Path, help='Optional bounds evidence JSON')
args = parser.parse_args()


def adb(*command):
    return subprocess.check_output([args.adb, '-s', args.device, *command])


def state():
    adb('shell', 'uiautomator', 'dump', '/sdcard/pulpo-layout-check.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/pulpo-layout-check.xml'))


def matches(tree, label):
    return [node for node in tree.iter('node') if label in (node.get('text'), node.get('content-desc'))]


def tap(tree, label):
    found = matches(tree, label)
    if not found:
        raise RuntimeError(f'Expected {label!r}; open a fresh empty chat with both toggles off.')
    x, y, right, bottom = map(int, re.findall(r'\d+', found[0].get('bounds')))
    adb('shell', 'input', 'tap', str((x + right) // 2), str((y + bottom) // 2))
    time.sleep(0.6)


records = []
for mode, action in [
    ('none', 'Enable automatic expiration'),
    ('expiry', 'Enable temporary chat'),
    ('temporary', 'Disable temporary chat'),
    ('expiry-restored', 'Disable automatic expiration'),
    ('none-restored', None),
]:
    tree = state()
    model_bounds = [node.get('bounds') for node in matches(tree, args.model)]
    composer_bounds = [node.get('bounds') for label in ['Message…', 'Temporary message…'] for node in matches(tree, label)]
    if not model_bounds or len(composer_bounds) != 1:
        raise RuntimeError('Expected the selected model and an empty composer; no messages are sent by this check.')
    records.append({'mode': mode, 'model': model_bounds, 'composer': composer_bounds})
    if action:
        tap(tree, action)

if args.output:
    args.output.write_text(json.dumps(records, indent=2) + '\n')
assert all(row['model'] == records[0]['model'] for row in records), records
assert all(row['composer'] == records[0]['composer'] for row in records), records
print('PASS: model and composer bounds remain stable across all badge states.')
