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
import hashlib
import json
import math
import os
import re
import struct
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT_VERSION = 1

FLAG_NEVER_SUGGEST = 1 << 0
FLAG_GLIDE = 1 << 1
FLAG_CAPITALIZED = 1 << 2
FLAG_ABBREVIATION = 1 << 3
FLAG_INFORMAL = 1 << 4
FLAG_NOT_A_WORD = 1 << 5

# Bigram log probabilities are stored as round(-ln p * QUANT) in a byte.
QUANT = 12.0


def quantize_interpolation_weight(weight):
  """Keep one representable unit of lower-order evidence after quantization.

  Finite support cannot establish certainty, especially when a bounded table
  omits continuations. The reader also applies this bound to older dictionaries.
  """
  return min(254, max(0, round(weight * 255)))


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
          'not_a_word': fields.get('not_a_word') == 'true',
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


def message_training_texts(path):
  """Deduplicated, non-spam SMS. Reserve a stable 20% for external evaluation.

  Only existing lexicon forms are counted below; messages and identifiers are
  never embedded in the dictionary. Source: Almeida & Hidalgo, UCI (CC BY 4.0).
  """
  seen = set()
  with open_text(path) as handle:
    for line in handle:
      label, separator, text = line.rstrip('\n').partition('\t')
      key = text.strip().casefold()
      if label != 'ham' or not separator or not key or key in seen:
        continue
      seen.add(key)
      if hashlib.sha256(key.encode('utf-8')).digest()[0] % 5 == 0:
        continue
      yield text


def conversation_training_texts(paths):
  """Only message text from explicit Topical-Chat training files, deduplicated.

  Reading sets, metadata and evaluation splits are not used. The caller chooses
  the training partition; train.json is the published 8,628-conversation split.
  """
  seen = set()
  for path in paths:
    with open_text(path) as handle:
      conversations = json.load(handle)
    for conversation in conversations.values():
      for turn in conversation['content']:
        text = turn['message']
        key = text.strip().casefold()
        if key and key not in seen:
          seen.add(key)
          yield text


