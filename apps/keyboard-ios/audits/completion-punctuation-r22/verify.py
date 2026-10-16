#!/usr/bin/env python3
"""Bounded read-only verification of retained R22 bytes and stored synthetic rows."""
import argparse
import collections
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unicodedata

STACKS = ('en_US', 'es', 'en_es')
MODES = ('immediate', 'queued', 'ownLag', 'acknowledged', 'reentrant')
FLAGS = ('displayed', 'accepted', 'fullPass', 'suffixPreserved', 'literalDisplayed', 'literalExact',
         'literalUndo', 'deletionUndo', 'autoCaseExact', 'staleSelectionSafe', 'staleCaretSafe')
ENGINE = 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'
PREFIX = 'apps/keyboard-ios/audits/completion-punctuation-r22/'


def require(value, message):
    if not value:
        raise ValueError(message)


def object_pairs(values):
    result = {}
    for key, value in values:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result


def decode(data):
    value = json.loads(data, object_pairs_hook=object_pairs,
                       parse_constant=lambda text: (_ for _ in ()).throw(ValueError('nonfinite JSON: ' + text)))
    def finite(item):
        if type(item) is float:
            require(math.isfinite(item), 'nonfinite JSON number')
        elif type(item) is list:
            for child in item:
                finite(child)
        elif type(item) is dict:
            for child in item.values():
                finite(child)
    finite(value)
    return value


def size(text):
    # Exact for this archive's simple NFC characters and explicit U+0301 NFD fixture.
    # This deliberately is not a general Unicode grapheme segmentation implementation.
    require(type(text) is str and '\u200d' not in text and all(not unicodedata.combining(c) or c == '\u0301' for c in text),
            'unsupported grapheme fixture; add an explicit oracle')
    return len(text) - text.count('\u0301')


def state(value):
    require(type(value) is dict, 'missing state')
    for field in ('document', 'composing', 'shift', 'lastEdit'):
        require(type(value[field]) is str, 'invalid state ' + field)
    for field in ('caret', 'selection'):
        require(type(value[field]) is int and value[field] >= 0, 'invalid state ' + field)
    require(value['caret'] + value['selection'] <= size(value['document']), 'state range out of bounds')
    require(type(value['phantom']) is bool, 'invalid phantom state')


def exact(value, text, caret):
    return value is not None and value['document'].encode() == text.encode() and value['caret'] == caret and value['selection'] == 0


def row_check(row, item):
    require(type(row) is dict and row['target'] == item['target'] and row['category'] == item['category'], 'row input metadata mismatch')
    for field in FLAGS + ('targetInLexicon',):
        require(type(row[field]) is bool, 'invalid Boolean: ' + field)
    for field in ('privateSlots', 'privatePersonalCount', 'personalCount'):
        require(type(row[field]) is int and row[field] >= 0, 'invalid count: ' + field)
    require(row['privateSlots'] == row['privatePersonalCount'] == 0, 'private suppression/learning violation')
    require(type(row['suggestions']) is list and all(type(s) is str for s in row['suggestions']), 'invalid slots')
    require(row['displayed'] == any(s.split('|')[1] == item['target'] for s in row['suggestions']), 'stale displayed flag')
    require(row.get('autocorrection') is None or type(row['autocorrection']) is str, 'invalid automatic proposal')
    for field in ('firstMicroseconds', 'selectMicroseconds'):
        value = row.get(field)
        require((field == 'selectMicroseconds' and value is None) or (type(value) in (int, float) and math.isfinite(value) and value >= 0), 'invalid timing')
    for field in ('selected', 'literal', 'autoCase', 'autoCommit', 'autoBackspace'):
        if row.get(field) is not None:
            state(row[field])
    caret = item.get('expectedCaret', size(item['expectedAfter']) - size(item['suffix']))
    require(row['accepted'] == exact(row.get('selected'), item['expectedAfter'], caret), 'stale accepted flag')
    require(row['literalDisplayed'] == (row.get('literal') is not None), 'stale literal availability')
    sep = max(0, caret - size(item['before']) - size(item['target']))
    literal_text = item['before'] + item.get('literalPrefix', item['prefix']) + ' ' * sep + item['suffix']
    literal_caret = size(item['before']) + size(item.get('literalPrefix', item['prefix'])) + sep
    require(row['literalExact'] == exact(row.get('literal'), literal_text, literal_caret), 'stale literal exact flag')
    require(row['autoCaseExact'] == exact(row.get('autoCase'), item['expectedAfter'], caret), 'stale autoCase flag')
    expected = [('acknowledge', item['expectedAfter'], caret)] + [(s['action'], s['after'], s['caret']) for s in item.get('steps', [])]
    require(type(row['outcomes']) is list and len(row['outcomes']) == (len(expected) if row['displayed'] else 0), 'missing/extra follow-on outcomes')
    for outcome, (action, text, position) in zip(row['outcomes'], expected):
        require((outcome['action'], outcome['expected'], outcome['expectedCaret']) == (action, text, position), 'mutated outcome oracle')
        state(outcome['state'])
        require(type(outcome['exact']) is bool and outcome['exact'] == exact(outcome['state'], text, position), 'stale outcome flag')
    require(row['fullPass'] == (row['accepted'] and all(o['exact'] for o in row['outcomes']) and row['deletionUndo']), 'stale fullPass flag')
    selected = row.get('selected')
    # Supported fixture segmentation: dropping caret characters preserves any following NFD marks.
    if selected:
        chars = []
        for char in selected['document']:
            if unicodedata.combining(char) and chars:
                chars[-1] += char
            else:
                chars.append(char)
        preserved = ''.join(chars[selected['caret']:]).encode() == item['suffix'].encode()
    else:
        preserved = False
    require(row['suffixPreserved'] == preserved, 'stale suffix preservation flag')


