#!/usr/bin/env python3
"""Summarize `KeystrokeSavingsBenchmarkTests` reports and check acceptance.

Each argument is a report written through `PK_KSR_REPORT`; shards of one run are
summed. With `--baseline`, the candidate must gain at least `--min-gain` points
of pooled keystroke savings, lose no more than `--max-source-loss` points on any
source, and not increase wrong autocorrections of valid words, missing literals
of valid words, forced undos, or engine/text desyncs.

  python3 -I summarize_ksr_benchmark.py after-*.json --baseline before-*.json
"""
import argparse
import json
import sys

HARMS = ('wrongAutocorrectValid', 'literalMissingValid', 'unavoidableWrongValid', 'desyncs')


def load(paths):
  sources, partition = {}, None
  for path in paths:
    with open(path, encoding='utf-8') as handle:
      report = json.load(handle)
    partition = partition or report['partition']
    if report['partition'] != partition:
      sys.exit(f'{path}: mixed partitions')
    for name, counts in report['sources'].items():
      total = sources.setdefault(name, {})
      for key, value in counts.items():
        if isinstance(value, list):
          total[key] = [a + b for a, b in zip(total.get(key, [0] * len(value)), value)]
        else:
          total[key] = total.get(key, 0) + value
  pooled = {}
  for counts in sources.values():
    for key, value in counts.items():
      if isinstance(value, list):
        pooled[key] = [a + b for a, b in zip(pooled.get(key, [0] * len(value)), value)]
      else:
        pooled[key] = pooled.get(key, 0) + value
  return partition, dict(sorted(sources.items())), pooled


def ratio(a, b):
  return 100.0 * a / b if b else 0.0


def metrics(c):
  return {
    'characters': c['characters'],
    'KSR': 100.0 * (1 - c['keystrokes'] / c['characters']) if c['characters'] else 0.0,
    'next top-1': ratio(c['nextTop1'], c['wordStarts']),
    'next top-3': ratio(c['nextTop3'], c['wordStarts']),
    'turn-start top-3': ratio(c['turnStartTop3'], c['turnStarts']),
    'letters/word': c['wordLettersTyped'] / c['words'] if c['words'] else 0.0,
    'word length': c['wordCharacters'] / c['words'] if c['words'] else 0.0,
    'appeared': ratio(c['appeared'], c['words']),
    'letters before appearing': c['lettersBeforeAppearance'] / c['appeared'] if c['appeared'] else 0.0,
    **{f'visible by {k}': ratio(c['visibleBy'][k], c['eligible'][k]) for k in range(len(c['visibleBy']))},
    'prediction taps': c['predictionTaps'],
    'completion taps': c['completionTaps'],
    'literal taps': c['literalTaps'],
    'backspaces': c['backspaces'],
    'wrongAutocorrectValid': c['wrongAutocorrectValid'],
    'wrongAutocorrect': c['wrongAutocorrect'],
    'autocorrectDecisionsValid': c['autocorrectDecisionsValid'],
    'literalMissingValid': c['literalMissingValid'],
    'literalMissing': c['literalMissing'],
    'completionsValid': c['completionsValid'],
    'unavoidableWrongValid': c['unavoidableWrongValid'],
    'desyncs': c['desyncs'],
    'finalMismatches': c['finalMismatches'],
    'caseOnlyMatches': c['caseOnlyMatches'],
  }


def show(title, sources, pooled, baseline=None):
  rows = {**{name: metrics(c) for name, c in sources.items()}, 'pooled': metrics(pooled)}
  base = None
  if baseline:
    base = {**{name: metrics(c) for name, c in baseline[1].items()}, 'pooled': metrics(baseline[2])}
  names = list(rows)
  print(f'== {title}')
  print(f"{'metric':<26}" + ''.join(f'{n[:20]:>22}' for n in names))
  for key in rows['pooled']:
    line = f'{key:<26}'
    for name in names:
      value = rows[name][key]
      cell = f'{value:.2f}' if isinstance(value, float) else str(value)
      if base and name in base:
        delta = value - base[name][key]
        cell += f' ({delta:+.2f})' if isinstance(value, float) else f' ({delta:+d})'
      line += f'{cell:>22}'
    print(line)
  return rows, base


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('reports', nargs='+')
  parser.add_argument('--baseline', nargs='+')
  parser.add_argument('--min-gain', type=float, default=1.0)
  parser.add_argument('--max-source-loss', type=float, default=0.25)
  args = parser.parse_args()
  candidate = load(args.reports)
  baseline = load(args.baseline) if args.baseline else None
  if baseline and baseline[0] != candidate[0]:
    sys.exit('Baseline and candidate partitions differ.')
  rows, base = show(candidate[0], candidate[1], candidate[2], baseline)
  if not base:
    return
  checks = [(f"pooled KSR gain >= {args.min_gain:.2f}", rows['pooled']['KSR'] - base['pooled']['KSR'] >= args.min_gain)]
  for name in rows:
    if name != 'pooled':
      checks.append((f'{name} KSR loss <= {args.max_source_loss:.2f}', rows[name]['KSR'] - base[name]['KSR'] >= -args.max_source_loss))
  for harm in HARMS:
    checks.append((f'pooled {harm} not higher', rows['pooled'][harm] <= base['pooled'][harm]))
  for label, ok in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
  print('ACCEPT' if all(ok for _, ok in checks) else 'REJECT')


if __name__ == '__main__':
  main()
