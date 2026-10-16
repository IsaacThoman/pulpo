#!/usr/bin/env python3
"""Read-only bounded verification of preserved R18 artifacts, not engine execution."""
import gzip
import hashlib
import json
import math
import statistics
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODES = ('en_US', 'es', 'en_es')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pairs(values):
    output = {}
    for key, value in values:
        require(key not in output, 'duplicate JSON key: ' + key)
        output[key] = value
    return output


def read(name):
    data = (ROOT / name).read_bytes()
    if name.endswith('.gz'):
        data = gzip.decompress(data)
    return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('nonfinite JSON: ' + value)))


def nfc(text):
    require(type(text) is str, 'expected text')
    return unicodedata.normalize('NFC', text)


def effort_length(text):
    text = nfc(text)
    require(all(c in "'’" or ('LATIN' in unicodedata.name(c, '') and c.isalpha()) for c in text), 'unsupported effort alphabet; frozen Latin/apostrophe fragments only')
    return len(text)


def validate_row(row, item, mode):
    require(row['input'] == item and row['stack'] == mode, 'row input/stack mismatch')
    tail = []
    for character in reversed(item['before']):
        if character.isalpha() or unicodedata.combining(character) or character in "'’":
            tail.append(character)
        else:
            break
    prefix = ''.join(reversed(tail))
    require(row['prefix'] == prefix, 'recorded prefix mismatch: ' + item['id'])
    stem = item['before'][:-len(prefix)] if prefix else item['before']
    first = item['after'][:1]
    separator = '' if first and (first.isspace() or unicodedata.category(first).startswith('P')) else ' '
    expected = stem + item['target'] + separator + item['after']
    require(row['expectedDocument'] == expected, 'expected document mismatch: ' + item['id'])
    require(type(row['choices']) is list and len(row['choices']) <= 3, 'invalid displayed slots')
    for choice in row['choices']:
        for field in ('text', 'kind', 'document'):
            require(type(choice[field]) is str, 'invalid choice text/kind/document')
        for field in ('automatic', 'exactOutcome', 'deletionUndoRestores'):
            require(type(choice[field]) is bool, 'choice flag must be Boolean')
        require(choice['exactOutcome'] == (choice['document'].encode() == expected.encode()), 'stale exactOutcome')
        require(type(choice['personalCount']) is int and choice['personalCount'] >= 0, 'invalid choice learning count')
    matching = [choice for choice in row['choices'] if nfc(choice['text']) == nfc(item['target'])]
    accepted = any(choice['exactOutcome'] for choice in matching)
    suffix = effort_length(item['target']) - effort_length(prefix)
    useful = item['kind'] == 'completion' and nfc(item['target']).startswith(nfc(prefix)) and suffix >= 3 and accepted
    saved = max(0, suffix - 1) if useful else 0
    literal_space = item['before'] + ('' if item['after'][:1].isspace() else ' ') + item['after']
    unwanted = item['kind'] != 'typo' and nfc(row['spaceDocument']) != nfc(literal_space)
    for field, value in [('displayedTarget', bool(matching)), ('acceptedTarget', accepted), ('useful', useful), ('spaceUnwantedReplacement', unwanted)]:
        require(type(row[field]) is bool and row[field] == value, 'stale/invalid ' + field)
    require(type(row['saved']) is int and row['saved'] == saved, 'stale/invalid saved effort')
    for field in ('targetInLexicon', 'targetCorrectable'):
        require(type(row[field]) is bool, 'membership flag must be Boolean')
    require(type(row['personalCount']) is int and row['personalCount'] >= 0, 'invalid learning count')
    require(type(row['backspaceDocument']) is str and (row.get('automatic') is None or type(row['automatic']) is str), 'invalid automatic/backspace text')
    timings = [row['firstMicroseconds']] + row['warmMicroseconds']
    require(len(row['warmMicroseconds']) == 10, 'missing warm samples')
    require(all(type(value) in (int, float) and math.isfinite(value) and value >= 0 for value in timings), 'invalid timing')
    if item['kind'] == 'private':
        require(row['personalCount'] == 0 and all(choice['personalCount'] == 0 for choice in row['choices']), 'private learning violation')


