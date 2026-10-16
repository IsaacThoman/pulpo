#!/usr/bin/env python3
"""Retain every frozen command transition and audit exact raw settings labels."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    fixture = json.loads((ROOT / 'heldout.json').read_text())['cases']
    baseline = json.loads((ROOT / 'baseline-outcomes.json').read_text())
    candidate = json.loads((ROOT / 'candidate-outcomes.json').read_text())
    assert len(fixture) == len(baseline) == len(candidate)
    transitions = {key: 0 for key in ['pass-to-pass', 'pass-to-fail', 'fail-to-pass', 'fail-to-fail']}
    changed = []
    exact = []
    for case, before, after in zip(fixture, baseline, candidate):
        assert case['id'] == before['id'] == after['id']
        assert len(case['actions']) == len(before['commands']) == len(after['commands'])
        for index, (action, old, new) in enumerate(zip(case['actions'], before['commands'], after['commands'])):
            assert old['index'] == new['index'] == index
            assert action['op'] == old['op'] == new['op']
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
              'baselinePassedCases': sum(c['passed'] for c in baseline), 'candidatePassedCases': sum(c['passed'] for c in candidate),
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
