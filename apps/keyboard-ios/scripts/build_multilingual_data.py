#!/usr/bin/env python3
"""Build pinned Spanish data, then combine compiled English and Spanish tables.

No English training input is needed and en_US.pkdict is never rewritten. See
LanguageData/MULTILINGUAL.md for source downloads, licensing and checksums.
"""
import argparse
import collections
import hashlib
import json
import math
import struct
from pathlib import Path

from build_language_data import build, normalize_key, open_text, FLAG_GLIDE, FLAG_NEVER_SUGGEST, FLAG_NOT_A_WORD
from build_validation_words import atomic_write, dictionary_displays, encode_sections, read_sections, uints

ROOT = Path(__file__).resolve().parent.parent
SOURCE_HASHES = {
  'wordlist': '889ad52bce2933e2a30a0560b8d5a76f5334500e776a7db7c7cb3e9e79fc2652',
  'sentences': 'd1f7aa997368571e8bbba341ab60f9145fefe14970f21065bd97be8e03c8e6fb',
  'english': '168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64',
  'detailed': '3141acd2354ecbb65199268ec222f680a232ca494129ba77b53a16b3890a11e0',
}


def author_attribution(sentences, detailed):
  """Credit source usernames while keeping sentence text out of the bundle."""
  authors = set()
  with open_text(sentences) as basic, open_text(detailed) as extended:
    for plain in basic:
      row = next(extended, '').rstrip('\n').split('\t')
      if len(row) < 4 or row[:3] != plain.rstrip('\n').split('\t'):
        raise ValueError('sentence and attribution exports differ')
      if row[3] != r'\N':
        authors.add(row[3])
    if next(extended, None) is not None:
      raise ValueError('attribution export has extra rows')
  return ('Spanish sentence contributors, Tatoeba, 2026-10-10 export.\n'
          'CC BY 2.0 FR: https://creativecommons.org/licenses/by/2.0/fr/\n'
          'Contributor profiles: https://tatoeba.org/en/user/profile/<username>\n'
          'Only aggregate n-gram statistics are distributed, not sentence text.\n'
          'Unowned/deleted-account sentences are also present in the source.\n\n'
          + '\n'.join(sorted(authors)) + '\n').encode('utf-8')


def packed(values, code='I'):
  return struct.pack(f'<{len(values)}{code}', *values)


def vocabulary_sections(entries):
  """Build a PKD1 lexical index; tuple order is (key, -frequency, display, flags)."""
  entries = sorted(entries)
  keys = [entry[0].encode('utf-8') for entry in entries]
  frequencies = [-entry[1] for entry in entries]

  def blob(strings):
    offsets = [0]
    for value in strings:
      offsets.append(offsets[-1] + len(value))
    return b''.join(strings), packed(offsets)

  key_data, key_offsets = blob(keys)
  overrides = [(i, entry[2].encode('utf-8')) for i, entry in enumerate(entries)
               if keys[i] != entry[2].encode('utf-8')]
  display_data, display_offsets = blob([value for _, value in overrides])
  sections = [(b'WKEY', key_data), (b'WKOF', key_offsets),
              (b'DSID', packed([i for i, _ in overrides])), (b'DSTX', display_data),
              (b'DSOF', display_offsets), (b'WFRQ', bytes(frequencies)),
              (b'WFLG', bytes(entry[3] for entry in entries))]
  # Breadth-first children occupy contiguous ranges, as required by Lexicon.
  nodes = [[0, 0, len(entries), 0, 0, 0, 0]]
  queue = collections.deque([(0, 0)])
  while queue:
    index, depth = queue.popleft()
    _, lo, hi, byte, _, _, _ = nodes[index]
    terminal = lo
    while terminal < hi and len(keys[terminal]) == depth:
      terminal += 1
    groups = []
    cursor = terminal
    while cursor < hi:
      child_byte = keys[cursor][depth]
      end = cursor + 1
      while end < hi and keys[end][depth] == child_byte:
        end += 1
      groups.append((cursor, end, child_byte))
      cursor = end
    frequency = max((frequencies[i] for i in range(lo, hi)
                     if not entries[i][3] & FLAG_NEVER_SUGGEST), default=0)
    if len(groups) > 255 or terminal - lo > 255:
      raise ValueError('trie node overflow')
    nodes[index] = [len(nodes), lo, hi, byte, len(groups), terminal - lo, frequency]
    for start, end, child_byte in groups:
      queue.append((len(nodes), depth + 1))
      nodes.append([0, start, end, child_byte, 0, 0, 0])
  sections.append((b'TRIE', b''.join(struct.pack('<IIIBBBB', *node) for node in nodes)))
  buckets = [[] for _ in range(676)]
  for i, entry in enumerate(entries):
    if entry[3] & FLAG_GLIDE:
      key = entry[0]
      if not key.isascii() or not key.isalpha():
        raise ValueError('non-ASCII glide key')
      buckets[(ord(key[0]) - 97) * 26 + ord(key[-1]) - 97].append(i)
  offsets, ids = [0], []
  for bucket in buckets:
    ids.extend(sorted(bucket, key=lambda i: (-frequencies[i], i)))
    offsets.append(len(ids))
  sections.extend([(b'GLOF', packed(offsets)), (b'GLID', packed(ids))])
  return entries, sections


