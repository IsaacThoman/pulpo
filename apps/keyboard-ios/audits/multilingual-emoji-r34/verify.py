#!/usr/bin/env python3
"""Verify this inactive R34 archive, never execute keyboard/native/cost/sealed inputs.

Default: portable byte, inactive-patch, resource and stored-result checks.
Optional --git REPOSITORY: also bind available historical Git objects/restoration.
All gates use explicit checks and remain enabled under python -O.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
AUDIT = 'apps/keyboard-ios/audits/multilingual-emoji-r34'
FAILURES = ['nonascii-single-0', 'nonascii-single-1', 'nonascii-single-2']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def relative(value):
    require(type(value) is str and value != '', 'nonempty relative path required')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and '.' not in p.parts
            and '\\' not in value and ':' not in value and str(p) == value,
            'unsafe archive/source path: ' + value)
    return p


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def object_pairs(pairs):
    d = {}
    for k, v in pairs:
        require(k not in d, 'duplicate JSON object key: ' + k)
        d[k] = v
    return d


def json_bytes(raw):
    def invalid(v):
        raise ValueError('nonfinite JSON constant: ' + v)
    def finite(value):
        number = float(value)
        require(math.isfinite(number), 'nonfinite JSON exponent: ' + value)
        return number
    return json.loads(raw, object_pairs_hook=object_pairs, parse_constant=invalid, parse_float=finite)


def patch_reconstruct(patch, mapping, blob):
    """Exact bounded unified-patch replay in memory; no external apply/path writes."""
    sections = re.split(r'(?m)^diff --git ', patch.decode())[1:]
    seen = set()
    for section in sections:
        lines = section.splitlines(keepends=True)
        header = lines[0].rstrip('\n').split(' ')
        require(len(header) == 2 and header[0].startswith('a/') and header[1].startswith('b/'), 'invalid patch header')
        path = str(relative(header[1][2:]))
        require(header[0][2:] == path and path in mapping and path not in seen, 'unexpected/duplicate patch path')
        seen.add(path)
        record = mapping[path]
        old = blob(record['baseline']).decode().splitlines(keepends=True) if 'baseline' in record else []
        target = blob(record['candidate']).decode().splitlines(keepends=True)
        minus = next((x.rstrip('\n') for x in lines if x.startswith('--- ')), None)
        plus = next((x.rstrip('\n') for x in lines if x.startswith('+++ ')), None)
        require(minus == ('--- a/' + path if 'baseline' in record else '--- /dev/null')
                and plus == '+++ b/' + path, 'patch old/new path mismatch')
        result, cursor, i = [], 0, 1
        while i < len(lines):
            if not lines[i].startswith('@@ '):
                i += 1
                continue
            match = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', lines[i])
            require(match is not None, 'malformed unified hunk')
            start, count = int(match[1]), int(match[2] or 1)
            new_start, new_count = int(match[3]), int(match[4] or 1)
            at = start - 1 if count else start
            require(cursor <= at <= len(old), 'overlapping/out-of-range patch hunk')
            result += old[cursor:at]
            cursor, removed, added = at, 0, 0
            require(len(result) == (new_start - 1 if new_count else new_start), 'new hunk position mismatch')
            i += 1
            while i < len(lines) and not lines[i].startswith('@@ '):
                line = lines[i]
                require(line[:1] in (' ', '+', '-'), 'unsupported patch line/no-newline directive')
                if line[0] in (' ', '-'):
                    require(cursor < len(old) and old[cursor] == line[1:], 'patch context/deletion mismatch: ' + path)
                    cursor += 1
                    removed += 1
                if line[0] in (' ', '+'):
                    result.append(line[1:])
                    added += 1
                i += 1
            require((removed, added) == (count, new_count), 'patch hunk count mismatch')
        result += old[cursor:]
        require(result == target, 'patch reconstruction differs from candidate snapshot: ' + path)
    expected = {p for p in mapping if not p.endswith(('emoji.json', 'EmojiSearch.swift'))}
    require(seen == expected and len(seen) == 5, 'inactive patch must cover exact five source/test/doc paths')
    return len(seen)


def git_output(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    require(result.returncode == 0, 'Git check failed: ' + ' '.join(args) + ': ' + result.stderr.decode(errors='replace'))
    return result.stdout


def verify(root, git_repo=None):
    root = root.resolve()
    manifest = json_bytes((root / 'manifest.json').read_bytes())
    require(manifest['originalAuditFiles'] == 48, 'original audit count changed')
    files = manifest['files']
    raw = {}
    for name, record in files.items():
        p = root / relative(name)
        require(p.is_file() and not any((root.joinpath(*relative(name).parts[:i])).is_symlink()
                for i in range(1, len(relative(name).parts) + 1)), 'missing/symlinked artifact: ' + name)
        data = p.read_bytes()
        require(len(data) == record['bytes'] and sha(data) == record['sha256'], 'retained byte/hash mismatch: ' + name)
        require(record['encoding'] in ('identity', 'gzip'), 'unknown encoding: ' + name)
        decoded = gzip.decompress(data) if record['encoding'] == 'gzip' else data
        require(len(decoded) == record['originalBytes'] and sha(decoded) == record['originalSHA256'], 'decompressed byte/hash mismatch: ' + name)
        raw[name] = decoded
        if name.endswith(('.json', '.json.gz')):
            json_bytes(decoded)
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
    require(actual == set(files) | {'manifest.json'}, 'missing/extra unmanifested files')
    require(len([n for n in raw if n.startswith('original/')]) == 48, 'original audit inventory is not exact48')
    def blob(name):
        require(name in raw, 'unretained reference: ' + name)
        return raw[name]
    def data(name):
        return json_bytes(blob(name))
    source = manifest['sourceSnapshots']
    for path in source:
        relative(path)
    def original_path(path, kind='candidate'):
        prefix = AUDIT + '/'
        if path.startswith(prefix):
            return 'original/' + path[len(prefix):]
        require(path in source and kind in source[path], 'missing source snapshot: ' + path)
        return source[path][kind]
    source_hashes = blob('original/candidate-source.sha256')
    require(sha(source_hashes) == 'e6690f18a99b95ce7f9a9185296ad27f1e5deb83cd8e0b1ceabee32dcbcf7486', 'historical15-source manifest changed')
    pairs = [line.split('  ', 1) for line in source_hashes.decode().splitlines()]
    require(len(pairs) == 15 and len({p for h, p in pairs}) == 15, 'historical candidate manifest not15 unique paths')
    for expected, path in pairs:
        require(sha(blob(original_path(path))) == expected, 'historical candidate-source hash mismatch: ' + path)
    for line in blob('original/protocol-v5-hashes.sha256').decode().splitlines():
        expected, path = line.split('  ', 1)
        require(sha(blob(original_path(path, 'baseline'))) == expected, 'v5 preproduction hash mismatch: ' + path)
    patched = patch_reconstruct(blob('original/candidate-source.patch'), source, blob)
    resource = 'apps/keyboard-ios/LanguageData/emoji.json'
    before, after = blob(source[resource]['baseline']), blob(source[resource]['candidate'])
    restored = data(source[resource]['candidate'])
    entries = [e for cat in restored['categories'] for e in cat['emoji']]
    require(len(entries) == len({e['e'] for e in entries}) == 1923, 'resource membership changed')
    require(sum('s' in e for e in entries) == 1914, 'Spanish-name resource count changed')
    for entry in entries:
        entry.pop('s', None)
    require(json.dumps(restored, ensure_ascii=False, separators=(',', ':')).encode() == before, 'stripping only Spanish fields does not reproduce baseline bytes')
    require((len(before), len(after), len(after) - len(before)) == (242085, 286829, 44744), 'resource delta mismatch')
    wrapper = 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift'
    require(blob(source[wrapper]['baseline']) == blob(source[wrapper]['candidate']), 'historical wrapper changed')
    smoke = 'results/candidate-smoke/'
    suite = data(smoke + 'protocol-exposed-smoke.json.gz')
    baseline = data(smoke + 'baseline-output.json.gz')
    candidate = data(smoke + 'candidate-output.json.gz')
    require(len(suite['cases']) == 147 and len({c['id'] for c in suite['cases']}) == 147, 'smoke suite must contain147 unique cases')
    require(all(c['role'] == 'control' for c in suite['cases']), 'smoke must not claim useful rows')
    # Run only the archived strict schema/scorer over retained exposed outputs.
    # No runner, catalog API, Swift, device, author tool, seal or benchmark executes.
    sys.path.insert(0, str(root / 'original'))
    spec = importlib.util.spec_from_file_location('r34_archived_compare', root / 'original/compare.py')
    scorer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scorer)
    scorer.validate(suite)
    with tempfile.TemporaryDirectory(prefix='r34-retained-rows-') as directory:
        b, c = Path(directory) / 'baseline.json', Path(directory) / 'candidate.json'
        b.write_bytes(blob(smoke + 'baseline-output.json.gz'))
        c.write_bytes(blob(smoke + 'candidate-output.json.gz'))
        report = scorer.compare(suite, b, c)
        require(report == data(smoke + 'candidate-oracle-report.json.gz'), 'candidate oracle report differs from raw recomputation')
        require(scorer.compare(suite, b, b) == data(smoke + 'baseline-oracle-report.json.gz'), 'baseline oracle report differs from raw recomputation')
    ids = [c['id'] for c in suite['cases']]
    require([r['id'] for r in baseline] == [r['id'] for r in candidate] == ids, 'raw ID/order/denominator mismatch')
    require(report['summary'] == data('original/candidate-smoke-summary.json')['summary'], 'historical smoke summary mismatch')
    failures = [r for r in report['rows'] if not r['candidate']['pass']]
    require([r['id'] for r in failures] == FAILURES and all(r['transition'] == 'fail-to-fail'
            and r['baseline']['values'] == r['candidate']['values'] == [] for r in failures), 'frozen three failures changed')
    require(report['summary']['baseline']['controls'] == {'denominator': 147, 'passing': 82, 'unavailable': 0}
            and report['summary']['candidate']['controls'] == {'denominator': 147, 'passing': 144, 'unavailable': 0}, 'frozen smoke counts changed')
    protocol = data('original/protocol-smoke-summary.json')
    for name, expected in protocol['inputHashes'].items():
        require(sha(blob(smoke + name + '.gz')) == expected, 'preproduction input hash mismatch: ' + name)
    require(sha(blob(smoke + 'candidate-oracle-report.json.gz')) == data('original/candidate-smoke-summary.json')['allRowsRaw']['sha256'], 'candidate report provenance mismatch')
    compat = 'results/compat/'
    b, c = data(compat + 'compat-baseline.json.gz'), data(compat + 'compat-candidate.json.gz')
    require(len(b) == len(c) == 7374 and len({x['query'] for x in b}) == 7374, 'compat must contain7374 unique query rows')
    changed, added = [], []
    for old, new in zip(b, c):
        require(set(old) == set(new) == {'query', 'search', 'suggestions', 'exactSuggestions'}, 'compat row fields changed')
        require(type(old['query']) is str and old['query'] == new['query'], 'compat query binding/order mismatch')
        for row in (old, new):
            for key in ('search', 'suggestions', 'exactSuggestions'):
                values = row[key]
                require(type(values) is list and all(type(v) is str and v for v in values)
                        and len(values) == len(set(values)), 'compat malformed/duplicate arrays')
        require(new['search'][:len(old['search'])] == old['search'] and len(new['search']) <= 48, 'compat legacy-prefix/cap violation')
        require(old['suggestions'] == new['suggestions'] and old['exactSuggestions'] == new['exactSuggestions'], 'contextual compatibility loss')
        if old['search'] != new['search']:
            extras = [v for v in new['search'] if v not in old['search']]
            changed.append({'query': old['query'], 'baseline': old['search'], 'candidate': new['search'], 'added': extras})
            added += extras
    require(changed == data(compat + 'compat-all-changed-rows.json.gz'), 'all552 changed rows must equal full paired derivation')
    require((len(changed), len(added), len(set(added))) == (552, 2143, 1075), 'mechanical compatibility counts changed')
    summary = data('original/compatibility-summary.json')
    for name, expected in summary['hashes'].items():
        require(sha(blob(compat + name + '.gz')) == expected, 'compat original hash mismatch')
    require(sha(blob(compat + 'compat-all-changed-rows.json.gz')) == summary['allChangedRawRows']['sha256'], 'changed-row provenance mismatch')
    review_manifest = data('independent-review/manifest.json')
    for reference, expected in review_manifest['hashes'].items():
        if reference.startswith(('baseline:', 'candidate:')):
            kind, path = reference.split(':', 1)
            retained = source[path][kind]
        elif reference.startswith('/tmp/pulpo-r34-perf/') or reference.endswith('/compat.json'):
            name = ('compat-baseline.json' if '/baseline/' in reference else 'compat-candidate.json') if reference.endswith('/compat.json') else reference.rsplit('/', 1)[-1]
            retained = compat + name + '.gz'
        elif reference.startswith('/tmp/pulpo-r34-candidate-smoke/'):
            retained = smoke + reference.rsplit('/', 1)[-1] + '.gz'
        elif reference.startswith('/tmp/r34-source-review/'):
            name = reference.rsplit('/', 1)[-1]
            retained = 'original/source-counterexample.json' if name == 'source-counterexample.json' else 'independent-review/' + name + ('.gz' if name == 'independent-controls.json' else '.txt' if name.endswith(('.py', '.swift')) else '')
        else:
            retained = 'original/' + str(relative(reference))
        require(sha(blob(retained)) == expected, 'independent historical manifest binding mismatch: ' + reference)
    independent = data('independent-review/independent-controls.json.gz')
    require(len(independent) == 282 and all(type(r['pass']) is bool and r['pass'] for r in independent), 'independent control inventory changed')
    require(all(r['actual'] == r['expectedV5'] for r in independent), 'independent stored controls differ from recorded oracles')
    native = data('original/native-interaction-summary.json')
    require(native['totalTests'] == 6 and native['failed'] == native['skipped'] == 0, 'candidate historical native totals changed')
    require([r['actualSystemContentSize'] for r in native['results']] == ['small', 'large'], 'native size matrix changed')
    for r in native['results']:
        require(r['summary']['passedTests'] == r['summary']['totalTestCount'] == 3
                and r['summary']['failedTests'] == r['summary']['skippedTests'] == 0, 'native structured summary mismatch')
    native_b = data('original/native-baseline-summary.json')
    require(native_b['passedTests'] == native_b['totalTestCount'] == 5
            and native_b['failedTests'] == native_b['skippedTests'] == 0, 'baseline historical native totals changed')
    receipt = data('parent-restoration-receipt.json')
    require(receipt['restorationDiffOutsideAudit'] == [] and len(receipt['finalChangedPaths']) == 48
            and all(p.startswith(AUDIT + '/') for p in receipt['finalChangedPaths']), 'stored restoration scope mismatch')
    git_checks = 'not requested; portable snapshots checked, Git execution/restoration receipt is historical'
    if git_repo is not None:
        top = Path(git_output(git_repo, 'rev-parse', '--show-toplevel').decode().strip())
        for kind in ('baseline', 'candidate'):
            for path, snapshots in source.items():
                if kind in snapshots:
                    require(git_output(top, 'show', manifest[kind] + ':' + path) == blob(snapshots[kind]), 'Git source/blob mismatch: ' + path)
        for name in raw:
            if name.startswith('original/'):
                path = AUDIT + '/' + name[len('original/'):]
                require(git_output(top, 'show', manifest['finalAuditCommit'] + ':' + path) == raw[name], 'Git original audit/blob mismatch: ' + name)
        # Repo-relative pathspecs always execute from actual toplevel.
        require(git_output(top, 'diff', '--name-only', manifest['baseline'], manifest['restoration'], '--', '.', ':(exclude)' + AUDIT) == b'', 'Git restoration contains non-audit differences')
        changes = git_output(top, 'diff', '--name-only', manifest['baseline'], manifest['finalAuditCommit'], '--', '.').decode().splitlines()
        require(changes == receipt['finalChangedPaths'], 'Git final48-audit diff mismatch')
        require(git_output(top, 'diff', '--name-only', manifest['baseline'], manifest['candidate'], '--', *source.keys()) != b'', 'negative Git source comparison unexpectedly empty')
        git_checks = 'baseline/candidate source +48 original blobs +restoration diff +nonempty rejected-source negative comparison passed'
    return {'status': 'PASS', 'retainedFiles': len(files), 'originalAuditFiles': 48,
            'historicalCandidateSourceBindings': 15, 'inMemoryPatchPaths': patched,
            'smoke': {'rows': 147, 'baselinePassing': 82, 'candidatePassing': 144, 'unavailable': 0, 'failedIDs': FAILURES},
            'compatibility': {'queries': 7374, 'changedRows': 552, 'addedOccurrences': 2143, 'uniqueAddedGlyphs': 1075, 'utility': 'UNAVAILABLE'},
            'independentStoredControls': 282, 'nativeHistoricalSummaries': 'candidate6/6 baseline5/5; not rerun',
            'blindUtilityAndRuntimeMemoryCosts': 'UNAVAILABLE/UNRUN; no seal opened', 'git': git_checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-dir', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--git', type=Path, metavar='REPOSITORY')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.audit_dir, args.git), indent=2))
    except (OSError, ValueError, TypeError, KeyError, IndexError, EOFError, ImportError) as error:
        parser.exit(1, 'R34 archive verification failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
