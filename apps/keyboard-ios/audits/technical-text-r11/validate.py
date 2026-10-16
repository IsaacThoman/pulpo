#!/usr/bin/env python3
"""Validate preserved bytes and recorded outcomes without running inference."""
import gzip
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    path = ROOT / name
    data = gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes()
    return json.loads(data)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    manifest = read('manifest.json')
    for artifact in manifest['artifacts']:
        data = (ROOT / artifact['path']).read_bytes()
        require(len(data) == artifact['bytes'], artifact['path'] + ': size')
        require(hashlib.sha256(data).hexdigest() == artifact['sha256'], artifact['path'] + ': SHA256')
        if 'decompressedSHA256' in artifact:
            require(data[4:8] == bytes(4), artifact['path'] + ': gzip timestamp')
            plain = gzip.decompress(data)
            require(len(plain) == artifact['decompressedBytes'], artifact['path'] + ': plain size')
            require(hashlib.sha256(plain).hexdigest() == artifact['decompressedSHA256'], artifact['path'] + ': plain SHA256')
            require(gzip.compress(plain, mtime=0) == data, artifact['path'] + ': deterministic gzip')

    for split, count, expected_scores in [('development', 68, (48, 63)), ('heldout', 40, (27, 30))]:
        cases = read('inputs/' + split + '.json')
        require(len(cases) == count and len({x['id'] for x in cases}) == count, split + ': cases')
        require(all(x['bilingual'] is True for x in cases), split + ': dictionary mode')
        by_id = {x['id']: x for x in cases}
        reports = [read('reports/' + split + '-' + version + '.json.gz') for version in ['baseline', 'candidate']]
        for report, score in zip(reports, expected_scores):
            require(len(report) == count and {x['id'] for x in report} == set(by_id), split + ': report IDs')
            require(len({x['id'] for x in report}) == count, split + ': duplicate rows')
            for row in report:
                case = by_id[row['id']]
                require(row['expected'] == case['expected'], row['id'] + ': oracle')
                require(row['category'] == case['category'] and row['language'] == case['language'], row['id'] + ': metadata')
                require(row['correct'] == (row['output'] == case['expected']), row['id'] + ': exact')
                require(row['literalAdapterMatches'] == (row['rawOutput'] == case['before'] + case['typed'] + case['after']), row['id'] + ': raw')
                require(all(math.isfinite(t) and t >= 0 for t in row['keyMilliseconds']), row['id'] + ': timing')
            require(sum(x['correct'] for x in report) == score, split + ': score')
        baseline = {x['id']: x for x in reports[0]}
        require(not any(baseline[x['id']]['correct'] and not x['correct'] for x in reports[1]), split + ': unexpected original regression')

    draft, heldout = read('inputs/heldout-draft.json'), read('inputs/heldout.json')
    changes = [(a['id'], [k for k in a if a[k] != b[k]]) for a, b in zip(draft, heldout) if a != b]
    require(len(changes) == 11 and all(keys == ['intention'] for _, keys in changes), 'heldout metadata changes')
    cases = read('diagnostic/cases.json')
    baseline, candidate = [read('diagnostic/' + version + '.json.gz') for version in ['baseline', 'candidate']]
    require(len(cases) == len(baseline) == len(candidate) == 56, 'diagnostic count')
    require(len({x['id'] for x in cases}) == 56, 'diagnostic unique IDs')
    regressions = 0
    spelling = [0, 0]
    for case, a, b in zip(cases, baseline, candidate):
        require(case['id'] == a['id'] == b['id'], 'diagnostic order/IDs')
        for index, row in enumerate([a, b]):
            require(row['expected'] == case['expected'] and row['exact'] == (row['output'] == case['expected']), case['id'] + ': diagnostic oracle')
            intended = case.get('expectedCorrection')
            if intended and row.get('finalCommitCorrection', '').casefold() == intended.casefold():
                spelling[index] += 1
        regressions += a['exact'] and not b['exact']
    require([sum(x['exact'] for x in r) for r in [baseline, candidate]] == [37, 44], 'diagnostic exact scores')
    require(regressions == 4 and spelling == [48, 36], 'diagnostic regressions/spelling')
    freeze = read('diagnostic/freeze.json')
    for name, digest in freeze['hashes'].items():
        require(hashlib.sha256((ROOT / 'diagnostic' / name).read_bytes()).hexdigest() == digest, 'diagnostic input freeze')
    require(hashlib.sha256((ROOT / 'diagnostic/Client.swift').read_bytes()).hexdigest() == freeze['clientSHA256'], 'diagnostic client freeze')
    print('Preserved hashes/gzip, 108 original rows, 56 diagnostic rows and unchanged heldout metadata/oracles validated.')


if __name__ == '__main__':
    main()
