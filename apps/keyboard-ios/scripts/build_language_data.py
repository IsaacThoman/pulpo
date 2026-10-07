#!/usr/bin/env python3
"""Builds the on-device dictionary and emoji catalog for Pulpo Keyboard.

Inputs (download once, see README "Language data"):
  --wordlist  AOSP LatinIME en_US_wordlist.combined(.gz)   Apache-2.0
  --sentences Tatoeba eng_sentences.tsv(.bz2)              CC-BY 2.0 FR
  --emoji     Unicode emoji-test.txt                       Unicode License v3

Outputs:
  LanguageData/en_US.pkdict  memory-mapped lexicon, trie, glide buckets and bigrams
  LanguageData/emoji.json    emoji catalog with categories and skin tones
"""

import argparse
import bz2
import collections
import gzip
import json
import math
import re
import struct
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT_VERSION = 1

FLAG_NEVER_SUGGEST = 1 << 0
FLAG_GLIDE = 1 << 1
FLAG_CAPITALIZED = 1 << 2
FLAG_ABBREVIATION = 1 << 3
FLAG_INFORMAL = 1 << 4

# Bigram log probabilities are stored as round(-ln p * QUANT) in a byte.
QUANT = 12.0


def open_text(path):
  path = str(path)
  if path.endswith('.gz'):
    return gzip.open(path, 'rt', encoding='utf-8')
  if path.endswith('.bz2'):
    return bz2.open(path, 'rt', encoding='utf-8')
  return open(path, encoding='utf-8')


def normalize_key(word):
  decomposed = unicodedata.normalize('NFKD', word)
  stripped = ''.join(c for c in decomposed if not unicodedata.combining(c))
  return stripped.lower().replace("'", '').replace('’', '')


def parse_wordlist(path):
  words = {}
  shortcuts = []
  current = None
  with open_text(path) as handle:
    for line in handle:
      if line.startswith(' word='):
        fields = dict(part.split('=', 1) for part in line.strip().split(','))
        current = fields['word']
        words[current] = {
          'freq': int(fields.get('originalFreq', fields['f'])),
          'flags': fields.get('flags', ''),
          'offensive': fields.get('possibly_offensive') == 'true' or fields.get('flags') == 'offensive',
        }
      elif line.startswith('  shortcut=') and current is not None:
        fields = dict(part.split('=', 1) for part in line.strip().split(','))
        if fields.get('f') == 'whitelist':
          shortcuts.append((current, fields['shortcut']))
  return words, shortcuts


def parse_extra_words(path):
  extra = {}
  for line in path.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line or line.startswith('#'):
      continue
    word, freq = line.split('\t')
    extra[word] = int(freq)
  return extra


TOKEN = re.compile(r"[A-Za-z0-9À-ɏ]+(?:['’\-][A-Za-z0-9À-ɏ]+)*")
SENTENCE_BREAK = re.compile(r'[.!?;:()\[\]"“”]')
SKIPPED_NAMES = {'Tom', 'Mary', "Tom's", "Mary's"}


def sentence_tokens(text):
  """Yields clauses as token lists; bigrams never cross clause punctuation."""
  for clause in SENTENCE_BREAK.split(text):
    tokens = [t.replace('’', "'") for t in TOKEN.findall(clause)]
    if tokens:
      yield tokens


