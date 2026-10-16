#!/usr/bin/env python3
"""Verify portable R36 evidence; compile only the frozen segmentation helper.

Never execute the query implementation, app, benchmark observer or historical binaries.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
SOURCE = 'apps/keyboard-ios/PulpoKeyboardKit/'
PACKET = 'apps/keyboard-ios/audits/emoji-query-cap-r36/'
SOURCE_MAP = {
    SOURCE + 'Sources/KeyboardCore/Emoji/EmojiSearch.swift': 'snapshots/candidate-EmojiSearch.swift.txt',
    SOURCE + 'Tests/KeyboardCoreTests/EmojiSearchTests.swift': 'snapshots/candidate-EmojiSearchTests.swift.txt',
    SOURCE + 'Sources/KeyboardCore/Emoji/EmojiCatalog.swift': 'snapshots/shared-EmojiCatalog.swift.txt',
}
LOCAL_FROZEN = ['contract.md', 'schema.json', 'measure.swift.txt', 'compare.py', 'segment.swift.txt',
                'source-review.md', 'source-review-receipt.json', 'core-validation.json',
                'repaired-smoke-receipt.json', 'integrity-receipt.json']
EXPECTED_OPS = {'init': 16, 'append': 54, 'backspace': 20, 'deleteWords': 22, 'clear': 11}


def require(value, message):
    if not value:
        raise ValueError(message)


def load(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'{path.name}: duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid JSON constant: ' + value)))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(name):
    require(type(name) is str and name and '\\' not in name, 'Invalid local path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and path.as_posix() == name and all(p not in ('.', '..') for p in path.parts),
            'Unsafe local path: ' + name)
    target = ROOT.joinpath(*path.parts)
    require(target.resolve().is_relative_to(ROOT), 'Path escapes packet')
    require(not any(p.is_symlink() for p in [target, *target.parents] if p != ROOT.parent), 'Symlink in packet path')
    return target


def verify(git_path=None):
    manifest = load(ROOT / 'manifest.json')
    require(type(manifest) is dict and set(manifest) == {'version', 'initialPacket', 'baseline', 'candidate', 'files', 'initialPacketBindings'},
            'Manifest fields')
    require(type(manifest['version']) is int and manifest['version'] == 1, 'Manifest version')
    require((manifest['initialPacket'], manifest['baseline'], manifest['candidate']) == ('e59d5bf1', '975c5f83', '1e84fc39'),
            'Historical reference identity')
    require(type(manifest['files']) is list and manifest['files'], 'Manifest files')
    names = set()
    for entry in manifest['files']:
        require(type(entry) is dict and set(entry) == {'path', 'bytes', 'sha256', 'origin'}, 'Manifest entry fields')
        name = entry['path']
        require(type(name) is str and name not in names and name != 'manifest.json', 'Duplicate/self manifest entry')
        names.add(name)
        require(type(entry['bytes']) is int and entry['bytes'] >= 0 and type(entry['sha256']) is str
                and re.fullmatch('[0-9a-f]{64}', entry['sha256']), 'Manifest size/hash type')
        require(type(entry['origin']) is dict, 'Manifest origin')
        path = local(name)
        require(path.is_file() and path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'], 'Local artifact hash: ' + name)
    paths = list(ROOT.rglob('*'))
    require(not any(p.is_symlink() for p in paths), 'Symlink in packet')
    actual = {p.relative_to(ROOT).as_posix() for p in paths if p.is_file() and p != ROOT / 'manifest.json'}
    require(actual == names, 'Missing/unlisted packet files')

    freeze = load(local('freeze.json'))
    mapping = {**SOURCE_MAP, **{PACKET + n: n for n in LOCAL_FROZEN}}
    require(type(freeze['files']) is dict and len(freeze['files']) == 13 and set(freeze['files']) == set(mapping), 'Thirteen-file freeze coverage')
    for original, destination in mapping.items():
        record = freeze['files'][original]
        require(type(record) is dict and set(record) == {'bytes', 'sha256'} and type(record['bytes']) is int, 'Frozen record type')
        require(local(destination).stat().st_size == record['bytes'] and sha(local(destination)) == record['sha256'], 'Frozen artifact: ' + original)
    require(sha(local('snapshots/baseline-EmojiSearch.swift.txt')) == freeze['baselineQuerySourceSHA256'] == freeze['compiledBaselineSourceSHA256'], 'Baseline source snapshot')
    require(sha(local('snapshots/candidate-EmojiSearch.swift.txt')) == freeze['candidateQuerySourceSHA256'], 'Candidate source snapshot')
    require(sha(local('measure.swift.txt')) == freeze['compiledObserverSHA256'], 'Compiled observer source binding')
    require(freeze['revealPerformed'] is False, 'Freeze must record pre-reveal state')

    bindings = manifest['initialPacketBindings']
    require(type(bindings) is list and len(bindings) == 8, 'Initial packet coverage')
    require(len({b['sourcePath'] for b in bindings}) == 8, 'Duplicate initial packet paths')
    for binding in bindings:
        require(set(binding) == {'sourcePath', 'localPath', 'sha256'} and binding['sourcePath'].startswith(PACKET), 'Initial packet binding')
        require(sha(local(binding['localPath'])) == binding['sha256'], 'Initial packet bytes')

    author = load(local('author-receipt.json'))
    validator = load(local('validator-receipt.json'))
    digest = sha(local('heldout.json'))
    require(digest == freeze['sealedInputSHA256'] == author['payloadSHA256'], 'Sealed author payload binding')
    require(sha(local('validator-receipt.json')) == freeze['independentValidatorReceiptSHA256'], 'Sealed validator receipt binding')
    require(validator['bindings'] == {'contractSHA256': sha(local('contract.md')), 'schemaSHA256': sha(local('schema.json')),
                                    'payloadSHA256': digest, 'authorReceiptSHA256': sha(local('author-receipt.json'))}, 'Validator author/input bindings')
    require(author['bindings'] == {k: validator['bindings'][k] for k in ['contractSHA256', 'schemaSHA256']}, 'Author contract bindings')
    require(validator['verdict'] == 'VALID' and validator['oracleIssues'] == [] and validator['oracleAmbiguities'] == 0, 'Sealed oracle verdict')
    for receipt in [author, validator]:
        require((receipt['cases'], receipt['initialCheckpoints'], receipt['actionCheckpoints'], receipt['totalCheckpoints']) == (16, 16, 107, 123), 'Author/validator checkpoint counts')
        require(receipt['operationCoverage'] == EXPECTED_OPS, 'Author/validator operation coverage')
    require(author['distinctFamilies'] == validator['distinctFamilyLabels'] == 16, 'Family label counts')

    run = load(local('run-receipt.json'))
    require(run['freezeCommit'].startswith(manifest['candidate']) and run['inputSHA256'] == digest, 'Evaluation freeze/input binding')
    require(type(run['runs']) is list and len(run['runs']) == 2 and {r['version'] for r in run['runs']} == {'baseline', 'candidate'}, 'Both evaluation outputs')
    for row in run['runs']:
        require(type(row['exitCode']) is int and row['exitCode'] == 0 and sha(local(row['version'] + '-outcomes.json')) == row['outputSHA256'], 'Evaluation output digest/exit')

    # Import only the checked, frozen comparator. Its helper compiles Foundation
    # String segmentation, never the source snapshots or benchmark observer.
    spec = importlib.util.spec_from_file_location('r36_frozen_compare', local('compare.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = module.load(local('heldout.json'))
    baseline = module.load(local('baseline-outcomes.json'))
    candidate = module.load(local('candidate-outcomes.json'))
    report = module.compare(fixture, baseline, candidate, digest)
    require((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode() == local('comparison.json').read_bytes(), 'Full frozen comparison differs')
    operations = collections.Counter(row['op'] for row in report['rows'])
    require(len(fixture['cases']) == len({c['family'] for c in fixture['cases']}) == 16 and len(report['rows']) == 123 and dict(operations) == EXPECTED_OPS, 'All case/family/checkpoint/operation coverage')
    require(report['transitions'] == {'pass-to-pass': 98, 'pass-to-fail': 0, 'fail-to-pass': 25, 'fail-to-fail': 0}, 'All checkpoint transitions')
    require(report['baselinePassedCases'] == 9 and report['candidatePassedCases'] == 16 and report['acceptance'] is True
            and type(report['unavailableCheckpointsDropped']) is int and report['unavailableCheckpointsDropped'] == 0, 'Full acceptance/denominator')
    improved = {row['id'] for row in report['rows'] if row['transition'] == 'fail-to-pass'}
    require(len(improved) == 7, 'Improved case count')
    changed = [row for row in report['rows'] if row['baseline'] != row['candidate']]
    changed_cases = dict(collections.Counter(row['id'] for row in changed))
    over_capacity = sum(row['baseline']['characters'] > 40 for row in report['rows'])
    post = load(local('post-evaluation-review-receipt.json'))
    require(len(changed) == 25 and over_capacity == 16 and all(row['transition'] == 'fail-to-pass' for row in changed), 'All changed raw states')
    require(post['inputSHA256'] == digest and post['transitions'] == report['transitions'] and post['changedCases'] == changed_cases
            and post['changedCheckpointCount'] == len(changed) and post['baselineOverCapacityStates'] == over_capacity
            and post['mismatches'] == 0 and post['frozenFileCount'] == 13 and post['frozenBinaryCount'] == 2, 'Independent post-review bindings/counts')

    smoke = module.load(local('smoke.json'))
    module.validate_fixture(smoke, smoke=True)
    sb = module.load(local('smoke-repaired-baseline.json'))
    sc = module.load(local('smoke-repaired-candidate.json'))
    smoke_digest = sha(local('smoke.json'))
    module.observations(smoke, sb, smoke_digest)
    module.observations(smoke, sc, smoke_digest)
    counts = module.character_counts(smoke, sb, sc)
    for observed in [sb, sc]:
        states = module.observations(smoke, observed, smoke_digest, counts)
        require(len(states) == 19 and all(s['passed'] for s in states)
                and {s['op'] for s in states} == set(EXPECTED_OPS), 'Repaired all-operation smoke')
    historical = load(local('smoke-receipt.json'))
    require(historical['checkpoints'] == historical['passed'] == 19 and historical['fixtureSHA256'] == smoke_digest
            and historical['outputSHA256'] == sha(local('smoke-baseline.json'))
            and historical['executorSHA256'] == sha(local('historical/measure.swift.txt')), 'Initial historical smoke receipt')
    integrity = load(local('integrity-receipt.json'))
    require(len(integrity['checks']) == 16 and sum(c['accepted'] is False for c in integrity['checks']) == 14
            and all(type(c['accepted']) is bool for c in integrity['checks']), 'Fourteen pre-freeze root integrity rejections')
    peer = load(local('snapshots/repaired-comparator-probes.json.txt'))
    require(len(peer['rejections']) == 3 and peer['positiveAccepted'] is True and peer['observedOverflowAccepted'] is False, 'Pre-freeze peer repair probes')

    if git_path is not None:
        repo = subprocess.check_output(['git', '-C', str(Path(git_path).resolve()), 'rev-parse', '--show-toplevel'], text=True).strip()
        def git_bytes(ref, path):
            return subprocess.check_output(['git', '-C', repo, 'show', ref + ':' + path])
        for entry in manifest['files']:
            origin = entry['origin']
            if 'gitRef' in origin:
                require(hashlib.sha256(git_bytes(origin['gitRef'], origin['gitPath'])).hexdigest() == entry['sha256'], 'Historical Git artifact: ' + entry['path'])
        for binding in bindings:
            require(hashlib.sha256(git_bytes(manifest['initialPacket'], binding['sourcePath'])).hexdigest() == binding['sha256'], 'Initial Git packet bytes')
        catalog = SOURCE + 'Sources/KeyboardCore/Emoji/EmojiCatalog.swift'
        require(git_bytes(manifest['baseline'], catalog) == local('snapshots/shared-EmojiCatalog.swift.txt').read_bytes(), 'Catalog unchanged across both source compiles')
        print('Optional historical Git bindings match; no current production files inspected')
    print('VALID: all local hashes, 13 frozen files, author/validator/output bindings')
    print('16 cases; 123 checkpoints: 98 pass-to-pass, 25 fail-to-pass, zero losses; 7 improved cases')
    print('19 repaired smoke checkpoints pass per version; pre-freeze integrity receipts preserved')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--git', nargs='?', const='.', metavar='PATH', help='optionally verify immutable source/history refs from a path inside the repository')
    verify(parser.parse_args().git)
