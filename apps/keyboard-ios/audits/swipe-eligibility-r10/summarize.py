#!/usr/bin/env python3
"""Recompute full-document scores from stored observations; no inference."""
import hashlib
import json
import math
import statistics
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROFILES = {'320-ideal', '390-ideal', '390-jitter', '430-jitter'}
LANGUAGES = {'spanish', 'bilingual', 'english'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def valid_timing(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def folded(word):
    return ''.join(c for c in unicodedata.normalize('NFD', word.casefold())
                   if not unicodedata.combining(c))


def stats(values):
    values = sorted(values)
    return dict(n=len(values), median=statistics.median(values),
                p95=values[math.ceil(.95 * len(values)) - 1], maximum=values[-1])


def metric(rows, predicate):
    return dict(numerator=sum(bool(predicate(x)) for x in rows), denominator=len(rows))


def summarize(split):
    inputs = json.loads((ROOT / f'{split}.json').read_text())
    cases = {c['id']: c for c in inputs}
    require(len(inputs) == len(cases) == 40, f'{split}: duplicate/missing input IDs')
    require(all(c['kind'] in {'swipe', 'literal'} and c['language'] in LANGUAGES
                for c in inputs), f'{split}: unknown input kind/language')
    swipe_ids = {c['id'] for c in inputs if c['kind'] == 'swipe'}
    literal_ids = set(cases) - swipe_ids
    require(len(swipe_ids) == 32 and len(literal_ids) == 8, f'{split}: input counts')
    report = json.loads((ROOT / f'baseline-{split}.json').read_text())
    rows = report['rows']
    expected = {(identifier, profile) for identifier in swipe_ids for profile in PROFILES}
    require(len(rows) == len(expected) and {(r['id'], r['profile']) for r in rows} == expected,
            f'{split}: missing/duplicate/unexpected swipe observations')
    for row in rows:
        case = cases[row['id']]
        require(row['language'] == case['language'], f'{split}: changed observation language')
        require(type(row['exact']) is bool and type(row['phantomSpace']) is bool
                and isinstance(row['rawDocument'], str) and isinstance(row['document'], str),
                f'{split}: invalid observation types')
        require(all(valid_timing(row[key]) for key in ['setupMS', 'gestureMS']),
                f'{split}: invalid observation timing')
        exact = (row['rawDocument'] == case['context'] + case['target']
                 and row['phantomSpace'] and row['document'] == case['expectedDocument'])
        require(row['exact'] == exact, f'{split}: incorrect swipe score')
    literals = report['literals']
    require(len(literals) == len(literal_ids) and {r['id'] for r in literals} == literal_ids,
            f'{split}: missing/duplicate/unexpected literal observations')
    for row in literals:
        require(type(row['exact']) is bool and isinstance(row['document'], str),
                f'{split}: invalid literal types')
        require(row['exact'] == (row['document'] == cases[row['id']]['expectedDocument']),
                f'{split}: incorrect literal score')
    def words(row):
        return [w for w in row['words'] if w['display'] == cases[row['id']]['target']]
    failures = []
    for case in cases.values():
        observations = [r for r in rows if r['id'] == case['id'] and not r['exact']]
        if observations:
            failures.append(dict(case=case, observations=observations))
    literal_failures = [dict(case=cases[r['id']], observation=r)
                        for r in report['literals'] if not r['exact']]
    return dict(
        exact=metric(rows, lambda r: r['exact']),
        byLanguage={lang: metric([r for r in rows if r['language'] == lang], lambda r: r['exact'])
                    for lang in ['spanish', 'bilingual', 'english']},
        byProfile={profile: metric([r for r in rows if r['profile'] == profile], lambda r: r['exact'])
                   for profile in sorted({r['profile'] for r in rows})},
        exactDictionaryMember=metric(rows, lambda r: bool(words(r))),
        validGlideEligible=metric(rows, lambda r: any(w['flags'] & 2 and not w['flags'] & 33 for w in words(r))),
        apiFour=metric(rows, lambda r: cases[r['id']]['target'] in r['candidates']),
        visibleThree=metric(rows, lambda r: cases[r['id']]['target'] in r['visible']),
        accentCaseFoldedDocumentDiagnostic=metric(rows, lambda r: folded(r['document']) == folded(cases[r['id']]['expectedDocument'])),
        literals=metric(report['literals'], lambda r: r['exact']),
        literalByLanguage={lang: metric([r for r in report['literals'] if cases[r['id']]['language'] == lang], lambda r: r['exact'])
                           for lang in ['spanish', 'bilingual', 'english']},
        oovIDs=sorted({r['id'] for r in rows if not words(r)}),
        variantFailureIDs=sorted({r['id'] for r in rows if not r['exact'] and folded(r['document']) == folded(cases[r['id']]['expectedDocument'])}),
        failures=failures, literalFailures=literal_failures,
        warmGestureMS=stats([r['gestureMS'] for r in rows]),
        warmSetupMS=stats([r['setupMS'] for r in rows]))


def main():
    dev = json.loads((ROOT / 'dev.json').read_text())
    held = json.loads((ROOT / 'heldout.json').read_text())
    old = json.loads((ROOT / 'old-r7-exclusions.json').read_text())
    d, h = [{folded(c['target']) for c in cases if c['kind'] == 'swipe'} for cases in [dev, held]]
    o = {folded(w) for w in old}
    require(not d & h and not h & o and not d & o, 'Overlapping target sets')
    cold = json.loads((ROOT / 'baseline-cold.json').read_text())
    require(len(cold) == 9 and {r['language'] for r in cold} == LANGUAGES
            and all(sum(r['language'] == lang for r in cold) == 3 for lang in LANGUAGES),
            'Incomplete/unknown cold observations')
    require(all(valid_timing(r[key]) for r in cold
                for key in ['constructionMS', 'setupMS', 'firstGestureMS', 'firstInferenceMS']),
            'Invalid cold timing')
    development = summarize('dev')
    heldout = summarize('heldout')
    warm_pass = max(development['warmGestureMS']['p95'], heldout['warmGestureMS']['p95']) <= 50
    cold_pass = max(r['firstInferenceMS'] for r in cold) <= 1500
    literal_pass = heldout['literals']['numerator'] == heldout['literals']['denominator']
    output = dict(dev=development, heldout=heldout,
                  targetDisjointness=dict(devHeldout=len(d & h), devOldR7=len(d & o), heldoutOldR7=len(h & o)),
                  coldMS={lang: {key: stats([r[key] for r in cold if r['language'] == lang])
                                 for key in ['constructionMS', 'setupMS', 'firstGestureMS', 'firstInferenceMS']}
                          for lang in ['spanish', 'bilingual', 'english']},
                  inputSHA256={name: hashlib.sha256((ROOT / f'{name}.json').read_bytes()).hexdigest()
                               for name in ['dev', 'heldout']},
                  acceptance=dict(productionCandidate=False, accuracyImprovement=False,
                                  literalHeldoutGate=literal_pass, relativeTimingGate='not measured; no candidate',
                                  absoluteWarmGate='baseline only: pass' if warm_pass else 'baseline only: fail',
                                  absoluteColdGate='baseline only: pass' if cold_pass else 'baseline only: fail'))
    (ROOT / 'summary.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    for split in ['dev', 'heldout']:
        print(split, output[split]['exact'], 'literals', output[split]['literals'],
              'warmMS', output[split]['warmGestureMS'])


if __name__ == '__main__':
    main()
