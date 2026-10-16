#!/usr/bin/env python3
"""Verify retained R16 evidence only; never opens the sealed holdout or runs Swift."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent


def git_output(*arguments):
    # Git pathspecs below are repository-relative, independent of the audit depth.
    repository = subprocess.check_output(
        ['git', 'rev-parse', '--show-toplevel'], cwd=root, text=True).strip()
    return subprocess.check_output(['git', *arguments], cwd=repository)

sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: (root / p).read_bytes()
manifest = json.loads(read('retained-manifest.json'))
for name, record in manifest.items():
    data = read(name)
    assert len(data) == record['bytes'] and sha(data) == record['sha256'], name
provenance = json.loads(read('artifact-provenance.json'))
for name, record in provenance.items():
    data = gzip.decompress(read(name)) if name.endswith('.gz') else read(name)
    assert len(data) == record['originalBytes'] and sha(data) == record['originalSha256'], name
agent = json.loads(read('agent-manifest.json'))
assert sha(read('agent-audit.md')) == agent['auditSha256']
for name, expected in agent['finalTestHashes'].items():
    assert sha(read('restored-snapshots/' + name + '.txt')) == expected
for name, expected in agent['artifacts'].items():
    retained = name + '.gz' if name in ['development-report.json', 'rejected-artifacts/candidate-and-fuzz.patch'] else name
    data = gzip.decompress(read(retained)) if retained.endswith('.gz') else read(retained)
    assert sha(data) == expected, name
report = json.loads(gzip.decompress(read('development-report.json.gz')))
rows = report['rows']
assert len(rows) == 332 and len({r['id'] for r in rows}) == 83
assert len({r['id'] for r in rows if not r['ambiguous']}) == 78
assert len({(r['id'], r['timing']) for r in rows}) == len(rows)
def counts(rs):
    return dict(total=len(rs), baseline=sum(r['baseline']['passed'] for r in rs),
                candidate=sum(r['candidate']['passed'] for r in rs),
                gains=sum(not r['baseline']['passed'] and r['candidate']['passed'] for r in rs),
                regressions=sum(r['baseline']['passed'] and not r['candidate']['passed'] for r in rs),
                unavailable=sum('unavailable' in r['baseline'] or 'unavailable' in r['candidate'] for r in rs),
                conservationFailures=sum(len(r[s].get('conservationFailures', [])) for r in rs for s in ['baseline', 'candidate']))
scored = [r for r in rows if not r['ambiguous']]
assert counts(scored) == report['counts'] and counts(rows) == report['allCases']
assert counts([r for r in rows if r['ambiguous']]) == report['diagnosticCounts']
assert report['counts'] == dict(total=312, baseline=152, candidate=232, gains=80, regressions=0, unavailable=24, conservationFailures=0)
assert report['diagnosticCounts']['regressions'] == 8
for key, field in [('byTiming', 'timing'), ('byLanguage', 'language')]:
    assert report[key] == {value: counts([r for r in scored if r[field] == value]) for value in {r[field] for r in scored}}
private = [r for r in rows if r['category'] == 'privacy' or r['category'].startswith(('private-', 'restricted-'))]
assert len(private) == 40 and all(r[s]['personalCount'] == 0 for r in private for s in ['baseline', 'candidate'])
for timing in report['byTiming']:
    subset = [r for r in rows if r['timing'] == timing]
    assert len(subset) == 83 and len({r['id'] for r in subset}) == 83
seal, rejection = (json.loads(read(p)) for p in ['heldout-seal.json', 'rejection.json'])
assert (seal['cases'], seal['scored'], seal['diagnostic']) == (36, 30, 6)
assert rejection['heldout']['executed'] == 0 and rejection['heldout']['unavailable'] == 36
assert seal['sha256'] == rejection['heldout']['sha256'] == agent['heldout']['authorReportedSha256']
assert report['hashes'] == {Path(k).name: v for k, v in agent['rawResultHashes'].items() if 'baseline-final' in k or 'candidate' in k}
def check_body(name):
    text = read('rejected-artifacts/' + name).decode()
    start = text.index('  func check(op:')
    text = text[start:text.index('  func finish()', start)]
    return text[text.index('\n  {'):]
original = check_body('EngineFuzz.baseline.swift.txt')
rejected = check_body('EngineFuzz.rejected.swift.txt')
exception = ',\n        !(isSpace && conservationVerdict.permitsSpaceReplacement)'
assert rejected.count(exception) == 1
assert original.split() == rejected.replace(exception, '').split()
if '--git' in sys.argv:
    proof = json.loads(read('restoration-proof.json'))
    for path, record in proof['blobs'].items():
        for commit in record['commits']:
            data = git_output('show', commit + ':' + path)
            assert sha(data) == record['sha256'] and len(data) == record['bytes']
    candidate = git_output('show', agent['soleCandidateCommit'] + ':apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift')
    assert sha(candidate) == rejection['sourceSha256']
    assert git_output('diff', proof['baseline'], proof['final'], '--',
        'apps/keyboard-ios/PulpoKeyboardKit/Sources',
        'apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/EngineFuzz.swift') == b''
print(f'PASS: {len(manifest)} file hashes; 332 paired development rows; 24 unavailable scored executions; 8 diagnostic losses; 36 heldout unexecuted. No behavior replay.')
