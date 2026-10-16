#!/usr/bin/env python3
"""Bounded, read-only verification of archived R19 official reports, not inference."""
import gzip
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODES = ('en', 'es', 'bi')
PREFIX = 'apps/keyboard-ios/audits/technical-preservation-r19/'


def require(value, message):
    if not value:
        raise ValueError(message)


def pairs(values):
    result = {}
    for key, value in values:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('nonfinite JSON: ' + value)))


def state(row):
    return {'output': row['output'], 'finalState': row['finalState'],
            'snapshots': [{key: value for key, value in snapshot.items() if key != 'milliseconds'} for snapshot in row['snapshots']]}


def snapshot(value, final=False):
    require(type(value) is dict and type(value['document']) is str, 'missing/invalid snapshot')
    for field in ('cursor', 'selected', 'personalCount'):
        require(type(value[field]) is int and value[field] >= 0, 'invalid state ' + field)
    for field in ('undoAvailable', 'learns', 'autocorrects'):
        require(type(value[field]) is bool, 'invalid state Boolean')
    for field in ('touchWeight', 'milliseconds'):
        require(type(value[field]) in (int, float) and math.isfinite(value[field]) and value[field] >= 0, 'invalid state number')
    for field in ('alternatives', 'learned'):
        require(type(value[field]) is list and all(type(text) is str for text in value[field]), 'invalid state text array')
    require(type(value['learnedCounts']) is dict and all(type(count) is int and count >= 0 for count in value['learnedCounts'].values()), 'invalid spelling counts')
    require(value.get('autocorrection') is None or type(value['autocorrection']) is str, 'invalid correction proposal')
    require(type(value['operation']) is int, 'invalid operation index')
    if final:
        require(value['operation'] == -1 and value['milliseconds'] == 0, 'invalid final state marker')


