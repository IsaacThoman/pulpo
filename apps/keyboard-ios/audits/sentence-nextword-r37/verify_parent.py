#!/usr/bin/env python3
"""Verify the immutable rejected packet; optionally check historical Git blobs.

No model, compiler, device or unopened workload is executed. Checks remain enabled
under Python -O. The original verifier is retained verbatim as historical tooling.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
MANIFEST_SHA256 = 'e16dfde9c816090822cccaf8b0a8e8cde38d0c29ce077ffac5af939530d01400'
BASELINE = '975c5f838db2c511a099136fda28d908b71dda6d'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(name):
    path = HERE / name
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if name.endswith('.gz') else data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--git', type=Path, help='Check baseline historical blobs, not current production.')
    args = parser.parse_args()
    manifest = HERE / 'manifest.json'
    require(not manifest.is_symlink() and sha(manifest.read_bytes()) == MANIFEST_SHA256, 'manifest changed')
    files = load('manifest.json')['files']
    require(len(files) == 57, 'original manifest must retain all 57 files')
    for name, expected in files.items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'unsafe artifact path')
        path = HERE / relative
        require(path.resolve().is_relative_to(HERE) and not path.is_symlink(), 'artifact escapes packet')
        actual = path.read_bytes()
        require(len(actual) == expected['bytes'] and sha(actual) == expected['sha256'], f'changed artifact: {name}')

    # Only import the original comparator after authenticating its local bytes.
    sys.path.insert(0, str(HERE))
    from compare import compare
    for cohort, prompts, hits, changed_failed in [('independent', 36, 12, 0), ('fallback', 16, 10, 2)]:
        baseline, candidate = [load(f'strict-{cohort}-{version}.json.gz') for version in ['baseline', 'candidate']]
        report = compare(baseline, candidate)
        require(baseline['cohort'] == candidate['cohort'] == 'development', 'not development')
        require(baseline['rowCount'] == candidate['rowCount'] == prompts * 3, 'incomplete cohort')
        require(not report['gains'] and not report['losses'] and report['biGainPercentagePoints'] == 0, 'utility changed')
        require(not report['executorAndUtilityPass'] and not report['safetyFailures'], 'rejection/safety changed')
        require(not baseline['failures'] and not candidate['failures'], 'executor failures')
        require(report['denominators']['en_es']['baselineHits'] == report['denominators']['en_es']['candidateHits'] == hits, 'hit counts changed')
        require(len(report['changedFailedOutputs']) == changed_failed, 'changed failed rows omitted')
        for raw in [baseline, candidate]:
            for row in raw['rows']:
                exact_hit = any(s['text'] in row['acceptable'] for s in row['initialSlots'])
                require(type(row['top3Hit']) is bool and row['top3Hit'] == exact_hit, 'incorrect target hit')
                require(len(row['acceptance']) == 3, 'missing real suggestion acceptance branches')
    smoke = load('strict-smoke-candidate.json.gz')
    require(smoke['rowCount'] == 39 and not smoke['failures'], 'smoke changed')
    require(load('closure.json')['finalFreshRowsExecuted'] == 0, 'unexpected final fresh execution')
    if args.git:
        repo = subprocess.check_output(['git', '-C', str(args.git), 'rev-parse', '--show-toplevel'], text=True).strip()
        for path, expected in load('restoration.json')['baselineSHA256'].items():
            original = subprocess.check_output(['git', '-C', repo, 'show', BASELINE + ':' + path])
            require(sha(original) == expected, f'historical baseline mismatch: {path}')
    print('Verified 57 original files, 156 paired development rows/version, zero gains/losses, 39 smoke rows; no final fresh execution.')


if __name__ == '__main__':
    main()
