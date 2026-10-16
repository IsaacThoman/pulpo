#!/usr/bin/env python3
"""Verify retained R27 bytes/results; no builds, Swift execution or new inference."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
assert set(sys.argv[1:]) <= {'--git', '--external'}
sha = lambda b: hashlib.sha256(b).hexdigest()
def read(name):
    data = (root / name).read_bytes()
    return gzip.decompress(data) if name.endswith('.gz') else data
load = lambda name: json.loads(read(name))
manifest = load('manifest.json')
for name, record in manifest.items():
    data = (root / name).read_bytes()
    assert len(data) == record['bytes'] and sha(data) == record['sha256'], name
assert sum(p.stat().st_size for p in root.rglob('*') if p.is_file()) <= 250000
for name, record in load('provenance.json').items():
    data = read(name)
    assert len(data) == record['uncompressedBytes'] and sha(data) == record['uncompressedSha256'], name
    if '--external' in sys.argv and record['kind'] == 'external-exact-bytes':
        assert Path(record['path']).read_bytes() == data, name
patch = read('rejected-candidate.patch.gz')
resources = [line[1:] for line in patch.splitlines() if line.startswith((b'-{"version":', b'+{"version":'))]
assert len(resources) == 2
catalogs = [json.loads(data) for data in resources]
proof = load('restoration-proof.json')
resource_record = proof['files']['apps/keyboard-ios/LanguageData/emoji.json']
assert sha(resources[0]) == resource_record['baselineAndRestoredSha256']
assert sha(resources[1]) == resource_record['candidateSha256']
assert [len(data) for data in resources] == [242085, 290657]
stripped = copy.deepcopy(catalogs[1])
entries = [e for c in stripped['categories'] for e in c['emoji']]
assert len(entries) == 1923 and sum(len(e.get('s', [])) for e in entries) == 1914
for entry in entries:
    entry.pop('s', None)
assert stripped == catalogs[0]
available = [{e['e'] for c in catalog['categories'] for e in c['emoji']} for catalog in catalogs]
def paired(inputs, baseline, candidate):
    rows, a, b = map(load, [inputs, baseline, candidate])
    assert [r['id'] for r in rows] == [r['id'] for r in a] == [r['id'] for r in b]
    assert len(set(r['id'] for r in rows)) == len(rows)
    for row, x, y in zip(rows, a, b):
        for side, result in enumerate([x, y]):
            for key in ['query', 'kind', 'family', 'stratum', 'acceptable']:
                assert result[key] == row[key]
            values, accepted = result['values'], row['acceptable']
            rank = next((i + 1 for i, value in enumerate(values) if value in accepted), None)
            assert result['resultCount'] == len(values) and len(set(values)) == len(values)
            assert result['firstAcceptableRank'] == rank
            assert result['acceptableTop8'] == sum(value in accepted for value in values[:8])
            assert result['usefulTop3'] == (rank is not None and rank <= 3)
            assert result['unavailable'] == [value for value in accepted if value not in available[side]]
            if row['kind'] == 'useful': assert result['passed'] == (rank is not None and rank <= (row['maxRank'] or 8))
            if row['kind'] == 'empty': assert result['passed'] == (not values)
            if row['kind'] == 'equivalent': assert result['passed'] == (values == result['referenceValues'])
            if row['kind'] == 'distinct': assert result['passed'] == (values != result['referenceValues'])
    return rows, a, b
for split, expected in [('development', (27, 15, 8, 15, 11, 3)), ('fresh', (45, 18, 8, 18, 21, 5))]:
    rows, a, b = paired(split + '.json.gz', 'baseline-' + split + '.json.gz', 'candidate-' + split + '.json.gz')
    useful = [(x, y) for x, y in zip(a, b) if x['kind'] == 'useful']
    actual = (len(rows), len(useful), sum(x['passed'] for x, y in useful), sum(y['passed'] for x, y in useful), sum(x['values'] != y['values'] for x, y in zip(a, b)), len({x['family'] for x, y in useful if not x['passed'] and y['passed']}))
    assert actual == expected, (split, actual)
    assert not [y for x, y in useful if x['passed'] and not y['passed']]
    assert [sum(r[s]['usefulTop3'] for r in useful) for s in [0, 1]] == list(expected[2:4])
    if split == 'fresh':
        flags = [y['id'] for x, y in zip(a, b) if y['kind'] != 'useful' and (x['values'] != y['values'] if y['kind'] == 'baseline' else not y['passed'])]
        assert flags == ['control-order-en', 'control-one-enye', 'control-two-literal', 'control-enye-distinct']
        assert [sum(r[s]['acceptableTop8'] for r in useful) for s in [0, 1]] == [30, 62]
        assert [len({v for r in useful for v in r[s]['values'][:8] if v in r[s]['acceptable']}) for s in [0, 1]] == [23, 23]
        for stratum, scores in [('en', (6, 6)), ('es', (1, 6)), ('mixed', (1, 6))]:
            subset = [(x, y) for x, y in useful if x['stratum'] == stratum]
            assert len(subset) == 6 and tuple(sum(r[s]['passed'] for r in subset) for s in [0, 1]) == scores
        unavailable = next(r for r in b if r['id'] == 'control-enye-distinct')
        assert unavailable['query'] == 'caña' and unavailable['values'] == unavailable['referenceValues'] == [] and unavailable['passed'] is False
        x, y = next((x, y) for x, y in zip(a, b) if x['query'] == 'mu')
        assert len(x['values']) == 38 and len(y['values']) == 48 and y['values'][:38] == x['values']
review_queries = []
for prefix, count, changed in [('', 64, 13), ('extra-', 21, 11)]:
    rows, a, b = paired('original-review/' + prefix + 'queries.json.gz', 'original-review/' + prefix + 'baseline.json.gz', 'original-review/' + prefix + 'candidate.json.gz')
    review_queries.extend(r['query'] for r in rows)
    assert len(rows) == count and sum(x['values'] != y['values'] for x, y in zip(a, b)) == changed
    if not prefix:
        for query, old, new in [('q', 29, 31), ('z', 40, 46)]:
            x, y = next((x, y) for x, y in zip(a, b) if x['query'] == query)
            assert (len(x['values']), len(y['values'])) == (old, new) and y['values'][:old] == x['values']
assert len(review_queries) == 85 and len(set(review_queries)) == 78
rows, a, b = paired('parent-diacritic-diagnostic/queries.json.gz', 'parent-diacritic-diagnostic/baseline.json.gz', 'parent-diacritic-diagnostic/candidate.json.gz')
assert len(rows) == 16 and all(r['kind'] == 'diagnostic' for r in rows)
results = {x['query']: (x['values'], y['values']) for x, y in zip(a, b)}
assert results['vicuna'] == (['🦙'], []) and results['sao'] == (['🇸🇹'], [])
assert results['pina'] == (['🍍', '🥥', '🪅'], ['🍍', '🪅'])
for q in ['pinata', 'piñata', 'pin\u0303ata']: assert results[q] == (['🪅'], ['🪅'])
for q in ['jalapeno', 'jalapeño']: assert results[q] == ([], [])
seal = dict(line.split('=', 1) for line in read('seal-metadata.txt').decode().splitlines() if '=' in line)
assert sha(read('fresh.json.gz')) == seal['payload_sha256'] and len(read('fresh.json.gz')) == int(seal['payload_bytes'])
for name in ['contract.txt', 'schema.json', 'development.json']:
    assert sha(read(name + '.gz' if name.endswith('.json') and name != 'schema.json' else name)) == seal['input_' + name + '_sha256']
assert not list(root.rglob('*.swift'))
if '--git' in sys.argv:
    git_root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=root).decode().strip()
    for name, record in load('provenance.json').items():
        if record['kind'] == 'git-blob': assert subprocess.check_output(['git', 'show', record['commit'] + ':' + record['path']], cwd=git_root) == read(name)
    for line in read('candidate-source.sha256').decode().splitlines():
        expected, path = line.split(None, 1)
        assert sha(subprocess.check_output(['git', 'show', proof['candidate'] + ':' + path], cwd=git_root)) == expected
    for path, record in proof['files'].items():
        for commit in [proof['base'], proof['restored']]:
            result = subprocess.run(['git', 'show', commit + ':' + path], cwd=git_root, capture_output=True)
            assert (sha(result.stdout) if result.returncode == 0 else None) == record['baselineAndRestoredSha256']
    assert subprocess.check_output(['git', 'diff', proof['base'], proof['restored'], '--', *proof['scopes']], cwd=git_root) == b''
    assert subprocess.check_output(['git', 'diff', '--no-ext-diff', '--full-index', '--binary', proof['base'], proof['candidate'], '--', *proof['scopes']], cwd=git_root) == patch
print(f'PASS: {len(manifest)} file hashes; dev8→15/15,fresh8→18/18; 11/21 changed rows; four fresh control flags (one unavailable); q/z append-only; informed vicuna/sao/pina losses. No behavior replay.')
