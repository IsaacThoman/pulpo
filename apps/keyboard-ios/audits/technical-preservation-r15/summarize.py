#!/usr/bin/env python3
"""Preserve every result; compact rich reports and summarize frozen paired replays."""
import collections
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def compact(source, destination):
    rows = json.loads(pathlib.Path(source).read_text())
    timing = []
    for row in rows:
        timing.extend(row['automatic'].pop('keyMilliseconds'))
        row['raw'].pop('keyMilliseconds')
    pathlib.Path(destination).write_text('[\n' + ',\n'.join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + '\n]\n')
    timing.sort()
    return {'keys': len(timing), 'medianMs': timing[len(timing)//2],
            'p95Ms': timing[math.ceil(len(timing)*.95)-1], 'maxMs': timing[-1]}


def compare(split):
    a = json.loads((ROOT / f'{split}-baseline.json').read_text())
    b = json.loads((ROOT / f'{split}-candidate.json').read_text())
    assert [(x['mode'], x['id']) for x in a] == [(x['mode'], x['id']) for x in b]
    result = {}
    for mode in sorted(set(x['mode'] for x in a)):
        pairs = [(x, y) for x, y in zip(a, b) if x['mode'] == mode]
        groups = {}
        for group in sorted(set(x['group'] for x, _ in pairs)):
            group_pairs = [(x, y) for x, y in pairs if x['group'] == group]
            groups[group] = {'total': len(group_pairs), 'baseline': sum(x['correct'] for x, y in group_pairs),
                             'candidate': sum(y['correct'] for x, y in group_pairs)}
        result[mode] = {
            'total': len(pairs), 'baseline': sum(x['correct'] for x, y in pairs),
            'candidate': sum(y['correct'] for x, y in pairs),
            'rawBaseline': sum(x['rawCorrect'] for x, y in pairs), 'rawCandidate': sum(y['rawCorrect'] for x, y in pairs),
            'gains': [x['id'] for x, y in pairs if not x['correct'] and y['correct']],
            'regressions': [x['id'] for x, y in pairs if x['correct'] and not y['correct']],
            'candidateFailures': [y['id'] for x, y in pairs if not y['correct']],
            'outputChanges': [x['id'] for x, y in pairs if x['automatic']['output'] != y['automatic']['output']],
            'alternativeChanges': [x['id'] for x, y in pairs if x['automatic']['alternatives'] != y['automatic']['alternatives']],
            'autocorrectionChanges': [x['id'] for x, y in pairs if x['automatic'].get('autocorrection') != y['automatic'].get('autocorrection')],
            'learningChanges': [x['id'] for x, y in pairs if x['automatic']['learned'] != y['automatic']['learned']],
            'groups': groups,
        }
    return result


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'compact':
        print(json.dumps(compact(sys.argv[2], sys.argv[3]), indent=2))
    else:
        print(json.dumps({split: compare(split) for split in ['development', 'heldout']}, ensure_ascii=False, indent=2))
