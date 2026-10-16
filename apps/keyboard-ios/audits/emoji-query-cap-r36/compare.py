#!/usr/bin/env python3
"""Compare every literal R36 checkpoint; does not run source or follow stored paths."""
import argparse
import json
from pathlib import Path


def require(value, message):
    if not value:
        raise ValueError(message)


def load(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid constant: ' + value)))


def validate_fixture(fixture, smoke=False):
    require(type(fixture) is dict and set(fixture) == {'version', 'cases'}, 'Fixture fields')
    require(type(fixture['version']) is int and fixture['version'] == 1, 'Fixture version')
    cases = fixture['cases']
    require(type(cases) is list and (1 <= len(cases) <= 18 if smoke else 12 <= len(cases) <= 18), 'Case coverage')
    ids = set()
    for case in cases:
        require(type(case) is dict and set(case) == {'id', 'family', 'initial', 'expectedInitial', 'actions'}, 'Case fields')
        for key in ('id', 'family', 'initial', 'expectedInitial'):
            require(type(case[key]) is str, 'Non-string case field')
        require(case['id'] and case['family'] and case['id'] not in ids, 'Empty/duplicate identity')
        ids.add(case['id'])
        require(type(case['actions']) is list and 1 <= len(case['actions']) <= 24, 'Action coverage')
        for action in case['actions']:
            require(type(action) is dict and type(action.get('op')) is str, 'Action identity')
            op = action['op']
            fields = {'op', 'expected'}
            if op == 'append':
                fields.add('value')
                require(type(action.get('value')) is str, 'Append value')
            elif op == 'deleteWords':
                fields.add('count')
                require(type(action.get('count')) is int and -1000 <= action['count'] <= 1000, 'Word-delete count')
            else:
                require(op in ('backspace', 'clear'), 'Unknown operation')
            require(set(action) == fields and type(action.get('expected')) is str, 'Action fields/expectation')


def observations(fixture, observed):
    require(type(observed) is dict and set(observed) == {'version', 'cases'}, 'Observed top-level fields')
    require(type(observed['version']) is int and observed['version'] == 1, 'Observed version')
    require(type(observed['cases']) is list and len(observed['cases']) == len(fixture['cases']), 'Missing/extra observed cases')
    result = []
    for case, row in zip(fixture['cases'], observed['cases']):
        require(type(row) is dict and set(row) == {'id', 'family', 'states'}, 'Observed case fields')
        require(row['id'] == case['id'] and row['family'] == case['family'], 'Observed case identity/order')
        actions = [{'op': 'init', 'expected': case['expectedInitial']}] + case['actions']
        require(type(row['states']) is list and len(row['states']) == len(actions), 'Missing/extra observed states')
        for step, (action, state) in enumerate(zip(actions, row['states']), -1):
            require(type(state) is dict and set(state) == {'step', 'op', 'text', 'characters', 'isEmpty', 'scalars'}, 'Observed state fields')
            require(type(state['step']) is int and state['step'] == step and state['op'] == action['op'], 'Observed state identity')
            require(type(state['text']) is str and type(state['characters']) is int and state['characters'] >= 0, 'Observed text/count type')
            require(type(state['isEmpty']) is bool and state['isEmpty'] == (state['text'] == ''), 'Observed emptiness')
            require(type(state['scalars']) is list and all(type(v) is int for v in state['scalars'])
                    and state['scalars'] == list(map(ord, state['text'])), 'Observed scalar binding')
            expected = action['expected']
            passed = state['scalars'] == list(map(ord, expected)) and state['characters'] <= 40
            result.append({'id': case['id'], 'family': case['family'], 'step': step, 'op': action['op'],
                           'expected': expected, 'observed': state, 'passed': passed})
    return result


def compare(fixture, baseline, candidate):
    validate_fixture(fixture)
    before, after = observations(fixture, baseline), observations(fixture, candidate)
    counts = {key: 0 for key in ('pass-to-pass', 'pass-to-fail', 'fail-to-pass', 'fail-to-fail')}
    rows = []
    for old, new in zip(before, after):
        transition = ('pass' if old['passed'] else 'fail') + '-to-' + ('pass' if new['passed'] else 'fail')
        counts[transition] += 1
        rows.append({**{k: new[k] for k in ('id', 'family', 'step', 'op', 'expected')},
                     'baseline': old['observed'], 'candidate': new['observed'], 'transition': transition})
    def passed_cases(states):
        return sum(all(s['passed'] for s in states if s['id'] == case['id']) for case in fixture['cases'])
    return {'cases': len(fixture['cases']), 'checkpoints': len(rows), 'transitions': counts,
            'baselinePassedCases': passed_cases(before), 'candidatePassedCases': passed_cases(after),
            'unavailableCheckpointsDropped': 0, 'rows': rows,
            'acceptance': all(s['passed'] for s in after) and counts['pass-to-fail'] == 0,
            'interpretation': 'Literal stateful query-buffer correctness; no retrieval, typing-accuracy or native-performance gain claim.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture', type=Path)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    report = compare(load(args.fixture), load(args.baseline), load(args.candidate))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'rows'}))
