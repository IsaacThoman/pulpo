#!/usr/bin/env python3
"""Summarize ONLY requested frozen split outputs; never implicitly open held-out data."""
import argparse
import json
import statistics
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('outputs', type=Path)
parser.add_argument('--split', choices=['development', 'verification'], default='development')
parser.add_argument('--details', action='store_true')
args = parser.parse_args()
rows = json.loads((args.outputs / f'{args.split}.json').read_text())
def metrics(items):
    return dict(n=len(items), hits=sum(x['hit'] for x in items), useful=sum(x['useful'] for x in items), saved=sum(x['saved'] for x in items), left=sum(x['leftSlotHit'] for x in items))
print(args.outputs.name, args.split, metrics(rows))
for group in dict.fromkeys(x['group'] for x in rows):
    print(group, metrics([x for x in rows if x['group'] == group]))
for key in ['coldMicroseconds', 'warmMicroseconds']:
    timings = [v for x in rows for v in (x[key] if isinstance(x[key], list) else [x[key]])]
    print(key, 'n=', len(timings), 'median=', round(statistics.median(timings), 2), 'p95=', round(sorted(timings)[int(.95*(len(timings)-1))], 2), 'max=', round(max(timings), 2))
if args.details:
    for x in rows:
        print(x['id'], 'HIT' if x['hit'] else 'MISS', 'saved=', x['saved'], '|'.join(s['text'] for s in x['slots']), 'auto=', x.get('autocorrection'))
