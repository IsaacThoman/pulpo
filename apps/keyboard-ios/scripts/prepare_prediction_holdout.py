#!/usr/bin/env python3
"""Export unseen Topical-Chat turns as next-word cases, outside the checkout.

Example:
  python3 prepare_prediction_holdout.py --input valid_freq.json \
    --exclude train.json --output /tmp/keyboard/validation.json

Use the published validation split for development and test splits for final
verification. Exact training-turn duplicates are excluded, even across splits.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from build_language_data import conversation_training_texts, sentence_tokens


def turn_key(text):
  return hashlib.sha256(' '.join(text.casefold().split()).encode('utf-8')).digest()


def next_word_cases(input_path, exclude_paths):
  excluded = {turn_key(text) for text in conversation_training_texts(exclude_paths)}
  for text in conversation_training_texts([input_path]):
    if turn_key(text) in excluded:
      continue
    for tokens in sentence_tokens(text):
      for index in range(1, len(tokens)):
        yield {'prefix': ' '.join(tokens[:index]), 'expected': tokens[index]}


def dictionary_keys(path):
  """Safe normalized targets for a matched-vocabulary UI comparison."""
  data = Path(path).read_bytes()
  if data[:4] != b'PKD1':
    raise ValueError('Expected a PKD1 dictionary')
  sections = {}
  for index in range(struct.unpack_from('<I', data, 8)[0]):
    tag, offset, length = struct.unpack_from('<4sQQ', data, 12 + index * 20)
    sections[tag] = data[offset:offset + length]
  offsets = struct.unpack(f"<{len(sections[b'WKOF']) // 4}I", sections[b'WKOF'])
  return {sections[b'WKEY'][offsets[i]:offsets[i + 1]].decode('utf-8')
          for i in range(len(offsets) - 1) if not sections[b'WFLG'][i] & 1}


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--input', action='append', required=True)
  parser.add_argument('--exclude', action='append', default=[])
  parser.add_argument('--output', required=True)
  parser.add_argument('--sample-per-file', type=int, help='Systematic sample of ASCII word targets with at least three prefix words.')
  parser.add_argument('--dictionary', help='PKD1 dictionary for matched-vocabulary sampling.')
  parser.add_argument('--gboard-output', help='Also export the native harness contextualPredictions schema.')
  args = parser.parse_args()
  if {Path(p).resolve() for p in args.input} & {Path(p).resolve() for p in args.exclude}:
    parser.error('The evaluation input must differ from the excluded training files.')
  if args.sample_per_file is not None and (args.sample_per_file <= 0 or not args.dictionary):
    parser.error('Sampling requires a positive count and --dictionary.')
  keys = dictionary_keys(args.dictionary) if args.sample_per_file else None
  cases = []
  for path in args.input:
    rows = list(next_word_cases(path, args.exclude))
    if args.sample_per_file:
      rows = [row for row in rows if len(row['prefix'].split()) >= 3
              and row['expected'].isascii() and row['expected'].isalpha()
              and row['expected'].lower() in keys]
      count = min(args.sample_per_file, len(rows))
      rows = [rows[index * len(rows) // count] for index in range(count)]
    cases.extend(rows)
  Path(args.output).write_text(json.dumps(cases, ensure_ascii=False), encoding='utf-8')
  print(f'{len(cases)} next-word cases from unseen turns')
  if args.gboard_output:
    output = {'contextualPredictions': [{'input': row['prefix'], 'expected': row['expected']} for row in cases]}
    Path(args.gboard_output).write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
  main()
