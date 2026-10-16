#!/usr/bin/env python3
"""Read-only integrity checks for historical R15 reports and optional new replays."""
import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]
MODES = ('en_US', 'es', 'en_es')
PREFIX = 'apps/keyboard-ios/audits/technical-preservation-r15/'
REQUIRED = {'id', 'group', 'before', 'selected', 'after', 'typed', 'expected'}
OPTIONAL = {'field', 'delete', 'moveBefore', 'moveAfter', 'undo'}
ROW_REQUIRED = {'id', 'group', 'mode', 'expected', 'correct', 'rawExpected', 'rawCorrect', 'automatic', 'raw'}
AUTOMATIC_FIELDS = ('output', 'alternatives', 'autocorrection', 'learned', 'touchWeight')


class Invalid(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result


def finite_tree(value):
    if isinstance(value, float):
        require(math.isfinite(value), 'nonfinite JSON number')
    elif isinstance(value, dict):
        for child in value.values():
            finite_tree(child)
    elif isinstance(value, list):
        for child in value:
            finite_tree(child)


def load(path):
    try:
        value = json.loads(path.read_text(), object_pairs_hook=object_pairs,
                           parse_constant=lambda token: (_ for _ in ()).throw(Invalid('nonfinite JSON token: ' + token)))
        finite_tree(value)
        return value
    except (OSError, ValueError) as error:
        raise Invalid(f'{path}: {error}') from error


def shape(value, required, optional, context):
    require(type(value) is dict, context + ': expected object')
    require(required <= value.keys(), context + ': missing fields ' + str(sorted(required - value.keys())))
    require(value.keys() <= required | optional, context + ': unknown/unavailable fields ' + str(sorted(value.keys() - required - optional)))


def number(value, context):
    require(type(value) in (int, float), context + ': expected number, not Boolean/string')
    try:
        require(math.isfinite(value) and value >= 0, context + ': expected finite nonnegative number')
    except OverflowError as error:
        raise Invalid(context + ': number outside finite range') from error


def strings(value, context):
    require(type(value) is list and all(type(x) is str for x in value), context + ': expected string array')


def inputs(path):
    cases = load(path)
    require(type(cases) is list and cases, str(path) + ': expected nonempty case array')
    result = {}
    for index, case in enumerate(cases):
        context = f'{path.name}[{index}]'
        shape(case, REQUIRED, OPTIONAL, context)
        require(all(type(case[key]) is str for key in REQUIRED), context + ': static strings required')
        require(case['id'] and case['group'], context + ': empty ID/group')
        require(case['id'] not in result, context + ': duplicate input ID ' + case['id'])
        require(case.get('field') in (None, 'secure', 'email', 'url', 'oneTimeCode'), context + ': unsupported field policy')
        if case.get('delete') is not None:
            require(type(case['delete']) is int and 0 <= case['delete'] <= 2**63 - 1, context + ': invalid delete count')
        if case.get('undo') is not None:
            require(type(case['undo']) is bool, context + ': undo must be Boolean')
        for key in ('moveBefore', 'moveAfter'):
            require(case.get(key) is None or type(case[key]) is str, context + ': invalid ' + key)
        result[case['id']] = case
    return result


def replay(value, context):
    shape(value, {'output', 'beforeDelimiter', 'alternatives', 'learned', 'touchWeight'}, {'autocorrection', 'keyMilliseconds'}, context)
    require(type(value['output']) is str and type(value['beforeDelimiter']) is str, context + ': text must be strings')
    require(value.get('autocorrection') is None or type(value['autocorrection']) is str, context + ': invalid proposal')
    for key in ('alternatives', 'learned'):
        strings(value[key], context + '/' + key)
    number(value['touchWeight'], context + '/touchWeight')
    if 'keyMilliseconds' in value:
        require(type(value['keyMilliseconds']) is list, context + ': timing must be array')
        for value in value['keyMilliseconds']:
            number(value, context + '/keyMilliseconds')


def reports(path, cases, raw_reference=None):
    rows = load(path)
    require(type(rows) is list, str(path) + ': expected report array')
    result = {}
    for index, row in enumerate(rows):
        context = f'{path.name}[{index}]'
        shape(row, ROW_REQUIRED, {'privacySafe', 'input'} | (REQUIRED | OPTIONAL) - {'id', 'group', 'expected'}, context)
        for key in ('id', 'group', 'mode', 'expected', 'rawExpected'):
            require(type(row[key]) is str, context + ': invalid ' + key)
        require(row['id'] in cases, context + ': unknown ID ' + row['id'])
        require(row['mode'] in MODES, context + ': unknown mode ' + row['mode'])
        key = (row['mode'], row['id'])
        require(key not in result, context + ': duplicate ID/mode ' + str(key))
        case = cases[row['id']]
        for name in REQUIRED | OPTIONAL:
            if name in row:
                require(same(row[name], case.get(name)), context + ': static metadata mismatch: ' + name)
        if 'input' in row:
            require(same(row['input'], case), context + ': full input metadata mismatch')
        for name in ('correct', 'rawCorrect'):
            require(type(row[name]) is bool, context + ': ' + name + ' must be Boolean')
        for name in ('automatic', 'raw'):
            replay(row[name], context + '/' + name)
        require(row['correct'] == (row['automatic']['output'] == case['expected']), context + ': stale correct flag')
        require(row['rawCorrect'] == (row['raw']['output'] == row['rawExpected']), context + ': stale rawCorrect flag')
        if raw_reference is not None:
            require(row['rawExpected'] == raw_reference[key]['rawExpected'], context + ': changed recorded rawExpected reference')
        private = case.get('field') is not None
        if private:
            safe = all(not row[name]['learned'] and row[name]['touchWeight'] == 0 for name in ('automatic', 'raw'))
            require(type(row.get('privacySafe')) is bool, context + ': private row requires Boolean privacySafe')
            require(safe and row['privacySafe'], context + ': private learning/calibration violation')
        else:
            require(row.get('privacySafe') is None, context + ': unexpected public privacy flag')
        result[key] = row
    expected = {(mode, identity) for mode in MODES for identity in cases}
    require(result.keys() == expected, str(path) + ': missing ID/mode pairs ' + str(sorted(expected - result.keys())))
    return result


def summarize(cases, baseline, candidate):
    result = {}
    for mode in sorted(MODES):
        pairs = [(baseline[mode, identity], candidate[mode, identity]) for identity in cases]
        entry = {'total': len(cases), 'baseline': sum(a['automatic']['output'] == a['expected'] for a, b in pairs),
                 'candidate': sum(b['automatic']['output'] == b['expected'] for a, b in pairs),
                 'rawBaseline': sum(a['raw']['output'] == a['rawExpected'] for a, b in pairs),
                 'rawCandidate': sum(b['raw']['output'] == b['rawExpected'] for a, b in pairs)}
        predicates = {
            'gains': lambda a, b: not a['correct'] and b['correct'],
            'regressions': lambda a, b: a['correct'] and not b['correct'],
            'candidateFailures': lambda a, b: not b['correct'],
            'outputChanges': lambda a, b: a['automatic']['output'] != b['automatic']['output'],
            'alternativeChanges': lambda a, b: a['automatic']['alternatives'] != b['automatic']['alternatives'],
            'autocorrectionChanges': lambda a, b: a['automatic'].get('autocorrection') != b['automatic'].get('autocorrection'),
            'learningChanges': lambda a, b: a['automatic']['learned'] != b['automatic']['learned'],
        }
        entry.update({name: [a['id'] for a, b in pairs if predicate(a, b)] for name, predicate in predicates.items()})
        entry['groups'] = {}
        for group in sorted({case['group'] for case in cases.values()}):
            subset = [(a, b) for a, b in pairs if a['group'] == group]
            entry['groups'][group] = {'total': len(subset), 'baseline': sum(a['correct'] for a, b in subset), 'candidate': sum(b['correct'] for a, b in subset)}
        result[mode] = entry
    return result


def declared_hashes(audit):
    checked, unavailable = 0, []
    final = load(audit / 'final-provenance.json')
    freeze = load(audit / 'candidate-freeze.json')
    require(type(final) is dict and type(freeze) is dict, 'invalid provenance/freeze object')
    selected = final['selectedCommit']
    for revision in (selected, freeze['baseCommit']):
        require(type(revision) is str and re.fullmatch('[0-9a-f]{7,40}', revision), 'invalid frozen Git revision')

    def git_blob(revision, path):
        process = subprocess.run(['git', 'show', revision + ':' + path], cwd=REPOSITORY, capture_output=True)
        return process.stdout if process.returncode == 0 else None

    def reconstructed_engine(path):
        original = git_blob(freeze['baseCommit'], path)
        patch = HERE / 'rejected-artifacts/rejected-policy.patch'
        if original is None or not patch.exists():
            return None
        source = original.decode('utf-8').splitlines(keepends=True)
        lines = patch.read_text().splitlines(keepends=True)
        require([line.rstrip('\n') for line in lines if line.startswith('diff --git ')] == [f'diff --git a/{path} b/{path}'], 'rejected patch must change only the frozen engine')
        output, cursor, index, hunks = [], 0, 0, 0
        while index < len(lines):
            header = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', lines[index])
            if not header:
                index += 1
                continue
            start, old_count, new_count = int(header[1]) - 1, int(header[2] or 1), int(header[4] or 1)
            require(cursor <= start <= len(source), 'invalid rejected patch hunk location')
            output.extend(source[cursor:start])
            cursor, old_used, new_used = start, 0, 0
            index += 1
            while index < len(lines) and not lines[index].startswith('@@ '):
                line = lines[index]
                require(line[:1] in (' ', '-', '+'), 'unsupported rejected patch hunk line')
                if line[0] in (' ', '-'):
                    require(cursor < len(source) and source[cursor] == line[1:], 'rejected patch context differs from frozen base')
                    cursor += 1
                    old_used += 1
                if line[0] in (' ', '+'):
                    output.append(line[1:])
                    new_used += 1
                index += 1
            require((old_used, new_used) == (old_count, new_count), 'rejected patch hunk count mismatch')
            hunks += 1
        require(hunks > 0, 'rejected patch has no hunks')
        return ''.join(output + source[cursor:]).encode('utf-8')

    def check(label, digest, local=None, revision=selected, reconstructed=None):
        nonlocal checked
        require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest), 'invalid declared SHA256: ' + label)
        if reconstructed is not None:
            data = reconstructed
        elif local is not None:
            require(local.is_file(), 'missing declared artifact: ' + str(local))
            data = local.read_bytes()
        else:
            data = git_blob(revision, label)
            if data is None:
                unavailable.append(revision + ':' + label)
                return
        require(hashlib.sha256(data).hexdigest() == digest, 'SHA256 mismatch: ' + label)
        checked += 1

    def artifact(path, digest):
        require(type(path) is str and not PurePosixPath(path).is_absolute() and '..' not in PurePosixPath(path).parts, 'unsafe declared hash path')
        if path.startswith(PREFIX):
            local = audit / path.removeprefix(PREFIX)
            if local.name == 'audit.md' and (audit / 'agent-audit.md').exists():
                local = audit / 'agent-audit.md'
            check(path, digest, local)
        else:
            archived = HERE / 'rejected-artifacts' / (PurePosixPath(path).name + '.txt')
            engine = path == 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift'
            revision = freeze['baseCommit'] if path.startswith('apps/keyboard-ios/LanguageData/') else selected
            check(path, digest, archived if archived.is_file() else None, revision=revision,
                  reconstructed=reconstructed_engine(path) if engine else None)

    for name in ('candidate-freeze.json', 'final-provenance.json'):
        declarations = load(audit / name)['sha256']
        require(type(declarations) is dict, name + ': invalid hash declarations')
        for path, digest in declarations.items():
            artifact(path, digest)
    declarations = load(audit / 'input-freeze.json')
    require(type(declarations) is dict, 'input-freeze.json: invalid hash declarations')
    for path, digest in declarations.items():
        artifact(PREFIX + path, digest)
    check('heldout.json', freeze['sealedHeldoutSHA256'], audit / 'heldout.json')
    for path, digest in freeze['dictionarySHA256'].items():
        artifact('apps/keyboard-ios/LanguageData/' + path, digest)
    check('apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift', final['originalSourceSHA256'], revision=freeze['baseCommit'])
    for path, digest in final.get('externalRawReportSHA256', {}).items():
        reference = Path(path)
        if reference.is_file():
            check(path, digest, reference)
        else:
            unavailable.append(path)
    return checked, unavailable