def build(args):
  words, shortcuts = parse_wordlist(args.wordlist)
  extra = parse_extra_words(ROOT / 'scripts' / 'extra_words.tsv')
  for word, freq in extra.items():
    entry = words.setdefault(word, {'freq': freq, 'flags': 'extra', 'offensive': False})
    entry['freq'] = max(entry['freq'], freq)
    entry['offensive'] = False

  # Count Tatoeba unigrams and bigrams over lexicon forms. Tatoeba leans heavily on
  # two example names, so sentences that use them are skipped.
  lower_lookup = {}
  for word, entry in words.items():
    lower = word.lower()
    if lower not in lower_lookup or entry['freq'] > words[lower_lookup[lower]]['freq']:
      lower_lookup[lower] = word

  def resolve(token, first):
    if token in words and not (first and token[0].isupper() and token.lower() in words and token != 'I'):
      return token
    return lower_lookup.get(token.lower())

  unigrams = collections.Counter()
  bigrams = collections.Counter()
  START = '<s>'
  sentences = 0
  with open_text(args.sentences) as handle:
    for line in handle:
      parts = line.rstrip('\n').split('\t')
      if len(parts) < 3:
        continue
      text = parts[2]
      if any(name in text for name in SKIPPED_NAMES):
        continue
      sentences += 1
      for clause_index, tokens in enumerate(sentence_tokens(text)):
        previous = START if clause_index == 0 else None
        for index, token in enumerate(tokens):
          word = resolve(token, index == 0 and clause_index == 0)
          if word is None:
            previous = None
            continue
          unigrams[word] += 1
          if previous is not None:
            bigrams[(previous, word)] += 1
          previous = word

  # Calibrate AOSP's 0-255 log-frequency scale to natural-log probabilities using
  # words that are common in both sources. Below f=90 corpus counts bottom out, so
  # only the log-linear upper range is fitted.
  total = sum(unigrams.values())
  # Per-word regression is flattened by noise, so fit the median of each 10-step band.
  bands = collections.defaultdict(list)
  for w, c in unigrams.items():
    if words[w]['freq'] >= 90:
      bands[words[w]['freq'] // 10 * 10 + 5].append(math.log(c / total))
  pairs = [(f, sorted(v)[len(v) // 2]) for f, v in bands.items() if len(v) >= 3]
  mean_f = sum(f for f, _ in pairs) / len(pairs)
  mean_l = sum(l for _, l in pairs) / len(pairs)
  slope = sum((f - mean_f) * (l - mean_l) for f, l in pairs) / sum((f - mean_f) ** 2 for f, _ in pairs)
  intercept = mean_l - slope * mean_f

  # Words that are frequent in everyday sentences but rare in AOSP get lifted.
  for word, count in unigrams.items():
    implied = (math.log(count / total) - intercept) / slope
    if count >= 20 and implied > words[word]['freq']:
      words[word]['freq'] = min(255, int(round((words[word]['freq'] + implied) / 2)))

  entries = []
  for word, entry in words.items():
    key = normalize_key(word)
    if not key:
      continue
    flags = 0
    if entry['offensive']:
      flags |= FLAG_NEVER_SUGGEST
    if word[:1].isupper():
      flags |= FLAG_CAPITALIZED
    if 'abbreviation' in entry['flags']:
      flags |= FLAG_ABBREVIATION
    if 'nonword' in entry['flags'] or 'babytalk' in entry['flags']:
      flags |= FLAG_INFORMAL
    if re.fullmatch(r'[a-z]{2,}', key) and not entry['offensive'] and entry['freq'] >= 20 and not (word.isupper() and len(word) > 1 and word not in ('OK',)):
      flags |= FLAG_GLIDE
    entries.append((key, -entry['freq'], word, entry['freq'], flags))
  entries.sort()
  keys = [e[0] for e in entries]
  displays = [e[2] for e in entries]
  freqs = [max(0, min(255, e[3])) for e in entries]
  flags = [e[4] for e in entries]
  index_of = {word: i for i, word in enumerate(displays)}
  count = len(entries)

  # Trie over normalized key bytes. Every node owns the contiguous word range
  # [lo, hi) of keys sharing its prefix; terminal words sort first in that range.
  key_bytes = [k.encode('utf-8') for k in keys]
  nodes = []  # [first_child, lo, hi, byte, child_count, terminal_count, max_freq]

  def build_node(depth, lo, hi, byte):
    node_index = len(nodes)
    nodes.append(None)
    terminal = lo
    while terminal < hi and len(key_bytes[terminal]) == depth:
      terminal += 1
    groups = []
    cursor = terminal
    while cursor < hi:
      b = key_bytes[cursor][depth]
      end = cursor
      while end < hi and key_bytes[end][depth] == b:
        end += 1
      groups.append((b, cursor, end))
      cursor = end
    max_freq = max((freqs[i] for i in range(lo, hi) if not flags[i] & FLAG_NEVER_SUGGEST), default=0)
    nodes[node_index] = [0, lo, hi, byte, len(groups), terminal - lo, max_freq]
    return node_index, groups

  # Breadth-first so each node's children are contiguous.
  root, root_groups = build_node(0, 0, count, 0)
  queue = collections.deque([(root, root_groups, 1)])
  while queue:
    parent, groups, depth = queue.popleft()
    first = len(nodes)
    nodes[parent][0] = first
    pending = []
    for b, lo, hi in groups:
      # Reserve contiguous slots before expanding grandchildren.
      nodes.append([0, lo, hi, b, 0, 0, 0])
    for offset, (b, lo, hi) in enumerate(groups):
      terminal = lo
      while terminal < hi and len(key_bytes[terminal]) == depth:
        terminal += 1
      child_groups = []
      cursor = terminal
      while cursor < hi:
        cb = key_bytes[cursor][depth]
        end = cursor
        while end < hi and key_bytes[end][depth] == cb:
          end += 1
        child_groups.append((cb, cursor, end))
        cursor = end
      max_freq = max((freqs[i] for i in range(lo, hi) if not flags[i] & FLAG_NEVER_SUGGEST), default=0)
      nodes[first + offset] = [0, lo, hi, b, len(child_groups), terminal - lo, max_freq]
      if child_groups:
        pending.append((first + offset, child_groups, depth + 1))
    queue.extend(pending)
  if any(n[4] > 255 or n[5] > 255 for n in nodes):
    raise SystemExit('trie node overflow')

  # Glide buckets keyed by first and last letter, most frequent first.
  buckets = [[] for _ in range(26 * 26)]
  for i in range(count):
    if flags[i] & FLAG_GLIDE:
      k = keys[i]
      buckets[(ord(k[0]) - 97) * 26 + ord(k[-1]) - 97].append(i)
  for bucket in buckets:
    bucket.sort(key=lambda i: -freqs[i])

  # Absolute-discount bigrams with interpolation into the calibrated unigram.
  def unigram_logp(i):
    return intercept + slope * freqs[i]

  by_first = collections.defaultdict(list)
  for (a, b), c in bigrams.items():
    if c >= 2 and b in index_of and (a == START or a in index_of):
      by_first[a].append((b, c))
  history_total = collections.Counter()
  history_types = collections.Counter()
  for (a, _), c in bigrams.items():
    history_total[a] += c
    history_types[a] += 1
  discount = 0.75
  bigram_offsets = [0]
  bigram_ids = []
  bigram_scores = []
  backoffs = []
  for i in range(count + 1):
    history = START if i == count else displays[i]
    successors = sorted(by_first.get(history, []), key=lambda x: -x[1])[:args.max_successors]
    total_h = history_total[history]
    if total_h:
      backoff = discount * history_types[history] / total_h
      backoffs.append(min(255, int(round(-math.log(max(backoff, 1e-9)) * QUANT))))
      for word, c in successors:
        j = index_of[word]
        p = (c - discount) / total_h + backoff * math.exp(unigram_logp(j))
        bigram_ids.append(j)
        bigram_scores.append(min(255, int(round(-math.log(p) * QUANT))))
    else:
      backoffs.append(0)
    bigram_offsets.append(len(bigram_ids))

  # Shortcuts: keep spelling fixes for non-words and apostrophe/case fixes that are
  # more common than the literal word. Context-free swaps between real words are dropped.
  shortcut_lines = []
  for source, target in shortcuts:
    source_entry = words.get(source)
    target_entry = words.get(target)
    same_key = normalize_key(source) == normalize_key(target)
    if source_entry is None or (same_key and target_entry and target_entry['freq'] > source_entry['freq']):
      shortcut_lines.append(f'{normalize_key(source)}\t{target}')
  for line in (ROOT / 'scripts' / 'extra_shortcuts.tsv').read_text(encoding='utf-8').splitlines():
    if line.strip() and not line.startswith('#'):
      shortcut_lines.append(line)

  display_overrides = [(i, d) for i, (k, d) in enumerate(zip(keys, displays)) if k != d]

  sections = []

  def blob(strings):
    data = bytearray()
    offsets = [0]
    for s in strings:
      data += s.encode('utf-8')
      offsets.append(len(data))
    return bytes(data), struct.pack(f'<{len(offsets)}I', *offsets)

  key_blob, key_offsets = blob(keys)
  sections.append((b'WKEY', key_blob))
  sections.append((b'WKOF', key_offsets))
  override_blob, override_offsets = blob([d for _, d in display_overrides])
  sections.append((b'DSID', struct.pack(f'<{len(display_overrides)}I', *[i for i, _ in display_overrides])))
  sections.append((b'DSTX', override_blob))
  sections.append((b'DSOF', override_offsets))
  sections.append((b'WFRQ', bytes(freqs)))
  sections.append((b'WFLG', bytes(flags)))
  trie = bytearray()
  for first_child, lo, hi, byte, child_count, terminal_count, max_freq in nodes:
    trie += struct.pack('<IIIBBBB', first_child, lo, hi, byte, child_count, terminal_count, max_freq)
  sections.append((b'TRIE', bytes(trie)))
  bucket_offsets = [0]
  bucket_ids = []
  for bucket in buckets:
    bucket_ids.extend(bucket)
    bucket_offsets.append(len(bucket_ids))
  sections.append((b'GLOF', struct.pack(f'<{len(bucket_offsets)}I', *bucket_offsets)))
  sections.append((b'GLID', struct.pack(f'<{len(bucket_ids)}I', *bucket_ids)))
  sections.append((b'BGOF', struct.pack(f'<{len(bigram_offsets)}I', *bigram_offsets)))
  sections.append((b'BGID', struct.pack(f'<{len(bigram_ids)}I', *bigram_ids)))
  sections.append((b'BGSC', bytes(bigram_scores)))
  sections.append((b'BGBO', bytes(backoffs)))
  sections.append((b'SHRT', '\n'.join(shortcut_lines).encode('utf-8')))
  meta = {
    'version': FORMAT_VERSION,
    'locale': 'en_US',
    'wordCount': count,
    'unigramIntercept': intercept,
    'unigramSlope': slope,
    'bigramQuant': QUANT,
    'sources': ['AOSP LatinIME en_US wordlist (Apache-2.0)', 'Tatoeba English sentences (CC-BY 2.0 FR)'],
  }
  sections.append((b'META', json.dumps(meta, sort_keys=True).encode('utf-8')))

  # Layout: magic, version, section count, table of (tag, offset, length), 8-byte aligned payloads.
  header_size = 12 + len(sections) * 20
  offset = (header_size + 7) & ~7
  table = bytearray()
  payload = bytearray()
  for tag, data in sections:
    table += struct.pack('<4sQQ', tag, offset, len(data))
    padded = data + b'\0' * ((-len(data)) % 8)
    payload += padded
    offset += len(padded)
  out = bytearray(b'PKD1' + struct.pack('<II', FORMAT_VERSION, len(sections)) + table)
  out += b'\0' * ((-len(out)) % 8)
  out += payload
  output = ROOT / 'LanguageData' / 'en_US.pkdict'
  output.parent.mkdir(parents=True, exist_ok=True)
  output.write_bytes(out)
  print(f'{output.name}: {count} words, {len(nodes)} trie nodes, {len(bigram_ids)} bigrams, '
        f'{len(shortcut_lines)} shortcuts, {sentences} sentences, {len(out) / 1e6:.1f} MB')
  print(f'unigram ln p = {intercept:.3f} + {slope:.4f} * f')


GROUPS = [
  ('smileys', 'Smileys & People', {'Smileys & Emotion', 'People & Body'}),
  ('animals', 'Animals & Nature', {'Animals & Nature'}),
  ('food', 'Food & Drink', {'Food & Drink'}),
  ('activity', 'Activity', {'Activities'}),
  ('travel', 'Travel & Places', {'Travel & Places'}),
  ('objects', 'Objects', {'Objects'}),
  ('symbols', 'Symbols', {'Symbols'}),
  ('flags', 'Flags', {'Flags'}),
]
TONES = ['\U0001F3FB', '\U0001F3FC', '\U0001F3FD', '\U0001F3FE', '\U0001F3FF']
LINE = re.compile(r'^([0-9A-F ]+?)\s*;\s*fully-qualified\s*#\s*(\S+)\s+E(\d+\.\d+)\s+(.+)$')


def build_emoji(path):
  group = None
  ordered = []
  by_base = {}
  version = None
  with open_text(path) as handle:
    for line in handle:
      if line.startswith('# Version:'):
        version = line.split(':', 1)[1].strip()
      if line.startswith('# group:'):
        group = line.split(':', 1)[1].strip()
        continue
      match = LINE.match(line.strip())
      if not match or group == 'Component':
        continue
      codepoints = ''.join(chr(int(c, 16)) for c in match.group(1).split())
      tones = [t for t in TONES if t in codepoints]
      if tones:
        if len(set(c for c in codepoints if c in TONES)) != 1:
          continue  # Mixed-tone pairs are left to the base emoji.
        base = ''.join(c for c in codepoints if c not in TONES)
        # Some bases drop U+FE0F when a modifier follows; try both spellings.
        target = by_base.get(base) or by_base.get(base.replace('️', ''))
        if target is not None:
          target.setdefault('t', []).append(codepoints)
        continue
      entry = {'e': codepoints, 'n': match.group(4), 'v': float(match.group(3)), 'g': group}
      by_base[codepoints] = entry
      by_base.setdefault(codepoints.replace('️', ''), entry)
      ordered.append(entry)
  categories = []
  for identifier, name, sources in GROUPS:
    items = []
    for entry in ordered:
      if entry['g'] in sources:
        item = {'e': entry['e'], 'n': entry['n'], 'v': entry['v']}
        if len(entry.get('t', [])) == 5:
          item['t'] = entry['t']
        items.append(item)
    categories.append({'id': identifier, 'name': name, 'emoji': items})
  output = ROOT / 'LanguageData' / 'emoji.json'
  output.write_text(json.dumps({'version': version, 'categories': categories}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
  print(f'{output.name}: Emoji {version}, {sum(len(c["emoji"]) for c in categories)} emoji, {output.stat().st_size / 1e3:.0f} KB')


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--wordlist', required=True)
  parser.add_argument('--sentences', required=True)
  parser.add_argument('--emoji', required=True)
  parser.add_argument('--max-successors', type=int, default=48)
  args = parser.parse_args()
  build(args)
  build_emoji(args.emoji)


if __name__ == '__main__':
  main()
