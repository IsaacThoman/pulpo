#!/usr/bin/env python3
"""Verify retained rejection evidence. Does not execute a model or read old holdouts."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

from compare import compare

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
BASELINE = '975c5f838db2c511a099136fda28d908b71dda6d'


def digest(data):
  return hashlib.sha256(data).hexdigest()


def raw(name):
  return json.loads(gzip.decompress((HERE / (name + '.json.gz')).read_bytes()))


def main():
  for cohort, prompts, bi_hits in [('independent', 36, 12), ('fallback', 16, 10)]:
    baseline, candidate = [raw(f'strict-{cohort}-{variant}') for variant in ['baseline', 'candidate']]
    report = compare(baseline, candidate)
    assert baseline['cohort'] == candidate['cohort'] == 'development'
    assert baseline['rowCount'] == candidate['rowCount'] == prompts * 3
    assert not baseline['failures'] and not candidate['failures']
    assert report['biGainPercentagePoints'] == 0 and not report['gains'] and not report['losses']
    assert not report['improvedFamilies'] and not report['executorAndUtilityPass']
    assert not report['gates']['fullFresh216Rows'] and report['gates']['zeroExecutorSafetyFailures']
    assert report['denominators']['en_es']['baselineHits'] == bi_hits
    assert report['denominators']['en_es']['candidateHits'] == bi_hits
    assert len(report['changedFailedOutputs']) == (0 if cohort == 'independent' else 2)
    for artifact, expected in baseline['artifactSHA256'].items():
      if artifact == 'input':
        path = HERE / f'{cohort}-development-input.json'
      elif artifact.endswith('.swift'):
        path = HERE / 'executor-archive' / (artifact + '.txt')
      else:
        path = HERE / artifact
      assert digest(path.read_bytes()) == expected, (cohort, artifact)
    for old, new in zip(baseline['rows'], candidate['rows']):
      assert (old['id'], old['mode']) == (new['id'], new['mode'])
      for row in [old, new]:
        slots = row['initialSlots']
        assert row['top3Hit'] == any(s['text'].encode() in [w.encode() for w in row['acceptable']] for s in slots)
        assert len(row['acceptance']) == 3
        assert all(not a.get('error') and len(a['primitives']) == a['expected']['primitiveCount'] for a in row['acceptance'])
  smoke = raw('strict-smoke-candidate')
  assert smoke['rowCount'] == 39 and not smoke['failures']
  restore = json.loads((HERE / 'restoration.json').read_text())
  for path, expected in restore['baselineSHA256'].items():
    original = subprocess.check_output(['git', 'show', BASELINE + ':' + path], cwd=REPO)
    assert digest(original) == expected == digest((REPO / path).read_bytes()), path
  for path in restore['absentTemporaryPaths']:
    assert not (REPO / path).exists(), path
  assert json.loads((HERE / 'closure.json').read_text())['finalFreshRowsExecuted'] == 0
  print('Verified: exact archives, 156 paired development rows/version, zero gains/losses, 39 smoke rows, production restored.')


if __name__ == '__main__':
  main()
