#!/usr/bin/env python3
"""Verify only the frozen retained R20 dataset; never execute keyboard code."""
import argparse
import collections
import gzip
import hashlib
import io
import json
from pathlib import Path

LIMIT = 1_048_576


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value):
    return type(value) is int


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_bytes(path):
    require(path.stat().st_size <= LIMIT, f"Oversized artifact: {path.name}")
    return path.read_bytes()


def decoded(name, data):
    if name.endswith('.gz'):
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, f"Oversized decompressed artifact: {name}")
    return data


def validate_result(case, result):
    for key in ('id', 'category', 'api', 'expected'):
        require(result[key] == case[key], f"{case['id']}: mismatched {key}")
    require(result['language'] == 'en_es', f"{case['id']}: not the frozen bilingual execution")
    require(integer(result['expectedCaret']) and result['expectedCaret'] == case['caret'], f"{case['id']}: expected caret")
    require(integer(result['actualCaret']) and isinstance(result['actual'], str), f"{case['id']}: actual types")
    for key in ('exact', 'oracleDefined', 'conserved', 'completed'):
        require(type(result[key]) is bool, f"{case['id']}: {key} must be boolean")
    require(result['oracleDefined'] == (case.get('availability') != 'ambiguous'), f"{case['id']}: oracle status")
    require(result['completed'] == (case.get('availability') != 'unavailable'), f"{case['id']}: completion status")
    require(isinstance(result['nativeDelivery'], str) and isinstance(result['notes'], list)
            and all(isinstance(note, str) for note in result['notes']), f"{case['id']}: metadata types")
    text = case['prefix'] + case['selected'] + case['suffix']
    cursor, selected = len(case['prefix']), case['selected']
    require(isinstance(result['primitives'], list), f"{case['id']}: primitives")
    for op in result['primitives']:
        require(integer(op['cursor']) and op['cursor'] == cursor, f"{case['id']}: primitive cursor")
        require(op['selected'] == selected and text[cursor:cursor + len(selected)] == selected, f"{case['id']}: selected range")
        require(isinstance(op['text'], str) and isinstance(op['removed'], str), f"{case['id']}: primitive text")
        if op['kind'] == 'insert':
            require(op['removed'] == selected, f"{case['id']}: insertion removed text")
            text = text[:cursor] + op['text'] + text[cursor + len(selected):]
            cursor += len(op['text'])
        elif op['kind'] == 'delete':
            require(op['text'] == '', f"{case['id']}: deletion payload")
            removed = selected or (text[cursor - 1] if cursor else '')
            require(op['removed'] == removed, f"{case['id']}: deletion removed text")
            if selected:
                text = text[:cursor] + text[cursor + len(selected):]
            elif cursor:
                text = text[:cursor - 1] + text[cursor:]
                cursor -= 1
        else:
            raise ValueError(f"{case['id']}: unknown primitive")
        selected = ''
        require(text.startswith(case['prefix']) and text.endswith(case['suffix'])
                and len(case['prefix']) <= cursor <= len(text) - len(case['suffix']), f"{case['id']}: host conservation")
    require(result['conserved'] and text == result['actual'] and cursor == result['actualCaret'], f"{case['id']}: final replay")
    expected = result['oracleDefined'] and result['completed'] and text == case['expected'] and cursor == case['caret']
    require(result['exact'] == expected, f"{case['id']}: incorrect exact flag")


def validate_pairs(suite, report, count):
    cases, pairs = suite['cases'], report['pairs']
    require(suite['schema'] == report['schema'] == 1 and len(cases) == len(pairs) == count, 'Suite/report coverage')
    require(len({case['id'] for case in cases}) == count, 'Duplicate frozen case')
    outcomes, failures, regressions, ambiguities, changed_failed = collections.Counter(), [], [], [], []
    for case, row in zip(cases, pairs):
        require(case.get('availability') in (None, 'unavailable', 'ambiguous'), f"{case['id']}: availability")
        require(case['api'] in ('spaced', 'raw', 'transcript', 'literal', 'emoji'), f"{case['id']}: API")
        require(all(isinstance(case[key], str) for key in ('id', 'category', 'prefix', 'selected', 'suffix', 'input', 'expected'))
                and integer(case['caret']), f"{case['id']}: frozen case types")
        require(row['case'] == case, f"{case['id']}: full frozen metadata mismatch or reordered/duplicate row")
        left, right = row['baseline'], row['candidate']
        validate_result(case, left)
        validate_result(case, right)
        if not left['oracleDefined']:
            outcome = 'ambiguous'
        elif left['exact'] and not right['exact']:
            outcome = 'regression'
        elif not left['exact'] and right['exact']:
            outcome = 'gain'
        elif not left['completed'] or not right['completed']:
            outcome = 'unavailable'
        else:
            outcome = 'pass' if right['exact'] else 'failure'
        require(row['outcome'] == outcome, f"{case['id']}: outcome")
        outcomes[outcome] += 1
        if outcome in ('failure', 'unavailable'):
            failures.append(case['id'])
        if outcome == 'regression':
            regressions.append(case['id'])
        changed = (left['actual'], left['actualCaret']) != (right['actual'], right['actualCaret'])
        if outcome == 'ambiguous' and changed:
            ambiguities.append(case['id'])
        if outcome == 'failure' and changed:
            changed_failed.append(case['id'])
    summary = {
        'total': count, 'oracleDefined': sum(row['baseline']['oracleDefined'] for row in pairs),
        'baselineExact': sum(row['baseline']['exact'] for row in pairs),
        'candidateExact': sum(row['candidate']['exact'] for row in pairs),
        'baselineUnavailable': sum(not row['baseline']['completed'] for row in pairs),
        'candidateUnavailable': sum(not row['candidate']['completed'] for row in pairs),
        'outcomes': dict(outcomes), 'regressionIDs': regressions, 'failureIDs': failures,
        'ambiguousChangedIDs': ambiguities,
        'primitiveReplay': 'all full documents/carets/selection replacements/conservation verified',
    }
    require(all(integer(report['summary'].get(key)) for key in (
        'total', 'oracleDefined', 'baselineExact', 'candidateExact', 'baselineUnavailable', 'candidateUnavailable'
    )), 'Paired summary count types')
    require(report['summary'] == summary, 'Incorrect paired summary')
    return dict(summary, changedFailedIDs=changed_failed)


