#!/usr/bin/env python3
"""Bounded R31 archive verification; no benchmark, build, device or sealed input access."""
import argparse
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
AUDIT = 'apps/keyboard-ios/audits/multilingual-emoji-r31/'


def require(value, message):
    if not value:
        raise ValueError(message)


def decode(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key: ' + key)
            result[key] = value
        return result
    result = json.loads(data, object_pairs_hook=pairs,
                        parse_constant=lambda value: (_ for _ in ()).throw(ValueError('nonfinite JSON: ' + value)))
    def finite(value):
        if type(value) is float:
            require(math.isfinite(value), 'nonfinite number')
        elif type(value) is list:
            for child in value:
                finite(child)
        elif type(value) is dict:
            for child in value.values():
                finite(child)
    finite(result)
    return result


def sha(data):
    return hashlib.sha256(data).hexdigest()


def scoped_path(directory, relative):
    require(type(relative) is str, 'invalid reconstruction path type')
    path = Path(relative)
    require(path.parts and not path.is_absolute() and '..' not in path.parts, 'unsafe reconstruction path')
    target = Path(directory) / path
    require(target.resolve().is_relative_to(Path(directory).resolve()), 'reconstruction path escapes temporary tree')
    return target


def main(check_git):
    manifest = decode((ROOT / 'manifest.json').read_bytes())
    raw, original = {}, {}
    for record in manifest['artifacts']:
        path = Path(record['path'])
        require(not path.is_absolute() and '..' not in path.parts, 'unsafe archive path')
        data = (ROOT / path).read_bytes()
        require(len(data) == record['bytes'] and sha(data) == record['sha256'], 'retained hash/size mismatch: ' + str(path))
        if 'decompressedSHA256' in record:
            plain = gzip.decompress(data)
            require(len(plain) == record['decompressedBytes'] and sha(plain) == record['decompressedSHA256'], 'decompressed bytes mismatch')
            require(gzip.compress(plain, mtime=0) == data, 'nondeterministic gzip')
            data = plain
        require(record['logicalPath'] not in raw, 'duplicate artifact identity')
        raw[record['logicalPath']] = data
        original[record['originalPath']] = data
        if record['logicalPath'].endswith('.json'):
            decode(data)
    read = lambda name: decode(raw[name])
    # Reconstruct the rejected source/resource in a temporary tree only; no historical refs needed.
    with tempfile.TemporaryDirectory(prefix='r31-verify-') as directory:
        require(len(manifest['patchPaths']) == len(set(manifest['patchPaths'])) == 6, 'inactive patch path set changed')
        targets = {path: scoped_path(directory, path) for path in manifest['patchPaths']}
        for record in manifest['artifacts']:
            if record['logicalPath'].startswith('baseline-snapshots/'):
                require(record['originalPath'].startswith(manifest['baseline'][:8] + ':'), 'baseline snapshot origin changed')
                relative = record['originalPath'].split(':', 1)[1]
                scoped_path(directory, relative)
                require(relative in targets, 'baseline snapshot outside inactive patch scope')
                path = targets[relative]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw[record['logicalPath']])
        result = subprocess.run(['git', 'apply', '-'], cwd=directory,
                                input=raw['rejected-candidate.patch'], capture_output=True)
        require(result.returncode == 0, 'candidate reconstruction failed: ' + result.stderr.decode(errors='replace'))
        for path in manifest['patchPaths']:
            original[path] = scoped_path(directory, path).read_bytes()
    frozen = []
    for line in raw['candidate-source.sha256'].decode().splitlines():
        digest, path = line.split('  ', 1)
        require(path in original and sha(original[path]) == digest, 'candidate freeze mismatch: ' + path)
        frozen.append(path)
    require(len(frozen) == len(set(frozen)) == 26, 'candidate freeze identities changed')
    closure = read('closure.json')
    for name, digest in closure['compactArtifacts'].items():
        require(sha(original[AUDIT + name]) == digest, 'closure hash mismatch: ' + name)
    require((closure['blindRowsUnrun'], closure['usefulRowsUnrun'], closure['freshUsefulFamiliesUnrun']) == (46, 24, 8), 'unexecuted denominator changed')
    contract = raw['contract.md'].decode()
    start, end = contract.index('## Balanced development inputs'), contract.index('## Frozen costs and gates')
    require((contract[:start] + contract[end:]).encode() == raw['author-contract.md'], 'normative author extraction changed')
    catalog_path = 'apps/keyboard-ios/LanguageData/emoji.json'
    baseline = decode(original[manifest['baseline'][:8] + ':' + catalog_path])
    candidate = decode(original[catalog_path])
    entries = [entry for category in candidate['categories'] for entry in category['emoji']]
    require(len(entries) == 1923 and sum('s' in entry for entry in entries) == 1914, 'resource coverage changed')
    # Work on a separate decode; every pre-existing field and catalog order must survive.
    stripped = decode(original[catalog_path])
    for category in stripped['categories']:
        for entry in category['emoji']:
            entry.pop('s', None)
    require(stripped == baseline, 'resource changed beyond Spanish speech names')
    before = read('exposed/pulpo-r31-compatibility-baseline.json')
    after = read('exposed/pulpo-r31-compatibility-candidate-final.json')
    require(len(before) == len(after) == 7374, 'compatibility denominator changed')
    require(len({r['query'] for r in before}) == len(before), 'duplicate compatibility query')
    changed = []
    for index, (a, b) in enumerate(zip(before, after)):
        require(a['query'] == b['query'], 'compatibility query identity mismatch')
        require(a['search'] == [value for value in b['search'] if value in a['search']], 'lost legacy membership/order')
        require(a['suggestions'] == b['suggestions'], 'contextual output changed')
        require(len(b['search']) <= 48 and len(b['search']) == len(set(b['search'])), 'invalid compatibility cap/duplicates')
        if len(a['query']) == 1 and a['query'].isascii():
            require(a['search'] == b['search'], 'ASCII single-character list changed')
        if a != b:
            changed.append((index, a, b))
    additions = [value for _, a, b in changed for value in b['search'] if value not in a['search']]
    require((len(changed), sum(not a['search'] and bool(b['search']) for _, a, b in changed), len(additions), len(set(additions))) == (784, 89, 3946, 1347), 'mechanical compatibility counts changed')
    witnesses = read('exposed/pulpo-r31-independent-changed-pairs.json')
    require(witnesses['baselineSHA256'] == sha(raw['exposed/pulpo-r31-compatibility-baseline.json']) and witnesses['candidateSHA256'] == sha(raw['exposed/pulpo-r31-compatibility-candidate-final.json']), 'compatibility report binding mismatch')
    require(len(witnesses['changes']) == len(changed) and not witnesses['programmaticProblems'], 'changed-pair report incomplete')
    for record, (index, a, b) in zip(witnesses['changes'], changed):
        require((record['index'], record['query'], record['baseline'], record['candidate']) == (index, a['query'], a, b), 'changed raw pair mismatch')
    suite = read('exposed/pulpo-r31-independent-exposed-diagnostics.json')
    inputs = {row['id']: row for row in suite['cases']}
    require(len(inputs) == len(suite['cases']) == 176, 'diagnostic input identities changed')
    versions = {}
    for label in ('baseline', 'candidate'):
        rows = read('exposed/pulpo-r31-independent-exposed-diagnostics-' + label + '.json')['rows']
        require(len(rows) == len(inputs) and {row['id'] for row in rows} == set(inputs), 'diagnostic missing/duplicate/extra row')
        mapped = {row['id']: row for row in rows}
        for row in rows:
            item = inputs[row['id']]
            for field in ('query', 'family', 'action', 'role', 'acceptable', 'maxRank'):
                require(row[field] == item[field], 'diagnostic static metadata changed')
            values = row['values']
            require(type(values) is list and all(type(value) is str for value in values) and len(values) == len(set(values)), 'invalid diagnostic output')
            rank = next((i + 1 for i, value in enumerate(values) if value in item['acceptable']), None)
            forbidden = [value for value in values if value in item.get('forbidden', [])]
            equivalent = item.get('equivalentTo')
            equal = not equivalent or values == mapped[equivalent]['values']
            require(row['rank'] == rank and row['forbiddenFound'] == forbidden, 'stale diagnostic rank/forbidden flag')
            require(row['acceptedTop8'] == [value for value in values[:8] if value in item['acceptable']], 'stale accepted alternatives')
            passed = rank is not None and rank <= item['maxRank'] and not forbidden and equal
            require(type(row['passed']) is bool and row['passed'] == passed, 'stale diagnostic pass flag')
        versions[label] = mapped
    decisive = read('rejection-counterexamples.json')
    require(len(decisive['cases']) == len(decisive['baseline']) == len(decisive['candidate']) == 7, 'decisive sequences lost')
    for item, a, b in zip(decisive['cases'], decisive['baseline'], decisive['candidate']):
        expanded = dict(item)
        reference = expanded.pop('fixtureRef', None)
        if reference:
            expanded.update(decisive['fixtures'][reference])
        require(expanded == inputs[item['id']] and a == versions['baseline'][item['id']] and b == versions['candidate'][item['id']], 'decisive rows differ from original full diagnostics')
        require(not a['values'], 'blocking example acquired legacy confound')
    for label in ('baseline', 'candidate'):
        require(decisive[label + 'OriginalSHA256'] == sha(raw['exposed/pulpo-r31-independent-exposed-diagnostics-' + label + '.json']), 'original diagnostic hash mismatch')
    rows = versions['candidate']
    for first, second in [('cap-order-0', 'cap-order-1'), ('cap-order-1', 'cap-repeat'), ('shipped-cap-0', 'shipped-cap-1'), ('shipped-cap-0', 'shipped-cap-2')]:
        require(set(rows[first]['values']) != set(rows[second]['values']), 'blocking order/repetition membership difference lost')
    perf = read('independent-performance.json')
    expected = set(itertools.product(range(12), ('baseline', 'candidate')))
    require(len(perf['samples']) == 24 and {(r['trial'], r['version']) for r in perf['samples']} == expected, 'performance sample matrix incomplete')
    require(len(perf['warmups']) == 4 and {(r['trial'], r['version']) for r in perf['warmups']} == set(itertools.product((-2, -1), ('baseline', 'candidate'))), 'warmup matrix incomplete')
    for label in ('baseline', 'candidate'):
        samples = [r for r in perf['samples'] if r['version'] == label]
        require(all(type(r['queryCount']) is int and r['queryCount'] == 1200 for r in samples), 'query sample denominator changed')
        for field, recorded in perf['summary'][label].items():
            values = sorted(r[field] for r in samples)
            derived = dict(min=min(values), median=statistics.median(values), p95=values[int((len(values) - 1) * .95 + .5)], max=max(values))
            require(recorded == derived, 'performance summary mismatch: ' + label + '/' + field)
    a, b = perf['summary']['baseline'], perf['summary']['candidate']
    numeric = dict(constructionMedian=b['buildMs']['median'] <= min(60, 2 * a['buildMs']['median']),
                   constructionP95=b['buildMs']['p95'] <= min(60, 2 * a['buildMs']['p95']),
                   queryP95=b['queryP95Ms']['p95'] <= min(2, max(2 * a['queryP95Ms']['p95'], a['queryP95Ms']['p95'] + .25)),
                   queryPeak=b['queryMaxMs']['max'] <= 10,
                   retainedExtra=b['perExtraIndexRSS']['median'] - a['perExtraIndexRSS']['median'] <= 2 * 1024 ** 2,
                   productionPeakExtra=b['peakRSS']['median'] - a['peakRSS']['median'] <= 4 * 1024 ** 2,
                   resource=len(original[catalog_path]) - len(original[manifest['baseline'][:8] + ':' + catalog_path]) <= 128 * 1024)
    require(numeric == perf['numericThresholds'] and all(numeric.values()), 'numeric thresholds changed')
    require(perf['quietHostAvailable'] is False and perf['independentGateVerdict'].startswith('UNAVAILABLE'), 'nonquiet batch promoted to acceptance')
    if check_git:
        repository = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT, text=True).strip()
        git = lambda *args: subprocess.check_output(['git', *args], cwd=repository)
        for path in frozen:
            require(git('show', manifest['candidate'] + ':' + path) == original[path], 'candidate Git blob mismatch: ' + path)
        changed_paths = set(git('diff', '--name-only', manifest['baseline'], manifest['candidate'], '--', *manifest['patchPaths']).decode().splitlines())
        require(changed_paths == set(manifest['patchPaths']), 'inactive patch source scope differs')
        require(not git('diff', manifest['baseline'], manifest['restoration'], '--', '.', ':!' + AUDIT.rstrip('/')), 'restoration not exact outside audit')
    print(f'REJECT BEFORE REVEAL: {len(manifest["artifacts"])} retained artifacts, 26 candidate freeze hashes; exact temporary reconstruction.')
    print('7 decisive sequences bound to all 176 exposed diagnostics; 7374 compatibility pairs/784 changed pairs verified. Counts are mechanical, not utility.')
    print('24 performance trials/4 warmups: numeric summaries pass, quiet-host acceptance UNAVAILABLE. 46 sealed rows remain UNRUN; no payload access or replay.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--git', action='store_true', help='Also require original candidate/restoration history in this repository')
    args = parser.parse_args()
    try:
        main(args.git)
    except (ValueError, OSError, KeyError, TypeError, IndexError, OverflowError, subprocess.CalledProcessError) as error:
        print('INVALID:', error, file=sys.stderr)
        sys.exit(1)