def counts(rows):
    result = {'n': len(rows)}
    result.update({f: sum(r[f] and (r['displayed'] if f.startswith('stale') else True) for r in rows) for f in FLAGS})
    result.update(unavailable=sum(not r['displayed'] for r in rows), privateSuggestions=sum(r['privateSlots'] for r in rows),
                  privateLearning=sum(r['privatePersonalCount'] for r in rows), lexiconPresent=sum(r['targetInLexicon'] for r in rows))
    return result


def main(root):
    manifest = decode((root / 'manifest.json').read_bytes())
    raw, original = {}, {}
    for artifact in manifest['artifacts']:
        path = Path(artifact['path'])
        require(not path.is_absolute() and '..' not in path.parts, 'unsafe manifest path')
        data = (root / path).read_bytes()
        require(hashlib.sha256(data).hexdigest() == artifact['sha256'], 'stored hash mismatch: ' + str(path))
        if 'decompressedSHA256' in artifact:
            plain = gzip.decompress(data)
            require(hashlib.sha256(plain).hexdigest() == artifact['decompressedSHA256'], 'decompressed hash mismatch')
            require(data == gzip.compress(plain, mtime=0), 'non-deterministic gzip')
            data = plain
        require(artifact['logicalPath'] not in raw, 'duplicate manifest identity')
        raw[artifact['logicalPath']] = data
        original[artifact['originalPath']] = data
        if artifact['logicalPath'].endswith('.json'):
            decode(data)
    read = lambda name: decode(raw[name])
    # Reconstruct only in an isolated temporary directory; never apply rejected policy to the working tree.
    with tempfile.TemporaryDirectory(prefix='r22-verify-') as directory:
        source = Path(directory) / ENGINE
        source.parent.mkdir(parents=True)
        source.write_bytes(raw['baseline-KeyboardEngine.swift.txt'])
        applied = subprocess.run(['git', 'apply', '--unsafe-paths', '-'], cwd=directory, input=raw['rejected-policy.patch'], capture_output=True)
        require(applied.returncode == 0, 'rejected patch reconstruction failed: ' + applied.stderr.decode(errors='replace'))
        original[ENGINE] = source.read_bytes()
    freeze = read('candidate-freeze.json')
    for path, digest in freeze['sha256'].items():
        require(path in original and hashlib.sha256(original[path]).hexdigest() == digest, 'frozen hash mismatch: ' + path)
    require(hashlib.sha256(raw['heldout.json']).hexdigest() == freeze['heldoutSHA256'], 'heldout seal mismatch')
    for split, corpus, score in [('development', 'development', (80, 200, 555)), ('controls-final', 'extended-controls', (70, 170, 345)), ('heldout', 'heldout', (40, 90, 180))]:
        inputs = read(corpus + '.json')['cases']; by_id = {case['id']: case for case in inputs}
        require(len(by_id) == len(inputs) and inputs, 'duplicate/empty input identities')
        expected_keys = set(itertools.product(by_id, STACKS, MODES))
        paired = read(split + '-paired.json'); pairs = paired['cases']
        keys = [tuple(pair['key']) for pair in pairs]
        require(len(keys) == len(expected_keys) and set(keys) == expected_keys, 'missing/duplicate/extra ID×stack×mode row: ' + split)
        versions = []
        for label in ('baseline', 'candidate'):
            rows = [pair[label] for pair in pairs]
            for key, row in zip(keys, rows):
                require((row['id'], row['stack'], row['mode']) == key, 'paired identity mismatch')
                row_check(row, by_id[key[0]])
            require(paired['summary'][label] == counts(rows), 'summary count mismatch')
            for stack in STACKS:
                require(paired['summary']['perStack'][stack][label] == counts([r for r in rows if r['stack'] == stack]), 'stack summary mismatch')
            versions.append(rows)
        require((sum(r['fullPass'] for r in versions[0]), sum(r['fullPass'] for r in versions[1]), len(pairs)) == score, 'frozen score changed')
        gained, losses, failed_literal = [], [], 0
        for pair in pairs:
            a, b = pair['baseline'], pair['candidate']
            require(all(a.get(f) == b.get(f) for f in ('suggestions', 'autocorrection', 'autoCommit', 'autoBackspace', 'privateDocument', 'personalCount')), 'non-separator state changed')
            if not a['fullPass'] and not b['fullPass']:
                require(all(a.get(f) == b.get(f) for f in ('selected', 'outcomes', 'autoCase')), 'failed→failed selected state changed')
                if a.get('literal') != b.get('literal'):
                    require(not a['literalExact'] and b['literalExact'], 'failed→failed literal deterioration')
                    failed_literal += 1
            loss = [f for f in FLAGS if a[f] and not b[f]]
            gain = [f for f in FLAGS if not a[f] and b[f]]
            require(pair['losses'] == loss and pair['gains'] == gain, 'paired flags mismatch')
            if loss:
                losses.append(pair['key'])
            if not a['fullPass'] and b['fullPass']:
                gained.append(pair['key'])
        require(not losses and paired['summary']['regressions'] == [] and paired['summary']['gainedFullPass'] == gained, 'summary regression/gain mismatch')
        print(f'{split}: {score[0]}→{score[1]}/{score[2]}, unavailable {counts(versions[1])["unavailable"]}, failed→failed literal improvements {failed_literal}')
    diag = read('post-review/cases.json'); cases = {case['id']: case for case in diag}
    require(len(cases) == 11, 'diagnostic input set changed')
    expected = set(itertools.product(cases, STACKS)); versions = []
    frozen = read('post-review/freeze.json')
    for name, digest in frozen['hashes'].items():
        require(hashlib.sha256(raw['post-review/' + name]).hexdigest() == digest, 'diagnostic input freeze mismatch')
    require(hashlib.sha256(raw['post-review/Client.swift.txt']).hexdigest() == frozen['clientSHA256'], 'diagnostic client freeze mismatch')
    for name, digest in read('post-review/hashes.json').items():
        archived = 'Client.swift.txt' if name == 'Client.swift' else name
        require(hashlib.sha256(raw['post-review/' + archived]).hexdigest() == digest, 'diagnostic recorded hash mismatch: ' + name)
    for label in ('baseline', 'candidate'):
        rows = read('post-review/' + label + '.json'); keys = [(r['id'], r['stack']) for r in rows]
        require(len(keys) == len(expected) and set(keys) == expected, 'diagnostic Cartesian identity mismatch')
        for row in rows:
            case = cases[row['id']]
            require(row['expected'] == case['expected'] and type(row['exact']) is bool and type(row['available']) is bool, 'diagnostic metadata/type mismatch')
            require(row['available'] and any(s.startswith('literal|') for s in row['slots']), 'diagnostic literal unavailable')
            require(row['exact'] == (row['output'].encode() == case['expected'].encode()), 'stale diagnostic exact flag')
            require(type(row['caret']) is int and row['caret'] == size(row['output']) - size(case['suffix']) and type(row['selection']) is int and row['selection'] == 0, 'diagnostic caret/selection mismatch')
            require(type(row['suffixPreserved']) is bool and row['suffixPreserved'] and row['output'].endswith(case['suffix']), 'diagnostic suffix changed')
        versions.append({(r['id'], r['stack']): r for r in rows})
    summary = read('post-review/summary.json'); observed = []
    for a in versions[0].values():
        b = versions[1][a['id'], a['stack']]
        observed.append(dict(id=a['id'], stack=a['stack'], baseline=a['output'], candidate=b['output'], expected=a['expected'], baselineExact=a['exact'], candidateExact=b['exact'], available=a['available'] and b['available'], suffixPreserved=a['suffixPreserved'] and b['suffixPreserved']))
    gains = [r for r in observed if not r['baselineExact'] and r['candidateExact']]
    losses = [r for r in observed if r['baselineExact'] and not r['candidateExact']]
    require(summary['rows'] == observed and summary['gains'] == gains and summary['regressions'] == losses, 'diagnostic summary rows mismatch')
    require((sum(r['exact'] for r in versions[0].values()), sum(r['exact'] for r in versions[1].values()), len(gains), len(losses)) == (21, 18, 9, 12), 'diagnostic outcome changed')
    require((summary['baselineExact'], summary['candidateExact'], summary['count']) == (21, 18, 33), 'diagnostic summary counts mismatch')
    print(f'REJECT: 33 exposed diagnostic rows, 21→18 exact, 9 gains, 12 losses; {len(manifest["artifacts"])} artifacts and 12 frozen hashes verified.')
    print('No inference/native execution verified; Undo, stale-tap and privacy flags have only the archived trace limits described in audit.md.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-dir', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        main(args.audit_dir)
    except (ValueError, OSError, KeyError, TypeError, IndexError, OverflowError) as error:
        print('INVALID:', error, file=sys.stderr)
        sys.exit(1)
