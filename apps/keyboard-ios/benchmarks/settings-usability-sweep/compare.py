#!/usr/bin/env python3
"""Retain every frozen command transition and audit exact raw settings labels."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


FROZEN_RECEIPT_SHA256 = 'f9109ef8d6bc16394ac26f62a984bf73f79699527f5ec5438bacdf6e4029b221'
FROZEN_SUITE_SHA256 = '6d1aca9841eb52ce3fd8c932916824ec3a47c96fcebfd529f386066cd947378f'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'{path}: duplicate JSON key {key}')
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError(f'{path}: invalid JSON constant {value}')

    return json.loads(path.read_bytes(), object_pairs_hook=unique, parse_constant=invalid_constant)


def frozen_fixture(packet):
    """Bind the original author inputs/executor, even under python -O."""
    receipt_path = packet / 'freeze-receipt.json'
    require(hashlib.sha256(receipt_path.read_bytes()).hexdigest() == FROZEN_RECEIPT_SHA256,
            'Frozen receipt hash mismatch')
    frozen = load_json(receipt_path)
    seal = load_json(packet / 'seal-receipt.json')
    require(seal['freeze_receipt_sha256'] == FROZEN_RECEIPT_SHA256, 'Author receipt binding mismatch')
    for original, expected in frozen.items():
        require(hashlib.sha256((packet / Path(original).name).read_bytes()).hexdigest() == expected,
                f'Frozen input hash mismatch: {original}')
    require(seal['frozen_sha256'] == {k: v for k, v in frozen.items() if not k.endswith('dev-intents.txt')},
            'Author frozen input bindings mismatch')
    require(seal['sealed_sha256'] == seal['payload_sha256'] == FROZEN_SUITE_SHA256,
            'Author payload binding mismatch')
    require(hashlib.sha256((packet / 'heldout.json').read_bytes()).hexdigest() == FROZEN_SUITE_SHA256,
            'Frozen payload hash mismatch')
    suite = load_json(packet / 'heldout.json')
    cases = suite['cases']
    require(type(suite['version']) is int and suite['version'] == 1, 'Fixture version mismatch')
    require(len(cases) == len({c['id'] for c in cases}) == seal['cases'] == 5, 'Frozen workflow coverage mismatch')
    require(sum(len(c['actions']) for c in cases) == seal['actions'] == 99, 'Frozen command coverage mismatch')
    return cases


def validate_outcomes(rows, fixture, version):
    require(type(rows) is list and len(rows) == len(fixture), f'{version}: workflow coverage mismatch')
    case_scores = []
    language_labels = {'Typing Language, ' + value for value in ['English', 'Español', 'English + Español']}
    handed_labels = {'One-Handed Keyboard, ' + value for value in ['Off', 'Left', 'Right']}
    reach_labels = {'typing-language': language_labels, 'one-handed-setting': handed_labels,
                    'privacy': {'Full Access & Privacy'}, 'clear-learned-words': {'Clear Learned Words'}}
    for case, row in zip(fixture, rows):
        where = f"{version}/{case['id']}"
        require(type(row) is dict and set(row) == {'id', 'commands', 'passed'}, f'{where}: workflow schema')
        require(row['id'] == case['id'], f'{where}: workflow identity/order mismatch')
        require(type(row['passed']) is bool, f'{where}: workflow score must be Boolean')
        commands = row['commands']
        require(type(commands) is list and len(commands) == len(case['actions']), f'{where}: command coverage mismatch')
        for index, (action, command) in enumerate(zip(case['actions'], commands)):
            at = f'{where}[{index}]'
            require(type(command) is dict and set(command) == {'index', 'op', 'target', 'label', 'passed', 'scrolls', 'readback'},
                    f'{at}: command schema')
            require(type(command['index']) is int and command['index'] == index, f'{at}: index mismatch')
            require(command['op'] == action['op'] and command['target'] == action.get('target', '')
                    and command['label'] == action.get('label', ''), f'{at}: action binding mismatch')
            require(type(command['passed']) is bool, f'{at}: command score must be Boolean')
            require(type(command['readback']) is str, f'{at}: readback must be a string')
            require(type(command['scrolls']) is int and 0 <= command['scrolls'] <= 30, f'{at}: invalid scroll count')
            if action['op'] != 'reach':
                require(command['scrolls'] == 0, f'{at}: non-reach scroll count')
            if action['op'] == 'expectLabel':
                # Preserve the frozen substring oracle. Exact labels remain a separate diagnostic.
                require(command['passed'] == (action['contains'] in command['readback']), f'{at}: label score mismatch')
            elif action['op'] == 'reach':
                require(command['readback'] in reach_labels[action['target']] if command['passed'] else command['readback'] == '',
                        f'{at}: reach readback mismatch')
            else:
                require(command['readback'] == '', f'{at}: unexpected readback')
        score = all(command['passed'] for command in commands)
        require(row['passed'] == score, f'{where}: workflow aggregate mismatch')
        case_scores.append(score)
    return case_scores


def main():
    fixture = frozen_fixture(ROOT)
    baseline = load_json(ROOT / 'baseline-outcomes.json')
    candidate = load_json(ROOT / 'candidate-outcomes.json')
    baseline_scores = validate_outcomes(baseline, fixture, 'baseline')
    candidate_scores = validate_outcomes(candidate, fixture, 'candidate')
    transitions = {key: 0 for key in ['pass-to-pass', 'pass-to-fail', 'fail-to-pass', 'fail-to-fail']}
    changed = []
    exact = []
    for case, before, after in zip(fixture, baseline, candidate):
        for index, (action, old, new) in enumerate(zip(case['actions'], before['commands'], after['commands'])):
            key = ('pass' if old['passed'] else 'fail') + '-to-' + ('pass' if new['passed'] else 'fail')
            transitions[key] += 1
            if old != new:
                changed.append({'case': case['id'], 'index': index, 'before': old, 'after': new})
            if action['op'] == 'expectLabel':
                prefix = 'Typing Language, ' if action['target'] == 'typing-language' else 'One-Handed Keyboard, '
                expected = prefix + action['contains']
                exact.append({'case': case['id'], 'index': index, 'expected': expected,
                              'baseline': old['readback'], 'candidate': new['readback'],
                              'baselineExact': old['readback'] == expected, 'candidateExact': new['readback'] == expected})
    report = {'cases': len(fixture), 'commands': sum(transitions.values()), 'transitions': transitions,
              'baselinePassedCases': sum(baseline_scores), 'candidatePassedCases': sum(candidate_scores),
              'baselineScrollGestures': sum(c['scrolls'] for case in baseline for c in case['commands']),
              'candidateScrollGestures': sum(c['scrolls'] for case in candidate for c in case['commands']),
              'changedRawCommands': changed, 'exactReadbackDiagnostic': exact,
              'unavailableCommandsDropped': 0,
              'interpretation': 'Frozen existing-navigation regression score; no new-menu discovery or typing-accuracy gain claim. Exact-label audit is an additional post-reveal diagnostic.'}
    (ROOT / 'comparison.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['changedRawCommands', 'exactReadbackDiagnostic']}))
    print(json.dumps({'changedRawCommands': len(changed), 'exactReadbacks': len(exact),
                      'baselineExact': sum(x['baselineExact'] for x in exact), 'candidateExact': sum(x['candidateExact'] for x in exact)}))


if __name__ == '__main__':
    main()