def totals(rows):
    rows = [row for row in rows if row['input']['kind'] == 'completion']
    output = {'n': len(rows)}
    for result, field in [('targetInLexicon', 'targetInLexicon'), ('displayed', 'displayedTarget'), ('accepted', 'acceptedTarget'), ('useful', 'useful'), ('saved', 'saved'), ('unwantedSpaceOutcomes', 'spaceUnwantedReplacement')]:
        output[result] = sum(row[field] for row in rows)
    for field in ('firstMicroseconds', 'warmMicroseconds'):
        values = sorted(value for row in rows for value in (row[field] if type(row[field]) is list else [row[field]]))
        output[field] = {'n': len(values), 'median': statistics.median(values), 'p95': values[math.ceil(len(values)*.95)-1], 'maximum': max(values)} if values else {}
    return output


def main():
    manifest = read('manifest.json')
    originals = {}
    for artifact in manifest['artifacts']:
        path = ROOT / artifact['path']
        data = path.read_bytes()
        require(hashlib.sha256(data).hexdigest() == artifact['sha256'], 'stored SHA256 mismatch: ' + path.name)
        if 'decompressedSHA256' in artifact:
            plain = gzip.decompress(data)
            require(hashlib.sha256(plain).hexdigest() == artifact['decompressedSHA256'], 'decompressed SHA256 mismatch')
            require(data[4:8] == bytes(4) and gzip.compress(plain, mtime=0) == data, 'nondeterministic gzip')
            data = plain
        originals[artifact['originalPath']] = data
    for path, digest in read('frozen-sha256.json').items():
        if path in originals:
            data = originals[path]
        else:
            result = subprocess.run(['git', 'show', manifest['base'] + ':' + path], cwd=ROOT, capture_output=True)
            if result.returncode:
                print('Unavailable external frozen Git hash (not claimed verified):', path)
                continue
            data = result.stdout
        require(hashlib.sha256(data).hexdigest() == digest, 'original frozen SHA256 mismatch: ' + path)
    for report, corpus in [('development-rejected-paired.json.gz', 'development.json'), ('controls-rejected-paired.json.gz', 'controls.json'), ('heldout-rejected-paired.json.gz', 'heldout.json'), ('heldout-selected-paired.json.gz', 'heldout.json')]:
        inputs = read(corpus)['cases']
        require(all(type(item) is dict and set(item) == {'id', 'language', 'before', 'after', 'target', 'kind'} and all(type(value) is str for value in item.values()) for item in inputs), 'invalid static input schema')
        require(all(item['kind'] in ('completion', 'literal', 'typo', 'private') for item in inputs), 'unknown case kind')
        cases = {item['id']: item for item in inputs}
        require(len(cases) == len(inputs), 'duplicate input IDs')
        expected = {(identity, mode) for identity in cases for mode in MODES}
        paired = read(report)
        rows = paired['paired']
        require(len(rows) == len(expected) and {(pair['id'], pair['stack']) for pair in rows} == expected, 'missing/duplicate/extra ID×stack pair')
        for pair in rows:
            for version in ('baseline', 'candidate'):
                validate_row(pair[version], cases[pair['id']], pair['stack'])
            a, b = pair['baseline'], pair['candidate']
            signature = lambda row: [(choice['text'], choice['kind'], choice['automatic']) for choice in row['choices']]
            require(pair['displayChanged'] == (signature(a) != signature(b)), 'stale displayChanged')
            require(pair['automaticChanged'] == (a.get('automatic') != b.get('automatic')), 'stale automaticChanged')
            require(pair['savedDelta'] == b['saved'] - a['saved'], 'stale savedDelta')
        for version in ('baseline', 'candidate'):
            for mode in ('all',) + MODES:
                observed = [pair[version] for pair in rows if mode == 'all' or pair['stack'] == mode]
                require(totals(observed) == paired[version][mode], 'aggregate mismatch: ' + report + '/' + version + '/' + mode)
        if report == 'heldout-rejected-paired.json.gz':
            require(hashlib.sha256((ROOT / 'heldout.json').read_bytes()).hexdigest() == 'dea3ae6f64ee681557961999c0ad28b71b28ea4aae100712886c688df05c2f4e', 'heldout seal mismatch')
            for version in ('baseline', 'candidate'):
                secondary = totals([pair[version] for pair in rows if pair['id'] != 'hold-01'])
                require((secondary['n'], secondary['displayed'], secondary['accepted'], secondary['useful'], secondary['saved']) == (33, 8, 4, 4, 16), 'secondary provenance accounting mismatch')
        print(report + ': hashes, complete inputs, exact choices, usefulness/savings and aggregates valid')
    print('Artifact verification passed; no engine execution or general Unicode/Undo/lexicon proof claimed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, OverflowError) as error:
        print('INVALID:', error, file=sys.stderr)
        sys.exit(1)
