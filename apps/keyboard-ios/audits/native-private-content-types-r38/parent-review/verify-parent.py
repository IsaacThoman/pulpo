#!/usr/bin/env python3
"""Read-only R38 retained-evidence checker; does not execute production/native code.

--packet points to the ORIGINAL retained R38 audit. Alternatively --root finds it.
--parent-packet defaults to this helper's directory. Frozen sources use inactive
snapshots, never the current production tree. Optional --git/--source-ref binds
those snapshots to historical Git blobs. No writes unless --output names a new
file in a temporary directory, outside both evidence packets/repository.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

LANGUAGES = {'en_US', 'es', 'en_es'}
PLAIN = {'autocorrects', 'appliesTextReplacements', 'showsSuggestions', 'learns', 'smartQuotes', 'smartSpacing', 'autoSpaces'}


def need(ok, message):
    if not ok:
        raise ValueError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def relative(value):
    need(type(value) is str and value, 'nonempty relative path required')
    p = PurePosixPath(value)
    need(not p.is_absolute() and '..' not in p.parts and '.' not in p.parts
         and ':' not in value and '\\' not in value and str(p) == value, 'unsafe evidence path: ' + value)
    return p


def safe_file(directory, name):
    p = directory / relative(name)
    need(not any(directory.joinpath(*relative(name).parts[:i]).is_symlink()
                 for i in range(1, len(relative(name).parts) + 1)), 'symlinked evidence path: ' + name)
    return p


def retained(directory, name):
    p = safe_file(directory, name)
    if p.is_file():
        return p.read_bytes()
    q = safe_file(directory, name + '.gz')
    need(q.is_file(), 'missing evidence: ' + str(p))
    return gzip.decompress(q.read_bytes())


def read_json(raw):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'duplicate JSON object key: ' + key)
            result[key] = value
        return result
    def invalid(value):
        raise ValueError('nonfinite JSON constant: ' + value)
    def finite(value):
        number = float(value)
        need(math.isfinite(number), 'nonfinite JSON exponent: ' + value)
        return number
    return json.loads(raw, object_pairs_hook=object_pairs, parse_constant=invalid, parse_float=finite)


def data(directory, name):
    raw = retained(directory, name)
    return read_json(gzip.decompress(raw) if name.endswith('.gz') else raw)


def u16(value):
    need(type(value) is str, 'text must be a string')
    return value.encode('utf-16-le', 'surrogatepass')


def eq(a, b):
    # Preserve the peer's numeric comparison, excluding bool coercion.
    if type(a) in (int, float) and type(b) in (int, float):
        return a == b
    return type(a) == type(b) and a == b


def state_shape(value, where):
    need(type(value) is dict, where + ': state object required')
    for key in ('private', 'touchPositive', 'suggestionsEmpty', 'plain', 'allowsConfirmation', 'touchIsLearning'):
        need(type(value[key]) is bool, where + ': boolean ' + key)
    for key in ('totalCount', 'utf16Length'):
        need(type(value[key]) is int and value[key] >= 0, where + ': nonnegative integer ' + key)
    need(type(value['touchWeight']) in (int, float) and value['touchWeight'] >= 0, where + ': touch weight')
    need(type(value['suggestions']) is list and type(value['plainBits']) is dict
         and set(value['plainBits']) == PLAIN and all(type(v) is bool for v in value['plainBits'].values()), where + ': suggestion/plain bits shape')
    need(type(value['field']) is dict, where + ': field object')
    for key in ('knownCounts', 'historyCounts'):
        need(type(value[key]) is dict and all(type(k) is str and type(v) is int and v >= 0 for k, v in value[key].items()), where + ': count map ' + key)
    need(type(value['pairCounts']) is dict and all(type(k) is str and type(v) is dict
         and all(type(w) is str and type(n) is int and n >= 0 for w, n in v.items())
         for k, v in value['pairCounts'].items()), where + ': pair count map')
    need(value['touchPositive'] == (value['touchWeight'] > 0), where + ': touch-positive flag')
    need(value['suggestionsEmpty'] == (len(value['suggestions']) == 0), where + ': suggestions-empty flag')
    need(value['utf16Length'] == len(u16(value['text'])) // 2, where + ': UTF16 length')
    selection = value['selection']
    need(type(selection) is list and len(selection) == 2 and all(type(x) is int and x >= 0 for x in selection)
         and sum(selection) <= value['utf16Length'], where + ': UTF16 selection bounds')


def git_output(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    need(result.returncode == 0, 'historical Git check failed: ' + ' '.join(args) + ': ' + result.stderr.decode(errors='replace'))
    return result.stdout


def verify(packet, parent, git_repo=None, source_ref=None):
    packet, parent = packet.resolve(), parent.resolve()
    manifest = data(parent, 'parent-manifest.json')
    for name, record in manifest['files'].items():
        raw = retained(parent, name)
        need(len(raw) == record['bytes'] and sha(raw) == record['sha256'], 'parent retained byte/hash mismatch: ' + name)
    for name in ('contract-freeze.json', 'candidate-freeze.json', 'heldout-seal.json', 'manifest.json'):
        need(retained(packet, name) == retained(parent, 'original-freezes/' + name), 'original frozen bytes differ: ' + name)
    peer_receipt = data(parent, 'peer/receipt.json')
    candidate_traits = 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/InputTraits.swift'
    peer_refs = {'REVIEW.md': 'peer/REVIEW.md', 'receipt.json': 'peer/receipt.json',
                 'evidence-check.json': 'peer/evidence-check.json',
                 'check-evidence.py': 'peer/check-evidence.py.inactive.txt',
                 'mapping-and-positive-controls.json': 'peer/mapping-and-positive-controls.json',
                 'production.diff': 'peer/production.diff',
                 'baseline-InputTraits.swift.txt': 'snapshots/baseline-InputTraits.swift.txt',
                 'candidate-InputTraits.swift.txt': manifest['frozenSourceSnapshots'][candidate_traits]}
    omitted = {'core-baseline-witnesses.json', 'core-candidate-witnesses.json',
               'native-baseline-witnesses.json', 'native-candidate-witnesses.json'}
    for name, digest in peer_receipt['artifacts'].items():
        if name in omitted:
            continue
        need(name in peer_refs and sha(retained(parent, peer_refs[name])) == digest, 'preserved peer artifact mismatch: ' + name)
    need(set(peer_receipt['artifacts']) - set(peer_refs) == omitted, 'unexpected peer omission')
    original_manifest = data(packet, 'manifest.json')['sha256']
    checked_archive = {}
    def original(name):
        relative(name)
        if name in original_manifest:
            storage = name
        elif name + '.gz' in original_manifest:
            storage = name + '.gz'
        else:
            raise ValueError('reference not bound in original manifest: ' + name)
        raw = retained(packet, storage)
        need(sha(raw) == original_manifest[storage], 'original artifact hash mismatch: ' + storage)
        checked_archive[storage] = original_manifest[storage]
        return gzip.decompress(raw) if storage != name else raw
    bindings = {}
    for name, audit_relative in (('contract-freeze.json', True), ('candidate-freeze.json', False), ('heldout-seal.json', True)):
        frozen = data(packet, name)
        need(type(frozen['hashes']) is dict, 'freeze hashes object required')
        for path, expected_hash in frozen['hashes'].items():
            relative(path)
            if audit_relative:
                raw = original(path)
            elif path.startswith(manifest['originalPacketRelative'] + '/'):
                raw = original(path[len(manifest['originalPacketRelative']) + 1:])
            else:
                need(path in manifest['frozenSourceSnapshots'], 'missing inactive frozen source snapshot: ' + path)
                raw = retained(parent, manifest['frozenSourceSnapshots'][path])
            need(sha(raw) == expected_hash, 'freeze hash mismatch: ' + path)
            bindings[name + ':' + path] = expected_hash
    need(len(bindings) == 35, 'expected35 exact freeze bindings')
    seal = data(packet, 'heldout-seal.json')
    need(sha(retained(packet, 'candidate-freeze.json')) == seal['candidateFreezeSHA256'], 'seal/candidate-freeze binding')
    need(seal['input'] == 'blind/heldout-v2.json', 'unexpected revealed suite reference')
    input_raw = original(seal['input'])
    payload = read_json(input_raw)
    need(type(payload) is dict and type(payload['version']) is int and payload['version'] == 1, 'suite version')
    need(type(payload['cases']) is list and len(payload['cases']) == 18, 'expected18 semantic cases')
    ids, expected = set(), {}
    for case in payload['cases']:
        need(type(case['id']) is str and case['id'] and case['id'] not in ids, 'duplicate/empty input case ID')
        ids.add(case['id'])
        need(type(case['intent']) is str and type(case['languages']) is dict and set(case['languages']) == LANGUAGES, 'exact three-mode input Cartesian set')
        for language, variant in case['languages'].items():
            need(type(variant['steps']) is list and variant['steps'], 'nonempty operation sequence required')
            expected[case['id'], language] = case, variant
    need(len(expected) == 54, 'expected54 variants')
    summary = {'runtimeExecuted': False, 'hashBindingsVerified': len(bindings), 'inputSHA256': sha(input_raw), 'platforms': {}, 'rawReportSHA256': {}}
    reports = {}
    total_transitions = 0
    for platform in ('core', 'native'):
        reports[platform] = {}
        for version in ('baseline', 'candidate'):
            name = f'heldout-{platform}-{version}.json.gz'
            compressed = original(name)
            report_raw = gzip.decompress(compressed)
            report = read_json(report_raw)
            summary['rawReportSHA256'][name] = {'archive': sha(compressed), 'original': sha(report_raw)}
            need(report['input'] == payload and report['platform'] == platform, 'report input/platform binding: ' + name)
            need(type(report['results']) is list and len(report['results']) == 54, 'expected54 report rows: ' + name)
            rows = {}
            for row in report['results']:
                key = row['id'], row['language']
                need(key not in rows and key in expected, 'duplicate/unknown report ID×language: ' + str(key))
                rows[key] = row
            need(rows.keys() == expected.keys(), 'missing ID×language report row')
            failure_kinds, scores, case_passed, challenges = Counter(), {}, {}, Counter()
            aggregate_failures = []
            for key, (case, variant) in expected.items():
                row = rows[key]
                need(row['intent'] == case['intent'] and type(row['steps']) is list
                     and len(row['steps']) == len(variant['steps']), 'intent/step count binding: ' + str(key))
                previous, case_failures, case_messages = row['initial'], [], []
                state_shape(previous, str((platform, version, key, 'initial')))
                for i, (step, source) in enumerate(zip(row['steps'], variant['steps'])):
                    where = str((platform, version, key, i))
                    need(type(step['index']) is int and step['index'] == i and step['op'] == source['op'], 'ordered operation identity: ' + where)
                    need(step['expected'] == source['expect'], 'frozen expectation binding: ' + where)
                    actual, action, expectation = step['actual'], step['action'], source['expect']
                    state_shape(step['before'], where + ' before')
                    state_shape(actual, where + ' actual')
                    need(eq(step['before'], previous), 'broken full state chain: ' + where)
                    need(type(action) is dict and action.get('executed') is True and 'error' not in action, 'action execution failure: ' + where)
                    failures = []
                    for k, value in expectation.items():
                        if k in ('automaticCore', 'acceptedCore') and platform != 'core':
                            continue
                        if k in ('automaticNative', 'acceptedNative') and platform != 'native':
                            continue
                        if k == 'text':
                            if u16(actual[k]) != u16(value): failures.append('text.UTF16')
                        elif k == 'knownCounts':
                            for word, count in value.items():
                                if not eq(actual[k][word], count): failures.append('knownCounts[' + json.dumps(word, ensure_ascii=False) + ']')
                        elif k == 'plain':
                            for bit, flag in actual['plainBits'].items():
                                if not eq(flag, value): failures.append('plain.' + bit)
                        else:
                            observed = action[k] if k.startswith('accepted') else actual[k]
                            if not eq(observed, value): failures.append(k)
                    need(type(step['passed']) is bool and step['passed'] == (not failures), 'transition score mismatch: ' + where)
                    need(type(step['failures']) is list and all(type(f) is str for f in step['failures']), 'failure string array: ' + where)
                    recorded = [f.split(': expected', 1)[0] for f in step['failures']]
                    need(Counter(recorded) == Counter(failures), 'failure-kind completeness: ' + where)
                    failure_kinds.update(failures)
                    case_failures += failures
                    case_messages += [f'{key[0]}/{key[1]}/{i}: ' + f for f in step['failures']]
                    scores[(*key, i)] = not failures
                    if action.get('challengeFired') is True:
                        challenges['fired'] += 1
                        need(type(action['accepted']) is bool and type(action['available']) is bool, 'challenge flag types: ' + where)
                        if action['available']:
                            challenges['accepted' if action['accepted'] else 'denied'] += 1
                        else:
                            challenges['unavailable'] += 1
                            need(action['explicitExpectedRefusal'] is False, 'unavailable credited as refusal: ' + where)
                    previous = actual
                need(type(row['failures']) is list and Counter(row['failures']) == Counter(case_messages), 'row failure aggregation: ' + str(key))
                need(row['status'] == ('passed' if not case_failures else 'failed'), 'case status mismatch: ' + str(key))
                aggregate_failures += case_messages
                case_passed[key] = not case_failures
            need(type(report['failureCount']) is int and report['failureCount'] == len(report['failures']) == sum(failure_kinds.values())
                 and Counter(report['failures']) == Counter(aggregate_failures), 'report failure aggregation: ' + name)
            need(type(report['passed']) is bool and report['passed'] == (not failure_kinds), 'report status mismatch: ' + name)
            need(len(scores) == 1272, 'expected1272 transitions per report: ' + name)
            total_transitions += len(scores)
            reports[platform][version] = {'rows': rows, 'scores': scores, 'casePassed': case_passed}
            summary['platforms'].setdefault(platform, {})[version] = {'cases': len(rows), 'passedCases': sum(case_passed.values()), 'transitions': len(scores), 'passedTransitions': sum(scores.values()), 'failureKinds': dict(failure_kinds), 'challenges': dict(challenges)}
        baseline, candidate = reports[platform]['baseline'], reports[platform]['candidate']
        comparison, losses, new_failures = Counter(), [], []
        for key, passed in baseline['scores'].items():
            cp = candidate['scores'][key]
            comparison['commonPass' if passed and cp else 'gain' if cp else 'loss' if passed else 'commonFailure'] += 1
            if passed and not cp: losses.append(key)
            b = baseline['rows'][key[:2]]['steps'][key[2]]
            c = candidate['rows'][key[:2]]['steps'][key[2]]
            before = {f.split(': expected', 1)[0] for f in b['failures']}
            after = {f.split(': expected', 1)[0] for f in c['failures']}
            if after - before: new_failures.append({'transition': key, 'newFailureKinds': sorted(after - before)})
        summary['platforms'][platform]['paired'] = {'transitions': dict(comparison), 'losses': losses, 'newFailureKinds': new_failures}
    need(total_transitions == 5088, 'expected5088 independently recomputed transitions')
    for language in LANGUAGES:
        b = reports['native']['baseline']['rows']['r38-secure-trait-transitions', language]
        c = reports['native']['candidate']['rows']['r38-secure-trait-transitions', language]
        need(all(bs['actual'] == cs['actual'] for bs, cs in zip(b['steps'], c['steps'])), 'native secure case changed actual states')
    summary['nativeSecureCaseActualStatesIdenticalBetweenVersions'] = True
    # Peer receipt stays verbatim; compare the fresh recomputation to it rather
    # than inheriting its status/scores or writing large duplicate witness arrays.
    normalized = read_json(json.dumps(summary, ensure_ascii=False).encode())
    need(normalized == data(parent, 'peer/evidence-check.json'), 'independent recomputation disagrees with preserved peer evidence check')
    historical_git = 'not requested; frozen inactive source snapshots verified without current production dependency'
    if git_repo is not None:
        top = Path(git_output(git_repo, 'rev-parse', '--show-toplevel').decode().strip())
        ref = source_ref or manifest['parentCandidateRef']
        for path, snapshot in manifest['frozenSourceSnapshots'].items():
            need(git_output(top, 'show', ref + ':' + path) == retained(parent, snapshot), 'historical Git source/blob mismatch: ' + path)
        need(git_output(top, 'show', manifest['baselineRef'] + ':apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/InputTraits.swift')
             == retained(parent, 'snapshots/baseline-InputTraits.swift.txt'), 'historical baseline source mismatch')
        historical_git = 'four frozen candidate source/test blobs plus baseline InputTraits matched historical Git objects'
    return {'verification': 'PASS: retained evidence consistency; FULL FROZEN ACCEPTANCE REMAINS FAILED',
            'runtimeExecuted': False, 'independentlyRecomputedTransitions': total_transitions,
            'freezeHashesVerified': len(bindings), 'originalArtifactsHashed': len(checked_archive),
            'frozenInputSHA256': summary['inputSHA256'], 'strictGate': 'FAILED:3 scored transition losses per platform and native preservation failures',
            'evidence': normalized, 'historicalGit': historical_git,
            'limits': ['Not a new native/core run, execution attestation or blindness proof.', 'Exact source snapshots decouple historical verification from later production changes.', 'Original compare.py/verify.py remain unchanged historical helpers; their -O/assert limitations remain disclosed.', 'No unseen seal, audio/network/controller-delivery/platform-wide/privacy completeness claim.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='Repository used only to locate the original audit packet')
    parser.add_argument('--packet', type=Path, help='Original retained native-private-content-types-r38 audit directory')
    parser.add_argument('--parent-packet', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--git', type=Path, metavar='REPOSITORY', help='Optional historical source Git corroboration; not required for portable checks')
    parser.add_argument('--source-ref', help='Historical candidate source ref for --git (default parent import6f9bb58d)')
    parser.add_argument('--output', type=Path, help='Write result only to a NEW explicit temporary file; default stdout only')
    args = parser.parse_args()
    try:
        need(args.packet is not None or args.root is not None, 'provide --packet or --root')
        need(args.source_ref is None or args.git is not None, '--source-ref requires --git')
        packet = args.packet or args.root / 'apps/keyboard-ios/audits/native-private-content-types-r38'
        if args.output:
            target = args.output.resolve()
            temporary_roots = {Path('/tmp').resolve(), Path(tempfile.gettempdir()).resolve()}
            need(any(target.is_relative_to(p) for p in temporary_roots), '--output must name a temporary file')
            forbidden = [packet.resolve(), args.parent_packet.resolve()]
            for evidence_directory in (packet.resolve(), args.parent_packet.resolve()):
                forbidden += [ancestor for ancestor in (evidence_directory, *evidence_directory.parents)
                              if (ancestor / '.git').exists()]
            if args.root: forbidden.append(args.root.resolve())
            if args.git: forbidden.append(Path(git_output(args.git, 'rev-parse', '--show-toplevel').decode().strip()).resolve())
            need(not any(target.is_relative_to(p) for p in forbidden) and not target.exists(), '--output must be new and outside evidence/repository')
        result = verify(packet, args.parent_packet, args.git, args.source_ref)
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            with args.output.resolve().open('x', encoding='utf-8') as handle:
                handle.write(encoded)
        print(encoded, end='')
    except (OSError, ValueError, TypeError, KeyError, IndexError, EOFError, UnicodeError) as error:
        parser.exit(1, 'R38 parent evidence verification failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