def merge_dictionaries(english, spanish):
  sources = [dict(read_sections(data)) for data in (english, spanish)]
  metadata = [json.loads(source[b'META']) for source in sources]
  displays = [dictionary_displays(source.items()) for source in sources]
  intercept, slope = metadata[0]['unigramIntercept'], metadata[0]['unigramSlope']
  by_word = collections.defaultdict(list)
  for source, meta, words in zip(sources, metadata, displays):
    for i, word in enumerate(words):
      probability = meta['unigramIntercept'] + meta['unigramSlope'] * source[b'WFRQ'][i]
      frequency = max(0, min(255, round((probability - intercept) / slope)))
      by_word[word].append((frequency, source[b'WFLG'][i]))
  entries = []
  for word, variants in by_word.items():
    flags = 0
    for _, value in variants:
      flags |= value
    # A valid spelling in either language stays valid in bilingual mode. Keep
    # offensive suppression, but an English typo flag cannot invalidate Spanish.
    if any(not value & FLAG_NOT_A_WORD for _, value in variants):
      flags &= ~FLAG_NOT_A_WORD
    suppressed = any(value & FLAG_NEVER_SUGGEST and not value & FLAG_NOT_A_WORD
                     for _, value in variants)
    if not suppressed and any(not value & FLAG_NEVER_SUGGEST for _, value in variants):
      flags &= ~FLAG_NEVER_SUGGEST
    entries.append((normalize_key(word), -max(f for f, _ in variants), word, flags))
  entries, sections = vocabulary_sections(entries)
  index_of = {entry[2]: i for i, entry in enumerate(entries)}
  remaps = [[index_of[word] for word in words] for words in displays]
  count = len(entries)
  quant = metadata[0]['bigramQuant']

  def combine(rows):
    # Equal mixture only for histories actually present in both sources. A
    # single-language history keeps its conditional model; unlisted words use
    # Lexicon's existing normalized backoff into the bilingual unigram prior.
    values = collections.defaultdict(float)
    for row in rows:
      for word, probability in row:
        values[word] += probability / len(rows)
    return sorted(values.items(), key=lambda item: (-item[1], item[0]))

  def score(probability):
    return max(0, min(255, round(-math.log(max(probability, 1e-12)) * quant)))

  histories = collections.defaultdict(list)
  backoffs = collections.defaultdict(list)
  trigrams = collections.defaultdict(list)
  weights = collections.defaultdict(list)
  for source, meta, mapping in zip(sources, metadata, remaps):
    old_quant = meta['bigramQuant']
    offsets, ids = uints(source[b'BGOF']), uints(source[b'BGID'])
    for old, (lo, hi) in enumerate(zip(offsets, offsets[1:])):
      history = count if old == len(mapping) else mapping[old]
      if lo != hi:
        histories[history].append([(mapping[ids[p]], math.exp(-source[b'BGSC'][p] / old_quant))
                                   for p in range(lo, hi)])
        backoffs[history].append(math.exp(-source[b'BGBO'][old] / old_quant))
    if b'TGHI' in source:
      old_histories = struct.unpack(f'<{len(source[b"TGHI"]) // 8}Q', source[b'TGHI'])
      offsets, ids = uints(source[b'TGOF']), uints(source[b'TGID'])
      for i, old in enumerate(old_histories):
        history = (mapping[old >> 32] << 32) | mapping[old & 0xffffffff]
        trigrams[history].append([(mapping[ids[p]], math.exp(-source[b'TGSC'][p] / old_quant))
                                  for p in range(offsets[i], offsets[i + 1])])
        weights[history].append(min(254, source[b'TGWT'][i]))
  offsets, ids, scores, backoff_bytes = [0], [], [], []
  for history in range(count + 1):
    for word, probability in combine(histories[history])[:48]:
      ids.append(word)
      scores.append(score(probability))
    offsets.append(len(ids))
    values = backoffs[history]
    backoff_bytes.append(score(sum(values) / len(values)) if values else 0)
  sections.extend([(b'BGOF', packed(offsets)), (b'BGID', packed(ids)),
                   (b'BGSC', bytes(scores)), (b'BGBO', bytes(backoff_bytes))])
  offsets, ids, scores, weight_bytes = [0], [], [], []
  for history in sorted(trigrams):
    for word, probability in combine(trigrams[history])[:24]:
      ids.append(word)
      scores.append(score(probability))
    offsets.append(len(ids))
    weight_bytes.append(round(sum(weights[history]) / len(weights[history])))
  sections.extend([(b'TGHI', packed(sorted(trigrams), 'Q')), (b'TGOF', packed(offsets)),
                   (b'TGID', packed(ids)), (b'TGSC', bytes(scores)), (b'TGWT', bytes(weight_bytes))])
  shortcuts = {}
  for source in reversed(sources):
    for line in source[b'SHRT'].decode('utf-8').splitlines():
      key, target = line.split('\t', 1)
      # Accent shortcuts must not replace a different valid Spanish literal.
      # Other candidates still expose the accent spelling for explicit choice.
      valid_literal = any(not flags & FLAG_NOT_A_WORD for _, flags in by_word.get(key, []))
      if not valid_literal:
        shortcuts[key] = target
  sections.append((b'SHRT', '\n'.join(f'{key}\t{target}' for key, target in sorted(shortcuts.items())).encode()))
  literals = sorted(set().union(*(set(source.get(b'VWRD', b'').decode().splitlines()) for source in sources)))
  sections.append((b'VWRD', ('\n'.join(literals) + '\n').encode()))
  meta = dict(metadata[0], locale='en_es', wordCount=count, unigramIntercept=intercept - math.log(2),
              trigramHistories=len(trigrams), sources=metadata[0]['sources'] + metadata[1]['sources'],
              merge='Equal language unigram prior; shared histories mix equally; no code-switch corpus',
              inputSHA256=[hashlib.sha256(data).hexdigest() for data in (english, spanish)])
  sections.append((b'META', json.dumps(meta, sort_keys=True).encode()))
  return encode_sections(sections)


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--wordlist', type=Path, required=True)
  parser.add_argument('--sentences', type=Path, required=True)
  parser.add_argument('--detailed', type=Path, required=True, help='Matching export for contributor attribution')
  parser.add_argument('--english', type=Path, default=ROOT / 'LanguageData/en_US.pkdict')
  parser.add_argument('--output-dir', type=Path, default=ROOT / 'LanguageData')
  args = parser.parse_args()
  for name, expected in SOURCE_HASHES.items():
    actual = hashlib.sha256(getattr(args, name).read_bytes()).hexdigest()
    if actual != expected:
      parser.error(f'{name} SHA-256 mismatch: expected {expected}, got {actual}')
  spanish_path = args.output_dir / 'es.pkdict'
  attribution = author_attribution(args.sentences, args.detailed)
  build(argparse.Namespace(locale='es', wordlist=args.wordlist, sentences=args.sentences,
        messages=None, conversations=[], validation_wordlist=None, max_successors=48, output=spanish_path))
  result = merge_dictionaries(args.english.read_bytes(), spanish_path.read_bytes())
  atomic_write(args.output_dir / 'en_es.pkdict', result)
  atomic_write(args.output_dir / 'TATOEBA-SPANISH-AUTHORS.txt', attribution)
  print(f'en_es.pkdict: {json.loads(dict(read_sections(result))[b"META"])["wordCount"]} words, {len(result)} bytes')


if __name__ == '__main__':
  main()