def parent_diagnostic():
    archive = HERE / 'archive-hashes.json'
    if archive.exists():
        declarations = load(archive)
        require(type(declarations) is dict, 'invalid archived-source hash manifest')
        for name, digest in declarations.items():
            require(type(name) is str and name.startswith('rejected-artifacts/') and '..' not in PurePosixPath(name).parts, 'unsafe archived-source hash path')
            require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest), 'invalid archived-source SHA256')
            require((HERE / name).is_file() and hashlib.sha256((HERE / name).read_bytes()).hexdigest() == digest, 'archived-source SHA256 mismatch: ' + name)
    directory = HERE / 'post-review-diagnostic'
    if not directory.exists():
        return
    declarations = load(directory / 'hashes.json')
    require(type(declarations) is dict and set(declarations) == {'cases.json', 'baseline.json', 'candidate.json'}, 'invalid parent diagnostic hash manifest')
    for name, digest in declarations.items():
        require(hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest, 'parent diagnostic SHA256 mismatch: ' + name)
    cases = inputs(directory / 'cases.json')
    baseline = reports(directory / 'baseline.json', cases)
    candidate = reports(directory / 'candidate.json', cases, baseline)
    scores = summarize(cases, baseline, candidate)
    print('Post-review exposed diagnostic:', ', '.join(f'{mode} {scores[mode]["baseline"]}->{scores[mode]["candidate"]}/{len(cases)} ({len(scores[mode]["regressions"])} losses)' for mode in MODES))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-dir', type=Path, default=HERE.parent / 'technical-preservation-r15')
    parser.add_argument('--candidate-report', action='append', default=[], metavar='SPLIT=PATH', help='Compare a new complete candidate replay against the archived candidate, excluding timing')
    args = parser.parse_args(argv)
    audit = args.audit_dir.resolve()
    derived, frozen = {}, {}
    for split in ('development', 'heldout'):
        cases = inputs(audit / (split + '.json'))
        baseline = reports(audit / (split + '-baseline.json'), cases)
        candidate = reports(audit / (split + '-candidate.json'), cases, baseline)
        for identity in cases:
            require(len({baseline[mode, identity]['rawExpected'] for mode in MODES}) == 1, split + ': raw reference differs across modes: ' + identity)
        derived[split] = summarize(cases, baseline, candidate)
        frozen[split] = (cases, candidate)
    require(same(derived, load(audit / 'summary.json')), 'derived summary differs from original summary.json')
    seen = set()
    for specification in args.candidate_report:
        split, separator, path = specification.partition('=')
        require(separator and split in frozen and split not in seen, 'candidate-report requires one development=PATH or heldout=PATH per split')
        seen.add(split)
        cases, archived = frozen[split]
        current = reports(Path(path), cases, archived)
        for key, row in current.items():
            for field in AUTOMATIC_FIELDS:
                require(same(row['automatic'].get(field), archived[key]['automatic'].get(field)), f'{path}: candidate mismatch {key}/{field}')
    checked, unavailable = declared_hashes(audit)
    parent_diagnostic()
    print('Validated exact Cartesian identities, static schema, score/privacy flags, raw references, original summaries and optional candidate comparisons.')
    print(f'Verified {checked} declared hashes; {len(unavailable)} external references unavailable (not claimed verified).')
    for reference in unavailable:
        print('Unavailable external reference:', reference)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Invalid, OSError, KeyError, TypeError, OverflowError) as error:
        print('INVALID:', error, file=sys.stderr)
        sys.exit(1)
