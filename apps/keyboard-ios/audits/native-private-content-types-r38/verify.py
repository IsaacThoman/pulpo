#!/usr/bin/env python3
"""Verify frozen artifacts and paired evidence. Does not rerun production code."""
import gzip, hashlib, json
from pathlib import Path

AUDIT = Path(__file__).resolve().parent
REPO = AUDIT.parents[3]


def payload(path):
    if path.exists():
        return path.read_bytes()
    compressed = Path(str(path) + '.gz')
    if compressed.exists():
        return gzip.decompress(compressed.read_bytes())
    raise FileNotFoundError(path)


def data(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def main():
    contract = data(AUDIT / 'contract-freeze.json')
    for name, digest in contract['hashes'].items():
        assert hashlib.sha256(payload(AUDIT / name)).hexdigest() == digest, name
    frozen = data(AUDIT / 'candidate-freeze.json')
    for name, digest in frozen['hashes'].items():
        assert hashlib.sha256(payload(REPO / name)).hexdigest() == digest, name
    sealed_input = None
    if (AUDIT / 'heldout-seal.json').exists():
        seal = data(AUDIT / 'heldout-seal.json')
        assert hashlib.sha256((AUDIT / 'candidate-freeze.json').read_bytes()).hexdigest() == seal['candidateFreezeSHA256']
        sealed_input = json.loads(payload(AUDIT / seal['input']))
        for name, digest in seal['hashes'].items():
            assert hashlib.sha256(payload(AUDIT / name)).hexdigest() == digest, name
    for resource in data(AUDIT / 'language-resources.json').values():
        assert hashlib.sha256((REPO / resource['path']).read_bytes()).hexdigest() == resource['sha256']
    scope = data(AUDIT / 'release-and-scope-checks.json')
    assert scope['fuzzer'], 'Missing fuzzer source checks'
    for name, check in scope['fuzzer'].items():
        assert check['unchanged'] and hashlib.sha256((REPO / name).read_bytes()).hexdigest() == check['sha256'], name
    manifest_path = AUDIT / 'manifest.json'
    if manifest_path.exists():
        for name, digest in data(manifest_path)['sha256'].items():
            assert hashlib.sha256((AUDIT / name).read_bytes()).hexdigest() == digest, name
    for platform in ['core', 'native']:
        bpath = AUDIT / f'heldout-{platform}-baseline.json.gz'
        cpath = AUDIT / f'heldout-{platform}-candidate.json.gz'
        if not bpath.exists():
            continue
        b, c = data(bpath), data(cpath)
        assert b['input'] == c['input'] == sealed_input
        assert b['platform'] == c['platform'] == platform
        for report in [b, c]:
            assert len(report['results']) == len(report['input']['cases']) * 3
            for row in report['results']:
                for step in row['steps']:
                    action = step['action']
                    if action.get('outcome') == 'unavailable':
                        assert action.get('explicitExpectedRefusal') is False
                    assert step['actual']['selection'][1] >= 0
    print('Frozen inputs, source/runner hashes, manifest and paired platform evidence verified.')


if __name__ == '__main__':
    main()
