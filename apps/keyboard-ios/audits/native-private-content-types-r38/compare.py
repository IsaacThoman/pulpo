#!/usr/bin/env python3
"""Compare retained explicit baseline/candidate reports, without changing oracles."""
import argparse, gzip, json
from collections import Counter
from pathlib import Path


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    baseline, candidate = read(args.baseline), read(args.candidate)
    assert baseline['input'] == candidate['input'], 'Different benchmark inputs'
    assert baseline['platform'] == candidate['platform'], 'Different platforms'
    def rows(report):
        return {(x['id'], x['language']): x for x in report['results']}
    before, after = rows(baseline), rows(candidate)
    assert before.keys() == after.keys()
    counts, languages, details = Counter(), {}, []
    for key, b in before.items():
        c = after[key]
        language = key[1]
        group = languages.setdefault(language, Counter())
        bpass, cpass = b['status'] == 'passed', c['status'] == 'passed'
        kind = 'gain' if cpass and not bpass else 'regression' if bpass and not cpass else 'commonPass' if cpass else 'commonFailure'
        counts[kind] += 1
        group[kind] += 1
        assert len(b['steps']) == len(c['steps']), 'Transition count differs'
        assert all(bs['expected'] == cs['expected'] for bs, cs in zip(b['steps'], c['steps']))
        details.append({'id': key[0], 'language': language, 'outcome': kind,
                        'baselineFailures': b['failures'], 'candidateFailures': c['failures']})
        for bs, cs in zip(b['steps'], c['steps']):
            counts['transitions'] += 1
            counts['baselineTransitionsPassed'] += bs['passed']
            counts['candidateTransitionsPassed'] += cs['passed']
            for prefix, step in [('baseline', bs), ('candidate', cs)]:
                action = step['action']
                if action.get('challengeFired'):
                    counts[prefix + 'ChallengesFired'] += 1
                    if action.get('outcome') == 'unavailable':
                        counts[prefix + 'UnavailableChallenges'] += 1
                    elif action.get('explicitExpectedRefusal'):
                        counts[prefix + 'ExplicitExpectedRefusals'] += 1
                    elif action.get('accepted'):
                        counts[prefix + 'AcceptedChallenges'] += 1
            if (bs['actual']['private'] is False and cs['actual']['private'] is True
                    and cs['actual']['totalCount'] == 0 and bs['actual']['totalCount'] > 0):
                counts['transitionsWithMappingAndWordLearningGain'] += 1
            if (bs['actual']['private'] is False and cs['actual']['private'] is True
                    and cs['actual']['touchWeight'] == 0 and bs['actual']['touchWeight'] > 0):
                counts['transitionsWithMappingAndTouchLearningGain'] += 1
            ba, ca = bs['action'], cs['action']
            if (ba.get('accepted') is True and ca.get('explicitExpectedRefusal') is True
                    and ca.get('available') is True):
                counts['directGuardUnauthorizedAcceptancesFixed'] += 1
    result = {'platform': candidate['platform'], 'counts': dict(counts),
              'languages': {k:dict(v) for k,v in languages.items()}, 'cases': details,
              'baselineFailureCount': baseline['failureCount'], 'candidateFailureCount': candidate['failureCount'],
              'limitations': ['Direct guard challenges are not controller/audio acceptance.',
                              'Unavailable automatic insertion earns no refusal/safety credit.',
                              'Transition gain counts overlap within cases; they are not independent samples.']}
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n')
    print(json.dumps({'platform': result['platform'], 'counts': result['counts'], 'languages': result['languages']}))

if __name__ == '__main__':
    main()