def main():
    manifest = decode((ROOT / 'manifest.json').read_bytes())
    raw, original = {}, {}
    for artifact in manifest['artifacts']:
        data = (ROOT / artifact['path']).read_bytes()
        require(hashlib.sha256(data).hexdigest() == artifact['sha256'], 'stored SHA256 mismatch: ' + artifact['path'])
        if 'decompressedSHA256' in artifact:
            plain = gzip.decompress(data)
            require(hashlib.sha256(plain).hexdigest() == artifact['decompressedSHA256'], 'decompressed SHA256 mismatch')
            require(data[4:8] == bytes(4) and gzip.compress(plain, mtime=0) == data, 'nondeterministic gzip')
            data = plain
        raw[artifact['logicalPath']] = data
        original[artifact['originalPath']] = data
    read = lambda name: decode(raw[name])
    freeze = read('candidate-freeze.json')
    for path, digest in freeze['frozenFiles'].items():
        require(path in original and hashlib.sha256(original[path]).hexdigest() == digest, 'frozen SHA256 mismatch: ' + path)
    for name, digest in [('heldout.json', freeze['sealedAuthorAnnouncement']['casesSHA256']), ('heldout-authorship.json', freeze['sealedAuthorAnnouncement']['authorshipSHA256'])]:
        require(hashlib.sha256(raw[name]).hexdigest() == digest, 'sealed SHA256 mismatch: ' + name)
    engine_path = 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'
    for path, digest in [(engine_path, freeze['baselineEngineSHA256'])] + [('apps/keyboard-ios/LanguageData/' + mode + '.pkdict', digest) for mode, digest in freeze['dictionaries'].items()]:
        result = subprocess.run(['git', 'show', freeze['baselineCommit'] + ':' + path], cwd=ROOT, capture_output=True)
        if result.returncode:
            print('Unavailable external frozen Git hash (not claimed verified):', path)
        else:
            require(hashlib.sha256(result.stdout).hexdigest() == digest, 'baseline source/dictionary SHA256 mismatch')
    checks = {item['report']: item for item in read('provenance-checks.json')['officialRunChecks']}
    definitions = [('selected-development', 'development', True), ('selected-development-state', 'development-state', True),
                   ('selected-review-diagnostics', 'review-diagnostics', True), ('selected-runner-negative-controls', 'runner-negative-controls', False), ('heldout', 'heldout', True)]
    for split, source, has_summary in definitions:
        corpus_name = source + '.json'
        cases = read(corpus_name)['cases']
        by_id = {case['id']: case for case in cases}
        require(len(by_id) == len(cases) and cases, 'empty/duplicate input IDs')
        expected_keys = {(identity, mode) for identity in by_id for mode in MODES}
        versions = []
        for version in ('baseline', 'candidate'):
            name = split + '-' + version + '.json'
            rows, metadata = read(name), read(name.removesuffix('.json') + '.metadata.json')
            require(len(rows) == len(expected_keys) and {(row['id'], row['mode']) for row in rows} == expected_keys, 'missing/duplicate/extra ID×mode row: ' + name)
            require(metadata['inputSHA256'] == hashlib.sha256(raw[corpus_name]).hexdigest(), 'input metadata hash mismatch')
            require(metadata['engineSHA256'] == freeze[version + 'EngineSHA256'], 'engine metadata hash mismatch')
            runner = 'apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/AnchoredGrammarReplayTests.swift'
            require(metadata['runnerSHA256'] == freeze['frozenFiles'][runner], 'runner metadata hash mismatch')
            require(type(metadata['sourceStableDuringRun']) is bool and metadata['sourceStableDuringRun'], 'unstable source metadata')
            require(type(metadata['exitCode']) is int and metadata['exitCode'] == 0, 'failed process metadata')
            require(metadata['templates'] == len(cases) and metadata['denominator'] == len(expected_keys), 'metadata denominator mismatch')
            require(checks[name]['reportSHA256'] == hashlib.sha256(raw[name]).hexdigest() and checks[name]['rows'] == len(rows), 'official report hash/count mismatch')
            for row in rows:
                case = by_id[row['id']]
                require(row['category'] == case['category'] and row['expected'] == case.get('expectedByMode', {}).get(row['mode'], case['expected']), 'changed category/oracle')
                require(type(row['correct']) is bool and type(row['output']) is str and type(row['oracleErrors']) is list and all(type(error) is str for error in row['oracleErrors']), 'invalid result fields')
                require(row['correct'] == (row['output'] == row['expected'] and not row['oracleErrors']), 'stale primary correctness')
                require(not row.get('unavailable'), 'official replay unavailable')
                snapshot(row['finalState'], final=True)
                require(row['finalState']['document'] == row['output'], 'final-state document mismatch')
                require(type(row['snapshots']) is list, 'missing snapshots')
                for value in row['snapshots']:
                    snapshot(value)
                    require(0 <= value['operation'] < len(case['operations']), 'out-of-range operation snapshot')
                require(type(row['keyMilliseconds']) is list and all(type(value) in (int, float) and math.isfinite(value) and value >= 0 for value in row['keyMilliseconds']), 'invalid key timing')
            versions.append({(row['id'], row['mode']): row for row in rows})
        baseline, candidate = versions
        summary = read(split + '.summary.json') if has_summary else None
        for mode in MODES:
            observed = [(baseline[identity, mode], candidate[identity, mode]) for identity in by_id]
            if summary:
                result = summary['modes'][mode]
                expected = {'denominator': len(cases), 'baselinePass': sum(a['correct'] for a, b in observed), 'candidatePass': sum(b['correct'] for a, b in observed),
                            'gains': [a['id'] for a, b in observed if not a['correct'] and b['correct']], 'regressions': [a['id'] for a, b in observed if a['correct'] and not b['correct']],
                            'ordinaryStateChanges': [a['id'] for a, b in observed if a['category'] == 'ordinary' and state(a) != state(b)]}
                require(all(result[key] == value for key, value in expected.items()), 'summary score/state mismatch: ' + split)
                for category in {case['category'] for case in cases}:
                    subset = [(a, b) for a, b in observed if a['category'] == category]
                    require(result['categories'][category] == {'rows': len(subset), 'baselinePass': sum(a['correct'] for a, b in subset), 'candidatePass': sum(b['correct'] for a, b in subset), 'regressions': [a['id'] for a, b in subset if a['correct'] and not b['correct']]}, 'category summary mismatch')
            else:
                require(all(not a['correct'] and a['oracleErrors'] and not b['correct'] and b['oracleErrors'] for a, b in observed), 'negative control accepted')
        if summary:
            require(summary['expectedDenominator'] == len(expected_keys) and summary['denominator'] == len(expected_keys) and not summary['missingBaseline'] and not summary['missingCandidate'] and not summary['unexpectedRows'], 'summary pairing mismatch')
            paired = [decode(line) for line in raw[split + '.paired.jsonl'].splitlines()]
            require(len(paired) == len(expected_keys) and {(row['id'], row['mode']) for row in paired} == expected_keys, 'paired JSONL incomplete')
            require(all(row['baseline'] == baseline[row['id'], row['mode']] and row['candidate'] == candidate[row['id'], row['mode']] for row in paired), 'paired JSONL differs from official arrays')
        print(split + ': complete rows, frozen metadata, primary flags, final states and recorded summaries verified')
        if split == 'heldout':
            require([sum(row['correct'] for row in rows.values()) for rows in versions] == [47, 71], 'sealed primary scores changed')
            require([sum(row['output'] == row['expected'] for row in rows.values()) for rows in versions] == [51, 77], 'document-only observations changed')
            require([sum(len(row['oracleErrors']) for row in rows.values()) for rows in versions] == [26, 24], 'oracle error counts changed')
            for rows in versions:
                safety = [row for row in rows.values() if row['category'] == 'safety']
                require(len(safety) == 12 and not any(row['correct'] for row in safety), 'unsupported sealed safety rows lost/accepted')
                require(sum(error == 'schema: unknown operation key expectState' for row in safety for error in row['oracleErrors']) == 21, 'unsupported assertion occurrences changed')
    print('All retained bytes and ten official reports verified; checkpoint execution and missing author-contract provenance are not independently proven.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, OverflowError) as error:
        print('INVALID:', error, file=sys.stderr)
        sys.exit(1)
