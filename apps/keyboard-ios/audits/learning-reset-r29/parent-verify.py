#!/usr/bin/env python3
"""Check retained R29 evidence only; explicit checks remain active under -O."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--git', action='store_true')
parser.add_argument('--external', action='store_true')
parser.add_argument('--source-root', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()
def require(condition, message):
    if not condition:
        raise RuntimeError(message)
def raw(name):
    return (root / name).read_bytes()
def decoded(name):
    data = raw(name)
    return gzip.decompress(data) if name.endswith('.gz') else data
def load(name):
    return json.loads(decoded(name))
manifest = load('parent-manifest.json')
require(len(manifest['originalFiles']) == 19, 'Original artifact count changed')
for name, record in {**manifest['originalFiles'], **manifest['parentFiles']}.items():
    data = raw(name)
    require(len(data) == record['bytes'] and sha(data) == record['sha256'], 'Hash mismatch: ' + name)
freeze, seal, summary = (load(name) for name in ['source-freeze.json', 'heldout-seal.json', 'heldout-summary.json'])
missing = []
for name, expected in freeze['harness_sha256'].items():
    if (root / name).is_file():
        require(sha(raw(name)) == expected, 'Frozen harness mismatch: ' + name)
    else:
        missing.append(name)
require(missing == ['development-baseline.txt.gz'], 'Unexpected unavailable freeze artifact')
require(freeze['harness_sha256'][missing[0]] == '77f3ce5b4d7e5ca7c7ceeca0e09aa6bfe0b46c9d8dbe7ffdf2cf9b3039bc606d', 'Historical missing-log hash changed')
require(sha(decoded('heldout.json.gz')) == seal['sealed_payload_sha256'], 'Heldout seal mismatch')
require(len(decoded('heldout.json.gz')) == seal['bytes'] == 35267, 'Heldout byte count changed')
require(sha(decoded('heldout-results.json.gz')) == summary['results_sha256'], 'Heldout result hash mismatch')
cases, results = load('heldout.json.gz'), load('heldout-results.json.gz')
require(len(cases) == len(results) == 18, 'Expected18 schedules')
require([x['id'] for x in cases] == [x['id'] for x in results], 'Schedule alignment changed')
require(len({x['id'] for x in cases}) == 18, 'Duplicate schedule id')
checks = []
for case, result in zip(cases, results):
    expected = [(i, a) for i, a in enumerate(case['actions']) if a['op'] == 'check' or (a['op'] == 'reload' and 'expected' in a)]
    require(result['available'] is True and len(expected) == len(result['checks']), 'Unavailable/misaligned case: ' + case['id'])
    for (index, action), check in zip(expected, result['checks']):
        require(check['action'] == index and check['field'] == (action['field'] if action['op'] == 'check' else 'reload'), 'Check action mismatch')
        require(type(check['expected']) is type(action['expected']) and check['expected'] == action['expected'], 'Frozen expectation changed')
        matches = type(check['actual']) is type(check['expected']) and check['actual'] == check['expected']
        require(type(check['pass']) is bool and check['pass'] == matches, 'Recorded check verdict disagrees with raw values')
        checks.append(check)
    require(type(result['pass']) is bool and result['pass'] == all(x['pass'] for x in result['checks']), 'Recorded case verdict disagrees')
failed_ids = [r['id'] for r in results if not r['pass']]
require(failed_ids == summary['failed_ids'] == ['r29-h02', 'r29-h03', 'r29-h04', 'r29-h05', 'r29-h15', 'r29-h17', 'r29-h18'], 'Failure ids changed')
require(len(checks) == summary['checks'] == 133, 'Check denominator changed')
require(sum(not c['pass'] for c in checks) == summary['failed_checks'] == 24, 'Failed checks changed')
require(sum(c['pass'] for c in checks) == summary['passed_checks'] == 109, 'Passed checks changed')
require(summary['passed_schedules'] == 11 and summary['failed_schedules'] == 7 and summary['unavailable_schedules'] == summary['invalid_schedules'] == 0, 'Schedule totals changed')
author = load('heldout-authorship.json')
require(len(author['unavailable_desired_coverage']) == author['unavailable_desired_coverage_count'] == 8, 'Unsupported categories changed')
parent, provenance, queued = load('parent-result.json'), load('parent-provenance.json'), load('queued-write-results.json')
require(parent['uniqueSchedules'] == parent['repetitions'] == 1 and parent['nativeIOS'] is False, 'Parent replay scope changed')
require(len(parent['coreSources']) == 24 and len(parent['testSources']) == 3, 'Parent fingerprint count changed')
for name, expected in parent['testSources'].items():
    require(sha(raw(name)) == expected, 'Parent harness fingerprint mismatch: ' + name)
require(len(queued['runs']) == queued['recorded_repetitions'] == 3 and queued['unique_schedules'] == 1, 'Original repetition scope changed')
for result in [parent['result'], *queued['runs']]:
    require(result['available'] is True and result['reset_survives'] is False, 'Recorded resurrection outcome changed')
    require(result['after_completed_clear'] == {'known': [], 'total': 0}, 'Clear was not recorded empty')
    require(result['after_preclear_background_write_finishes'] == {'known': ['durableold', 'queuedold'], 'total': 2}, 'Late-write record changed')
    require(result['retained_writer_reload_after_own_late_save'] == {'changed': False, 'known': ['durableold', 'queuedold'], 'total': 2}, 'Retained reload record changed')
if args.external:
    data = Path(provenance['sourcePath']).read_bytes()
    require(sha(data) == provenance['sourceSha256'] and len(data) == provenance['sourceBytes'], 'External parent-result bytes changed')
    require(json.loads(data) == parent, 'Compact parent result changed values')
if args.source_root:
    for path, expected in parent['coreSources'].items():
        require(sha((args.source_root / path).read_bytes()) == expected, 'Parent compilation fingerprint mismatch: ' + path)
if args.git:
    repo = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=root).decode().strip()
    prefix = 'apps/keyboard-ios/audits/learning-reset-r29/'
    for name in manifest['originalFiles']:
        require(subprocess.check_output(['git', 'show', manifest['originalCommit'] + ':' + prefix + name], cwd=repo) == raw(name), 'Original imported bytes changed: ' + name)
    for path, expected in freeze['source_sha256'].items():
        require(sha(subprocess.check_output(['git', 'show', freeze['baseline'] + ':' + path], cwd=repo)) == expected, 'Historical source mismatch: ' + path)
print('PASS:19 original artifacts unchanged;18 schedules,7 failed;133 checks,24 failed; parent1 unique two-process replay recorded0→2/reloadfalse. Missing historical development log not verified; no behavior replay.')
