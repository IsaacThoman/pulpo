#!/usr/bin/env python3
"""Recompute exact rates, paired transitions, and host-only latency from reports."""
import collections
import hashlib
import json
import math
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent
FROZEN = {
    'PROTOCOL.md': 'b84609541007f8aef44df546f92f4924819436c4ba8e01ced685f81f5819d88a',
    'development.json': '6b8f6bc2d79adefdf6a0da6a4defeeaa5f7569a0cf482e439cecf187222ba290',
    'held-out.json': '86d912dfb4cf74a8794eadd7737bd5cb95e2d912a1502fcd12fc9623a5714855',
}


def score(report):
    groups = collections.defaultdict(list)
    for row in report['outcomes']:
        assert row['rawOutput'] == row['typed'], row
        assert row['correct'] == (row['output'] == row['desired']), row
        assert row['keyCount'] == len(row['keyMilliseconds']), row
        groups[row['mode'] + '/' + row['category']].append(row['correct'])
    times = sorted(t for row in report['outcomes'] for t in row['keyMilliseconds'])
    return {
        'correct': sum(row['correct'] for row in report['outcomes']),
        'total': len(report['outcomes']),
        'groups': {group: {'correct': sum(values), 'total': len(values),
                           'percent': 100 * sum(values) / len(values)}
                   for group, values in groups.items()},
        'failures': [{key: row[key] for key in ['id', 'mode', 'typed', 'desired', 'output']}
                     for row in report['outcomes'] if not row['correct']],
        'elapsedSeconds': report['elapsedSeconds'],
        'keys': len(times),
        'keyMilliseconds': {'median': statistics.median(times), 'p95': times[math.ceil(.95 * len(times)) - 1],
                            'mean': statistics.mean(times)},
    }


def main():
    for name, expected in FROZEN.items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    result = {}
    for split in ['development', 'diagnostic', 'held-out']:
        reports = {label: json.loads((ROOT / f'{label}-{split}.json').read_text())
                   for label in ['baseline', 'rejected']}
        indexed = {label: {(row['id'], row['mode']): row for row in report['outcomes']}
                   for label, report in reports.items()}
        assert len(indexed['baseline']) == len(reports['baseline']['outcomes'])
        assert len(indexed['rejected']) == len(reports['rejected']['outcomes'])
        assert indexed['baseline'].keys() == indexed['rejected'].keys()
        if split != 'diagnostic':
            cases = json.loads((ROOT / f'{split}.json').read_text())
            assert indexed['baseline'].keys() == {(c['id'], m) for c in cases for m in c['modes']}
        transitions = []
        for key, before in indexed['baseline'].items():
            after = indexed['rejected'][key]
            assert all(before[field] == after[field] for field in ['typed', 'desired', 'category'])
            if before['output'] != after['output']:
                transitions.append({'id': key[0], 'mode': key[1], 'before': before['output'], 'after': after['output'],
                                    'fixed': not before['correct'] and after['correct'],
                                    'regressed': before['correct'] and not after['correct']})
        result[split] = {label: score(report) for label, report in reports.items()}
        result[split]['transitions'] = transitions
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
