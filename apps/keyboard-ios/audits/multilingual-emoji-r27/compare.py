#!/usr/bin/env python3
"""Summarize immutable raw API measurements; never edits oracles or results."""
import json
import sys
from collections import Counter

baseline = json.load(open(sys.argv[1]))
candidate = json.load(open(sys.argv[2]))
assert [r['id'] for r in baseline] == [r['id'] for r in candidate]
useful = [(a, b) for a, b in zip(baseline, candidate) if a['kind'] == 'useful']
controls = [(a, b) for a, b in zip(baseline, candidate) if a['kind'] != 'useful']
print(f'Rows: {len(candidate)}; useful: {len(useful)}; controls: {len(controls)}')
print(f'Distinct useful target families: {len({a["family"] for a, b in useful})}')
for stratum in ('en', 'es', 'mixed'):
    pairs = [(a, b) for a, b in useful if a['stratum'] == stratum]
    print(f'{stratum} useful <=8: {sum(a["passed"] for a, b in pairs)} -> {sum(b["passed"] for a, b in pairs)} / {len(pairs)}; '
          f'first3: {sum(a["usefulTop3"] for a, b in pairs)} -> {sum(b["usefulTop3"] for a, b in pairs)}')
print(f'Total useful <=8: {sum(a["passed"] for a, b in useful)} -> {sum(b["passed"] for a, b in useful)}; '
      f'first3: {sum(a["usefulTop3"] for a, b in useful)} -> {sum(b["usefulTop3"] for a, b in useful)}')
print('Transitions:', dict(Counter(f'{a["passed"]}->{b["passed"]}' for a, b in useful)))
gain_families = sorted({b['family'] for a, b in useful if not a['passed'] and b['passed']})
regressions = [b['id'] for a, b in useful if a['passed'] and not b['passed']]
print('Families with gains:', gain_families)
print('Useful regressions:', regressions)
print('Accepted alternatives in first8:', sum(a['acceptableTop8'] for a, b in useful), '->', sum(b['acceptableTop8'] for a, b in useful))
for label, data in [('baseline', baseline), ('candidate', candidate)]:
    rows = [r for r in data if r['kind'] == 'useful' and r['unavailable']]
    print(f'{label}: rows with unavailable acceptable alternatives={len(rows)}, unique unavailable emoji={len({e for r in rows for e in r["unavailable"]})}; '
          f'wholly unavailable rows={sum(len(r["unavailable"]) == len(r["acceptable"]) for r in rows)}')
violations = []
for a, b in controls:
    passed = b['values'] == a['values'] if b['kind'] == 'baseline' else b['passed']
    if not passed:
        violations.append(b['id'])
print('Candidate frozen-control violations:', violations)
print('All changed raw rows (full sequences are in input JSON):')
for a, b in zip(baseline, candidate):
    if a['values'] == b['values']:
        continue
    print(json.dumps({'id': b['id'], 'family': b['family'], 'query': b['query'], 'kind': b['kind'],
                      'oldPassed': a['passed'], 'newPassed': b['passed'],
                      'oldRank': a['firstAcceptableRank'], 'newRank': b['firstAcceptableRank'],
                      'oldAcceptableTop8': a['acceptableTop8'], 'newAcceptableTop8': b['acceptableTop8'],
                      'oldCount': a['resultCount'], 'newCount': b['resultCount'],
                      'removed': [e for e in a['values'] if e not in b['values']],
                      'added': [e for e in b['values'] if e not in a['values']]}, ensure_ascii=False))
