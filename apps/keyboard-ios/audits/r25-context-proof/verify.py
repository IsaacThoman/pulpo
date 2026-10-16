#!/usr/bin/env python3
"""Validate the bounded exposed R25 archive; never open seal paths or run Swift."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess

LIMIT = 1_048_576
DEV_SHA = '23a662b494695a3d3a0606ed19df6535f9318e742b78cfd1957539cba7493511'
ENGINE_SHA = '3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97'
FUZZ_SHA = 'd839f66e9baac788f546badeadc4f73735af07f3e18f7ca26b818a608964ecb0'
TIMINGS = ('immediate', 'queued', 'optimistic', 'old-own')
LANGUAGES = ('en', 'es', 'bilingual')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value):
    return type(value) is int


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    require(path.stat().st_size <= LIMIT, f'Oversized artifact: {path.name}')
    return path.read_bytes()


def decode(name, raw):
    if name.endswith('.gz'):
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            raw = stream.read(LIMIT + 1)
        require(len(raw) <= LIMIT, 'Oversized decompressed artifact')
    return raw


def schema(raw, legacy=False):
    """Structural contract check only; does not simulate Swift Character actions."""
    if legacy:
        require(digest(raw) == DEV_SHA, 'Legacy schema requires exact frozen development bytes')
    cases = json.loads(raw)
    require(isinstance(cases, list) and len(cases) > 0, 'Expected nonempty case array')
    ids = []
    missing = []
    allowed = {'type', 'swipe', 'insertText', 'undo', 'flush', 'move', 'select', 'host',
               'moveSilent', 'hostSilent', 'shift', 'shiftDouble'}
    for case in cases:
        require(isinstance(case, dict), 'Case object required')
        require(all(isinstance(case.get(key), str) for key in (
            'id', 'language', 'category', 'intent', 'initial', 'typed', 'expected')), 'Required case strings')
        ids.append(case['id'])
        require(case['language'] in LANGUAGES and integer(case.get('caret')), 'Language/caret schema')
        if case.get('expectedCaret') is None:
            missing.append(case['id'])
        else:
            require(integer(case['expectedCaret']), 'expectedCaret must be integer')
        for key in ('selectionLength', 'expectedSelectionLength'):
            require(case.get(key) is None or integer(case[key]), f'{key} schema')
        require(case.get('ambiguous') is None or type(case['ambiguous']) is bool, 'Ambiguous schema')
        require(case.get('capitalization', 'default') in ('default', 'none'), 'Capitalization schema')
        require(case.get('field', 'normal') in ('normal', 'password', 'email', 'url', 'number'), 'Field schema')
        operations = case.get('operations', [])
        require(isinstance(operations, list), 'Operations array required')
        for action in operations:
            require(isinstance(action, dict) and action.get('kind') in allowed, 'Required operation kind')
            require(action.get('text') is None or isinstance(action['text'], str), 'Operation text schema')
            require(all(action.get(key) is None or integer(action[key]) for key in ('offset', 'start', 'length')), 'Operation integer schema')
    require(len(set(ids)) == len(ids), 'Duplicate frozen ID')
    require(legacy or not missing, f'Required expectedCaret missing in {len(missing)} cases')
    return cases, len(missing)


def validate_report(cases, document):
    require(len(cases) == 92 and document['cases'] == 92 and document['scoredCases'] == 87
            and document['timingRows'] == 368, 'Frozen workload counts')
    by_id = {case['id']: case for case in cases}
    rows = document['rows']
    require(isinstance(rows, list) and len(rows) == 368, 'Baseline row count')
    keys = [(row['id'], row['timing']) for row in rows]
    require(len(set(keys)) == len(keys)
            and set(keys) == {(case['id'], timing) for case in cases for timing in TIMINGS}, 'Duplicate/missing timing observations')
    for row in rows:
        case = by_id[row['id']]
        require((row['language'], row['category'], row['expected']) == (case['language'], case['category'], case['expected']), 'Frozen row metadata')
        require(row.get('expectedCaret') == case.get('expectedCaret'), 'Frozen expected caret')
        require(isinstance(row['actual'], str), 'Actual document type')
        require(all(integer(row[key]) and row[key] >= 0 for key in (
            'actualCaret', 'actualSelectionLength', 'personalCount', 'queuedRequests', 'queuedApplied')), 'Observation integer types')
        require(type(row['passed']) is bool and type(row['ambiguous']) is bool, 'Observation boolean types')
        require(row['ambiguous'] == case.get('ambiguous', False), 'Frozen diagnostic status')
        require(isinstance(row['conservationFailures'], list)
                and all(isinstance(item, str) for item in row['conservationFailures']), 'Conservation verdict types')
        require(row.get('unavailable') is None or isinstance(row['unavailable'], str) and bool(row['unavailable']), 'Unavailable reason')
        require(row['queuedRequests'] == row['queuedApplied'], 'Unapplied queued requests')
        require(row['timing'] == 'queued' or row['queuedRequests'] == 0, 'Queue timing label')
        expected = (row.get('unavailable') is None and row['actual'] == case['expected']
                    and (case.get('expectedCaret') is None or row['actualCaret'] == case['expectedCaret'])
                    and row['actualSelectionLength'] == case.get('expectedSelectionLength', 0)
                    and not row['conservationFailures'])
        require(row['passed'] == expected, 'Incorrect exact score')
    by_timing = {}
    for timing in TIMINGS:
        group = [row for row in rows if row['timing'] == timing]
        scored = [row for row in group if not row['ambiguous']]
        expected = {'scored': len(scored), 'passed': sum(row['passed'] for row in scored),
                    'unavailable': sum(row.get('unavailable') is not None for row in group),
                    'conservationFailures': sum(bool(row['conservationFailures']) for row in group),
                    'diagnostics': sum(row['ambiguous'] for row in group),
                    'diagnosticPassed': sum(row['passed'] for row in group if row['ambiguous'])}
        require(document['byTiming'][timing] == expected
                and all(integer(value) for value in document['byTiming'][timing].values()), 'Incorrect timing summary')
        require(expected == {'scored': 87, 'passed': 47, 'unavailable': 6,
                             'conservationFailures': 0, 'diagnostics': 5, 'diagnosticPassed': 5}, 'Frozen baseline timing counts')
        by_timing[timing] = expected
    require(set(document['byTiming']) == set(TIMINGS), 'Unexpected timing summary')
    per_language = {}
    for language, numerator, denominator in (('en', 132, 204), ('es', 32, 80), ('bilingual', 24, 64)):
        group = [row for row in rows if row['language'] == language and not row['ambiguous']]
        require(sum(row['passed'] for row in group) == numerator and len(group) == denominator, 'Language counts')
        per_language[language] = {'passed': numerator, 'scoredRows': denominator}
    p1 = [row for row in rows if row['id'].startswith('r25-p1-')]
    require(len(p1) == 12 and all(row['passed'] and row['actual'] == 'old tehtailold teh tail'
            and row['actualCaret'] == 19 and row['actualSelectionLength'] == 0 for row in p1), 'Baseline P1 evidence')
    return {'scoredPassed': 188, 'scoredRows': 348, 'diagnosticPassed': 20,
            'diagnosticRows': 20, 'unavailableRows': 24, 'byTiming': by_timing, 'byLanguage': per_language}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--extract', type=Path, help='Create a new directory for the three exposed gzip files')
    parser.add_argument('--history', type=Path, help='Read original committed source in this repository; no checkout mutation')
    args = parser.parse_args()
    root = args.root.resolve()
    manifest = json.loads(read(root / 'retained-manifest.json'))
    require(manifest['schema'] == 1 and manifest['candidate'] is None, 'Retention schema/candidate')
    names = {str(path.relative_to(root)) for path in root.rglob('*') if path.is_file()}
    require(names == set(manifest['files']) | {'retained-manifest.json'}
            and len(manifest['originals']) == 23 and set(manifest['originals']).issubset(manifest['files']), 'Archive coverage')
    data = {}
    for name, record in manifest['files'].items():
        require(not Path(name).is_absolute() and '..' not in Path(name).parts, 'Invalid retained path')
        raw = read(root / name)
        require(len(raw) == record['bytes'] and digest(raw) == record['sha256'], f'{name}: retained fingerprint')
        data[name] = decode(name, raw)
        if name in manifest['originals']:
            original = manifest['originals'][name]
            require(len(data[name]) == original['bytes'] and digest(data[name]) == original['sha256'], f'{name}: original fingerprint')
    original = json.loads(data['manifest.json'])
    require(original['productionCandidate'] is None and original['integratedGate'] == 'REJECTED', 'Historical disposition')
    require(original['productionSHA256'] == ENGINE_SHA
            and original['restorationProof']['originalFuzzerSHA256'] == FUZZ_SHA, 'Historical restoration fingerprints')
    prefix = 'apps/keyboard-ios/audits/r25-context-proof/'
    paths = {record['path']: data[name] for name, record in manifest['originals'].items()}
    for name, sha in original['artifactSHA256'].items():
        require(digest(paths[prefix + name]) == sha, f'Original manifest mismatch: {name}')
    for path, sha in original['afterRestorationSHA256'].items():
        require(digest(paths[path]) == sha, f'Original fixture mismatch: {path}')
    require(data['author-contract.txt'] == data['contract.txt'], 'Author contract interface')
    freeze = json.loads(data['development-freeze.json'])
    for name, sha in freeze['sha256'].items():
        require(digest(paths[prefix + name]) == sha, f'Pre-source freeze mismatch: {name}')
    seal = json.loads(data['heldout-seal.json'])
    rejection = json.loads(data['rejection.json'])
    require(seal['contractSha256'] == digest(data['contract.txt'])
            and seal['heldoutSha256'] == rejection['fresh']['seal']
            and rejection['heldoutRevealed'] is False and rejection['heldoutExecuted'] is False
            and rejection['fresh']['executedRows'] == 0, 'Seal metadata/disposition')
    cases, missing = schema(data['development.json.gz'], legacy=True)
    require(missing == 71, 'Historical missing-caret count')
    try:
        schema(data['development.json.gz'])
    except ValueError as error:
        require(str(error) == 'Required expectedCaret missing in 71 cases', 'Unexpected strict schema error')
    else:
        raise ValueError('Historical document-only cases accepted as strict fresh data')
    summary = validate_report(cases, json.loads(data['baseline-development.json.gz']))
    functions = sum(data[name].count(b'@Test') for name in manifest['originals']
                    if name.startswith('fixtures/') and name.endswith('Tests.swift.txt'))
    require(functions == 53, 'Historical added-function count')
    history = 'Historical fingerprints checked; source comparison not requested'
    if args.history:
        require(manifest['originalBase'] == '23454942'
                and manifest['originalCommit'] == '912ddb1a1144d092032b7828076615be340acc95', 'History revisions')
        package = 'apps/keyboard-ios/PulpoKeyboardKit/'
        for revision in (manifest['originalBase'], manifest['originalCommit'], manifest['portablePackageBase']):
            for path, expected in ((package + 'Sources/KeyboardCore/Input/KeyboardEngine.swift', ENGINE_SHA),
                                   (package + 'Tests/KeyboardCoreTests/EngineFuzz.swift', FUZZ_SHA)):
                blob = subprocess.check_output(['git', 'show', revision + ':' + path], cwd=args.history)
                require(digest(blob) == expected, 'Committed source restoration mismatch')
        changed = subprocess.check_output(['git', 'diff', '--name-only', manifest['originalBase'],
                                         manifest['originalCommit'], '--', package + 'Sources'], cwd=args.history)
        require(not changed, 'R25 production source changed')
        changed = subprocess.check_output(['git', 'diff', '--name-only', manifest['originalBase'],
                                         manifest['portablePackageBase'], '--', package], cwd=args.history)
        require(not changed, 'Portable package base differs')
        history = 'Original production and whole fuzzer restoration verified against committed bytes; portable package matches'
    if args.extract:
        destination = args.extract.resolve()
        require(not destination.exists(), 'Extraction destination must not exist')
        destination.mkdir(parents=True)
        for name in ('development.json.gz', 'baseline-development.json.gz', 'exclusions.json.gz'):
            (destination / name.removesuffix('.gz')).write_bytes(data[name])
    print(json.dumps({'originalArtifacts': 23, 'inactiveTestFunctions': functions,
                      'missingLegacyCaretOracles': missing, 'freshRowsExecuted': 0,
                      'restoration': history, 'baseline': summary}, indent=2))


if __name__ == '__main__':
    main()