def build(args):
  words, shortcuts = parse_wordlist(args.wordlist)
  extra = parse_extra_words(ROOT / 'scripts' / 'extra_words.tsv')
  for word, freq in extra.items():
    entry = words.setdefault(word, {'freq': freq, 'flags': 'extra', 'offensive': False})
    entry['freq'] = max(entry['freq'], freq)
    entry['offensive'] = False
    entry['not_a_word'] = False

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
  trigrams = collections.Counter()
  message_bigrams = collections.Counter()
  message_trigrams = collections.Counter()
  conversation_bigrams = collections.Counter()
  conversation_trigrams = collections.Counter()
  START = '<s>'
  sentences = 0
  with open_text(args.sentences) as handle:
    for line in handle:
      parts = line.rstrip('\n').split('\t')
      if len(parts) < 3:
        continue
      text = parts[2]
      if SKIPPED_NAMES.intersection(TOKEN.findall(text)):
        continue
      sentences += 1
      for clause_index, tokens in enumerate(sentence_tokens(text)):
        previous = START if clause_index == 0 else None
        preceding = None
        for index, token in enumerate(tokens):
          word = resolve(token, index == 0 and clause_index == 0)
          if word is None:
            previous = None
            preceding = None
            continue
          unigrams[word] += 1
          if previous is not None:
            bigrams[(previous, word)] += 1
            if preceding is not None and preceding != START:
              trigrams[(preceding, previous, word)] += 1
          preceding = previous
          previous = word

  message_count = 0
  conversation_count = 0
  sources = []
  if args.messages:
    sources.append((message_training_texts(args.messages), message_bigrams, message_trigrams))
  if args.conversations:
    sources.append((conversation_training_texts(args.conversations), conversation_bigrams, conversation_trigrams))
  for source, domain_bigrams, domain_trigrams in sources:
    for text in source:
      if domain_bigrams is message_bigrams:
        message_count += 1
      else:
        conversation_count += 1
      for clause_index, tokens in enumerate(sentence_tokens(text)):
        previous = START if clause_index == 0 else None
        preceding = None
        for index, token in enumerate(tokens):
          word = resolve(token, index == 0)
          if word is None or words[word].get('not_a_word') or any(c.isdigit() for c in token):
            previous = None
            preceding = None
            continue
          if previous is not None:
            domain_bigrams[(previous, word)] += 1
            if preceding is not None and preceding != START:
              domain_trigrams[(preceding, previous, word)] += 1
          preceding = previous
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
    if entry.get('not_a_word'):
      flags |= FLAG_NOT_A_WORD | FLAG_NEVER_SUGGEST
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
  message_successors = collections.defaultdict(collections.Counter)
  for (history, word), frequency in message_bigrams.items():
    if word in index_of and (history == START or history in index_of):
      message_successors[history][word] = frequency
  conversation_successors = collections.defaultdict(collections.Counter)
  for (history, word), frequency in conversation_bigrams.items():
    if word in index_of and (history == START or history in index_of):
      conversation_successors[history][word] = frequency
  bigram_offsets = [0]
  bigram_ids = []
  bigram_scores = []
  backoffs = []
  for i in range(count + 1):
    history = START if i == count else displays[i]
    successors = dict(by_first.get(history, []))
    total_h = history_total[history]
    backoff = discount * history_types[history] / total_h if total_h else 1.0
    messages = message_successors[history]
    total_m = sum(messages.values())
    # A small conversational corpus supplements the larger general-English
    # corpus. Sparse message histories get little weight; the maximum is 45%.
    message_weight = 0.45 * total_m / (total_m + 20)
    conversations = conversation_successors[history]
    total_c = sum(conversations.values())
    conversation_weight = 0.45 * total_c / (total_c + 40)
    for domain in (messages, conversations):
      for word, frequency in domain.items():
        if frequency >= 2:
          successors.setdefault(word, 0)
    probabilities = []
    for word, frequency in successors.items():
      j = index_of[word]
      p_general = max(0, frequency - discount) / total_h if total_h else 0
      p_general += backoff * math.exp(unigram_logp(j))
      p_message = messages[word] / total_m if total_m else 0
      p_conversation = conversations[word] / total_c if total_c else 0
      # Keep domains separate: a much larger topical corpus must not erase
      # supported short-message phrases through raw count pooling.
      p = (1 - conversation_weight) * p_general + conversation_weight * p_conversation
      p = (1 - message_weight) * p + message_weight * p_message
      probabilities.append((word, p))
    backoff *= (1 - message_weight) * (1 - conversation_weight)
    backoffs.append(min(255, int(round(-math.log(max(backoff, 1e-9)) * QUANT))))
    for word, p in sorted(probabilities, key=lambda item: (-item[1], item[0]))[:args.max_successors]:
      bigram_ids.append(index_of[word])
      bigram_scores.append(min(255, int(round(-math.log(p) * QUANT))))
    bigram_offsets.append(len(bigram_ids))

  # Shortcuts: keep spelling fixes for non-words and apostrophe/case fixes that are
  # more common than the literal word. Context-free swaps between real words are dropped.
  shortcut_lines = []
  for source, target in shortcuts:
    source_entry = words.get(source)
    target_entry = words.get(target)
    same_key = normalize_key(source) == normalize_key(target)
    if source_entry is None or source_entry.get('not_a_word') or (same_key and target_entry and target_entry['freq'] > source_entry['freq']):
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
  # Frequent two-word histories provide longer context without a neural model
  # or an unbounded extension working set. Histories and successors are sorted
  # for memory-mapped binary lookup; low-count histories back off to bigrams.
  trigram_histories = collections.defaultdict(collections.Counter)
  for (a, b, c), frequency in trigrams.items():
    if frequency >= 3 and a in index_of and b in index_of and c in index_of:
      trigram_histories[(a, b)][c] = frequency
  message_trigram_histories = collections.defaultdict(collections.Counter)
  for (a, b, c), frequency in message_trigrams.items():
    if frequency >= 2 and a in index_of and b in index_of and c in index_of:
      message_trigram_histories[(a, b)][c] = frequency
  conversation_trigram_histories = collections.defaultdict(collections.Counter)
  for (a, b, c), frequency in conversation_trigrams.items():
    if frequency >= 2 and a in index_of and b in index_of and c in index_of:
      conversation_trigram_histories[(a, b)][c] = frequency
  # Reserve room for all supported conversational histories, then fill from the
  # general corpus. Rare one-off message phrases never enter this table.
  ranked_messages = sorted(message_trigram_histories, key=lambda h: (-sum(message_trigram_histories[h].values()), h))
  frequent = set(ranked_messages[:20_000])
  ranked_conversations = sorted(conversation_trigram_histories, key=lambda h: (-sum(conversation_trigram_histories[h].values()), h))
  # Reserve up to half the bounded table for conversational histories.
  frequent.update(ranked_conversations[:20_000])
  general_histories = sorted(trigram_histories, key=lambda h: (-sum(trigram_histories[h].values()), h))
  for history in general_histories:
    if len(frequent) >= 40_000:
      break
    frequent.add(history)
  frequent = list(frequent)
  frequent.sort(key=lambda h: (index_of[h[0]], index_of[h[1]]))
  trigram_keys, trigram_offsets, trigram_ids, trigram_scores, trigram_weights = [], [0], [], [], []
  for history in frequent:
    successors = trigram_histories[history]
    total_h = sum(successors.values())
    # The interpolation weight grows with observed support. A sparse trigram
    # should not overwhelm a well-established bigram or a learned phrase.
    weight = total_h / (total_h + 20)
    messages = message_trigram_histories[history]
    total_m = sum(messages.values())
    message_weight = 0.45 * total_m / (total_m + 12)
    conversations = conversation_trigram_histories[history]
    total_c = sum(conversations.values())
    conversation_weight = 0.45 * total_c / (total_c + 20)
    # Store the combined conditional distribution and its single backoff weight.
    # Runtime interpolation is unchanged and still works with older dictionaries.
    general_weight = (1 - message_weight) * (1 - conversation_weight) * weight
    conversation_weight *= 1 - message_weight
    weight = general_weight + conversation_weight + message_weight
    probabilities = {}
    for word in successors.keys() | messages.keys() | conversations.keys():
      p_general = successors[word] / total_h if total_h else 0
      p_message = messages[word] / total_m if total_m else 0
      p_conversation = conversations[word] / total_c if total_c else 0
      probabilities[word] = (general_weight * p_general + conversation_weight * p_conversation + message_weight * p_message) / weight
    trigram_weights.append(quantize_interpolation_weight(weight))
    trigram_keys.append((index_of[history[0]] << 32) | index_of[history[1]])
    for word, probability in sorted(probabilities.items(), key=lambda item: (-item[1], item[0]))[:24]:
      trigram_ids.append(index_of[word])
      trigram_scores.append(min(255, round(-math.log(probability) * QUANT)))
    trigram_offsets.append(len(trigram_ids))
  sections.append((b'TGHI', struct.pack(f'<{len(trigram_keys)}Q', *trigram_keys)))
  sections.append((b'TGOF', struct.pack(f'<{len(trigram_offsets)}I', *trigram_offsets)))
  sections.append((b'TGID', struct.pack(f'<{len(trigram_ids)}I', *trigram_ids)))
  sections.append((b'TGSC', bytes(trigram_scores)))
  sections.append((b'TGWT', bytes(trigram_weights)))
  sections.append((b'SHRT', '\n'.join(shortcut_lines).encode('utf-8')))
  meta = {
    'version': FORMAT_VERSION,
    'locale': 'en_US',
    'wordCount': count,
    'unigramIntercept': intercept,
    'unigramSlope': slope,
    'bigramQuant': QUANT,
    'trigramHistories': len(trigram_keys),
    'messageTrainingCount': message_count,
    'conversationTrainingCount': conversation_count,
    'sources': ['AOSP LatinIME en_US wordlist (Apache-2.0)', 'Tatoeba English sentences (CC-BY 2.0 FR)'],
  }
  if args.messages:
    meta['sources'].append('Almeida & Hidalgo, SMS Spam Collection, UCI, DOI 10.24432/C5CC84 (CC BY 4.0); deduplicated ham training partition')
  if args.conversations:
    meta['sources'].append('Amazon Topical-Chat (CDLA-Sharing 1.0); aggregate n-gram statistics from deduplicated training turns')
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
  # Replace the file atomically: an open keyboard/test process may still have the
  # previous dictionary memory-mapped while a developer rebuilds language data.
  temporary = None
  try:
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.pkdict-', delete=False) as handle:
      temporary = Path(handle.name)
      handle.write(out)
    os.chmod(temporary, 0o644)
    os.replace(temporary, output)
  finally:
    if temporary is not None:
      temporary.unlink(missing_ok=True)
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
  parser.add_argument('--messages', help='Optional UCI SMSSpamCollection file for conversational n-grams (ham only; stable 20%% holdout).')
  parser.add_argument('--conversations', action='append', default=[], help='Optional Topical-Chat training JSON. Never pass validation/test splits.')
  parser.add_argument('--max-successors', type=int, default=48)
  args = parser.parse_args()
  build(args)
  build_emoji(args.emoji)


if __name__ == '__main__':
  main()
