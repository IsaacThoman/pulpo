#!/usr/bin/env python3
"""Verify retained R12 evidence or compare complete, case-bound replay outputs."""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def observations(path, split):
    cases = read_json(ROOT / 'inputs' / f'{split}.json')
    by_id = {case['id']: case for case in cases}
    require(len(cases) == len(by_id) == 144, f'{split}: invalid case IDs')
    expected = {(case['id'], profile) for case in cases
                for profile in ([0] if case['kind'] == 'literal' else [0, 1, 2])}
    rows = read_json(path)
    require(len(rows) == len(expected) == 360
            and {(row['id'], row['profile']) for row in rows} == expected,
            f'{path}: missing, duplicate, or unexpected observation')
    for row in rows:
        case = by_id[row['id']]
        require(all(row[key] == case[key] for key in ['language', 'target', 'kind']),
                f'{path}: changed case identity {row["id"]}')
        raw = case['context'] + case['target']
        require(row['expectedRaw'] == raw and row['expectedFinal'] == raw + ' ',
                f'{path}: changed expected document {row["id"]}')
        require(all(type(row[key]) is bool for key in
                    ['exactDocument', 'candidateTarget', 'slotTarget', 'phantomSpace']),
                f'{path}: invalid observation flags')
        require(all(isinstance(row[key], str) for key in ['rawDocument', 'finalDocument'])
                and all(isinstance(row[key], list) and all(isinstance(word.get('text'), str)
                                                         for word in row[key])
                        for key in ['decoder', 'engineCandidates', 'slots']),
                f'{path}: invalid document/candidate data')
        exact = (row['rawDocument'] == raw and row['finalDocument'] == raw + ' '
                 and (case['kind'] == 'literal' or row['phantomSpace']))
        require(row['exactDocument'] == exact, f'{path}: incorrect document score')
        require(row['candidateTarget'] == any(word['text'] == case['target'] for word in row['decoder'])
                and row['slotTarget'] == any(word['text'] == case['target'] for word in row['slots']),
                f'{path}: incorrect returned/slotted score')
        if case['kind'] in ['privacy', 'secure']:
            require(row['initialPersonalCount'] == row['finalPersonalCount'],
                    f'{path}: privacy learning changed')
    return {(row['id'], row['profile']): row for row in rows}


def compare(split, baseline=None, candidate=None):
    before = observations(baseline or ROOT / 'reports' / f'baseline-{split}.json.gz', split)
    after = observations(candidate or ROOT / 'reports' / f'candidate-{split}.json.gz', split)
    groups = {}
    losses, gains = [], []
    for key, row in before.items():
        other = after[key]
        group = groups.setdefault(f'{row["language"]}/{row["kind"]}', collections.Counter())
        group['observations'] += 1
        for label, value in [('baseline', row), ('rejected', other)]:
            for field in ['candidateTarget', 'exactDocument', 'slotTarget']:
                group[f'{label}.{field}'] += value[field]
        if row['exactDocument'] != other['exactDocument']:
            change = dict(id=row['id'], profile=row['profile'], language=row['language'],
                          kind=row['kind'], target=row['target'],
                          before=row['finalDocument'], after=other['finalDocument'])
            (losses if row['exactDocument'] else gains).append(change)
    return dict(split=split, groups=groups, targetDocumentLosses=losses,
                targetDocumentGains=gains,
                interpretation='Target matches, not suppression-policy successes. '
                'Secure engine rejection is intentional; inspect groups separately.')


def verify():
    manifest = read_json(ROOT / 'retained-manifest.json')
    for name, entry in manifest.items():
        data = (ROOT / name).read_bytes()
        require(len(data) == entry['bytes'] and hashlib.sha256(data).hexdigest() == entry['sha256'],
                f'Retained artifact changed: {name}')
        if 'originalSHA256' in entry:
            original = gzip.decompress(data)
            require(len(original) == entry['originalBytes']
                    and hashlib.sha256(original).hexdigest() == entry['originalSHA256'],
                    f'Compressed original changed: {name}')
    original_manifest = read_json(ROOT / 'original' / 'artifact-manifest.json')
    for label in ['baseline', 'candidate']:
        for split in ['dev', 'heldout']:
            name = f'{label}-{split}.json'
            data = gzip.decompress((ROOT / 'reports' / (name + '.gz')).read_bytes())
            require(hashlib.sha256(data).hexdigest() == original_manifest[name]['sha256'],
                    f'Original report hash mismatch: {name}')
            observations(ROOT / 'reports' / (name + '.gz'), split)
    require(hashlib.sha256((ROOT / 'original' / 'candidate-freeze.json').read_bytes()).hexdigest()
            == read_json(ROOT / 'original' / 'heldout-reveal.json')['candidateFreezeSHA256'],
            'Candidate freeze/reveal mismatch')
    require(hashlib.sha256((ROOT / 'inputs' / 'heldout.json').read_bytes()).hexdigest()
            == read_json(ROOT / 'original' / 'candidate-freeze.json')['heldoutSealed']['sha256'],
            'Held-out seal mismatch')
    print(f'Verified {len(manifest)} retained files, four original report hashes, '
          'and all 1,440 case/profile observations. No inference ran.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('verify')
    comparison = commands.add_parser('compare')
    comparison.add_argument('--split', choices=['dev', 'heldout'], required=True)
    comparison.add_argument('--baseline', type=Path)
    comparison.add_argument('--candidate', type=Path)
    args = parser.parse_args()
    if args.command == 'verify':
        verify()
    else:
        print(json.dumps(compare(args.split, args.baseline, args.candidate),
                         ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