def validate_r5(report):
    summaries = {}
    require(report['schema'] == 1, 'R5 schema')
    require(set(report['suites']) == {'development', 'heldout'}, 'R5 split coverage')
    for label, count in (('development', 28), ('heldout', 22)):
        split = report['suites'][label]
        rows = split['pairs']
        require(len(rows) == count and len({row['id'] for row in rows}) == count, 'R5 duplicate/missing row')
        for row in rows:
            require(isinstance(row['expected'], str), 'R5 expected type')
            for key in ('baseline', 'candidate'):
                result = row[key]
                require(result['id'] == row['id'] and result['expected'] == row['expected'], 'R5 identity')
                require(isinstance(result['actual'], str) and type(result['completed']) is bool
                        and type(result['passed']) is bool, 'R5 result types')
                require(result['passed'] == (result['completed'] and result['actual'] == row['expected']), 'R5 exact score')
            require(type(row['exposedTargetChanged']) is bool
                    and row['exposedTargetChanged'] == (row['baseline']['actual'] != row['candidate']['actual']), 'R5 changed flag')
        summary = {'total': count}
        for key in ('baseline', 'candidate'):
            summary[key + 'Exact'] = sum(row[key]['passed'] for row in rows)
            summary[key + 'Unavailable'] = sum(not row[key]['completed'] for row in rows)
        require(all(integer(split[key]) and split[key] == value for key, value in summary.items()), 'R5 summary')
        summaries[label] = summary
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--extract', type=Path, help='Create a new directory containing the four decompressed reports')
    args = parser.parse_args()
    root = args.root.resolve()
    manifest = json.loads(read_bytes(root / 'retained-manifest.json'))
    require(manifest['schema'] == 1, 'Manifest schema')
    require(set(manifest['originals']).issubset(manifest['files']) and len(manifest['originals']) == 28, 'Original artifact coverage')
    require({path.name for path in root.iterdir()} == set(manifest['files']) | {'retained-manifest.json'}, 'Unexpected/missing artifact')
    data = {}
    for name, record in manifest['files'].items():
        require(Path(name).name == name and name not in ('.', '..'), 'Invalid artifact path')
        raw = read_bytes(root / name)
        require(len(raw) == record['bytes'] and digest(raw) == record['sha256'], f'{name}: retained hash/size')
        data[name] = decoded(name, raw)
        if name in manifest['originals']:
            original = manifest['originals'][name]
            require(len(data[name]) == original['bytes'] and digest(data[name]) == original['sha256'], f'{name}: original decompressed hash/size')
    require(manifest['engineSourceSHA256']['baseline'] == manifest['engineSourceSHA256']['restored']
            == '3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97', 'Historical restored source fingerprint')
    freeze = json.loads(data['candidate-runner-freeze-v1.json'])
    original_paths = {entry['path']: entry['sha256'] for entry in manifest['originals'].values()}
    original_paths['apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'] = manifest['engineSourceSHA256']['rejectedCandidate']
    require(all(original_paths[path] == value for path, value in freeze['sha256'].items()), 'Original candidate freeze hashes')
    require(digest(data['heldout-v1.json']) == freeze['sealedHeldoutSHA256'], 'Sealed held-out fingerprint')
    summaries = {}
    for split, count in (('development', 40), ('heldout', 36), ('source-controls', 22)):
        suite = json.loads(data[f'{split}-v1.json'])
        report = json.loads(data[f'{split}-paired-v1.json.gz'])
        summaries[split] = validate_pairs(suite, report, count)
    summaries['old-r5-exposed'] = validate_r5(json.loads(data['old-r5-replay-paired-v1.json.gz']))
    if args.extract:
        destination = args.extract.resolve()
        require(not destination.exists(), 'Extraction destination must not exist')
        destination.mkdir(parents=True)
        for name, content in data.items():
            if name.endswith('.json.gz'):
                (destination / name.removesuffix('.gz')).write_bytes(content)
    print(json.dumps({'verifiedOriginalArtifacts': len(manifest['originals']), 'results': summaries}, indent=2))


if __name__ == '__main__':
    main()
