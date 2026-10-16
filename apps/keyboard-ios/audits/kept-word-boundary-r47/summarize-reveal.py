#!/usr/bin/env python3
"""Audit the single saved reveal; never launch either Engine executable."""
import hashlib, importlib.util, json, math, pathlib

audit = pathlib.Path(__file__).resolve().parent
load = lambda name: json.loads((audit / name).read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
def require(ok, message):
    if not ok:
        raise ValueError(message)

packet = load('heldout.json')
baseline = load('heldout-reveal/baseline.json')
candidate = load('heldout-reveal/candidate.json')
report = load('heldout-reveal/report.json')
receipt = load('heldout-reveal/receipt.json')
freeze = load('final-freeze.json')
seal = load('seal-receipt.json')
for variant, process in receipt['process'].items():
    require(process['exit'] == 0 and not process['stderr'] and not process['stdout'], variant + ' process')
    require(seal['time'] < process['started'] <= process['finished'], variant + ' seal order')
require(receipt['input'] == seal['inputSHA256'] == freeze['inputSHA256'] == sha(audit / 'heldout.json'), 'input binding')
require(receipt['freezeSHA256'] == seal['freezeSHA256'] == sha(audit / 'final-freeze.json'), 'freeze binding')
require(receipt['executables'] == freeze['executables'] and receipt['resources'] == freeze['resources'], 'run bindings')
spec = importlib.util.spec_from_file_location('r47_saved_checker', audit / 'check.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
require(checker.evaluate(packet, baseline, candidate) == report, 'saved report reproduction')
require(report['status'] == 'PASS' and report['unavailable'] == 0 and not report['failures'], 'whole gate')
require(len(report['allChecks']) == report['checks'] == report['passed'] == 5065, 'check denominator')
b = {(r['id'], r['index']): r for r in baseline}
c = {(r['id'], r['index']): r for r in candidate}
touch = lambda row: [row['weight'], row['offsets']]
roots = []
for relation in packet['relations']:
    if relation['kind'] != 'parity':
        continue
    at, space = tuple(relation['external']), tuple(relation['space'])
    prior, prior_space = (at[0], at[1] - 1), (space[0], space[1] - 1)
    increment = c[at]['weight'] - c[prior]['weight']
    require(increment == relation['samples'] > 0, 'nonvacuous root')
    require(touch(b[at]) == touch(b[prior]), 'baseline missing contribution')
    for ref in (b, c):
        require(touch(c[prior]) == touch(ref[prior_space]) and touch(c[at]) == touch(ref[space]), 'full before/after parity')
        require(ref[space]['weight'] - ref[prior_space]['weight'] == increment, 'exact reference increment')
    roots.append({'case': at[0], 'index': at[1], 'language': c[at]['language'],
                  'witness': relation['witness'], 'samples': increment,
                  'beforeWeight': c[prior]['weight'], 'afterWeight': c[at]['weight'],
                  'baselineWeight': b[at]['weight']})
changed = []
for key, row in b.items():
    other = c[key]
    require(all(math.isfinite(x) for r in (row, other) for point in r['offsets'] for x in point), 'finite full offsets')
    require(set(row) == set(other), 'same public fields')
    require(all(row[field] == other[field] for field in row if field not in {'weight', 'offsets'}), 'all non-touch values preserved')
    if touch(row) != touch(other):
        changed.append([key[0], key[1]])
languages = {}
for language in sorted({case['language'] for case in packet['cases']}):
    cases = [case for case in packet['cases'] if case['language'] == language]
    selected = [root for root in roots if root['language'] == language]
    languages[language] = {'cases': len(cases), 'rowsPerVariant': sum(len(case['ops']) for case in cases),
                           'positiveRoots': len(selected), 'newSampleOpportunities': sum(root['samples'] for root in selected)}
result = {'status': 'PASS', 'scope': 'Read-only saved-output accounting; no Engine/model rerun or changed oracle.',
          'cases': len(packet['cases']), 'rowsPerVariant': len(baseline), 'fullFiniteStates': len(baseline) + len(candidate),
          'checks': report['checks'], 'passed': report['passed'], 'unavailable': report['unavailable'],
          'groups': report['groups'], 'languages': languages, 'positiveRoots': roots, 'touchOnlyChangedRows': changed,
          'correlation': 'Rows, follow-ons, maps, offsets and references are correlated; checks are not accuracy trials.',
          'accuracy': 'No blind human or committed-correction accuracy measured. Exposed development offers remain separate.',
          'files': {path.name: sha(path) for path in sorted((audit / 'heldout-reveal').glob('*.json'))},
          'scriptSHA256': sha(pathlib.Path(__file__)), 'inputSHA256': receipt['input'], 'freezeSHA256': receipt['freezeSHA256']}
with (audit / 'heldout-result-summary.json').open('x') as output:
    output.write(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k not in {'groups', 'positiveRoots', 'touchOnlyChangedRows', 'files'}}))
