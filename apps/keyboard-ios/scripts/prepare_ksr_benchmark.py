#!/usr/bin/env python3
"""Prepare a keystroke-savings benchmark from held-out messages, outside the checkout.

The Swift runner (`KeystrokeSavingsBenchmarkTests`) replays every turn through
`KeyboardEngine` as an ideal user who taps the intended word as soon as the
suggestion bar shows it. This script only selects and canonicalizes text.

Sources (none are builder inputs except the exclusion files):
  * Topical-Chat `valid_freq.json` (develop), `test_freq.json` and
    `test_rare.json` (verify), CDLA-Sharing 1.0. `train.json` is read only to
    exclude duplicate turns.
  * UCI SMS Spam Collection, CC BY 4.0: only the builder's 20% ham holdout
    (first SHA-256 byte of the stripped, case-folded message modulo five is 0),
    split in half by a salted hash.
  * Google Taskmaster-1 `self-dialogs.json`, CC BY 4.0: written two-role
    dialogs, split by a salted hash of the conversation ID.
Turns that duplicate any Topical-Chat training turn, SMS training message, or
Tatoeba sentence after case/whitespace folding are excluded.

Example:
  python3 -I prepare_ksr_benchmark.py --corpora ~/pulpo-keyboard-bench/corpora \
    --taskmaster /tmp/self-dialogs.json --output /tmp/pk-ksr
"""
import argparse
import bz2
import gzip
import hashlib
import json
import re
from pathlib import Path

VERSION = 1
REPLACEMENTS = {
  '‘': "'", '’': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '″': '"',
  '‒': '-', '–': '-', '—': '-', '…': '...',
  ' ': ' ', '\t': ' ', '\r': ' ', '\n': ' ',
}
WORD_RUN = re.compile(r"[A-Za-z0-9']+")
ALPHA_WORD = re.compile(r"^[A-Za-z']*[A-Za-z][A-Za-z']*$")
SKIP = re.compile(r'https?:|www\.|@|&lt;|&gt;|&amp;|&#', re.IGNORECASE)
SPACE_BEFORE_PUNCTUATION = re.compile(r' +([.,!?;:])')
MISSING_SPACE = re.compile(r'(?<=[A-Za-z]{2})([.,!?;:]+)(?=[A-Z])')
PRONOUN_I = {'i', "i'm", "i'll", "i've", "i'd"}
MAX_CHARACTERS = 280


def fold_key(text):
  return hashlib.sha256(' '.join(text.casefold().split()).encode('utf-8')).digest()[:8]


def canonical(text):
  """ASCII text as typed with sentence auto-capitalization, or None to skip."""
  for source, target in REPLACEMENTS.items():
    text = text.replace(source, target)
  text = ' '.join(text.split())
  if not text or len(text) > MAX_CHARACTERS or SKIP.search(text):
    return None
  if any(not (32 <= ord(c) < 127) for c in text):
    return None
  # Keyboards attach punctuation to the previous word (smart spacing removes a
  # typed space before it) and a new sentence follows a space.
  text = SPACE_BEFORE_PUNCTUATION.sub(r'\1', text)
  text = MISSING_SPACE.sub(r'\1 ', capitalize(text))
  text = capitalize(text)
  if not any(ALPHA_WORD.match(w) for w in WORD_RUN.findall(text)):
    return None
  return text


def capitalize(text):
  """Sentence-initial letters and the pronoun I, as auto-capitalization types them."""
  pieces, last = [], 0
  for index, match in enumerate(WORD_RUN.finditer(text)):
    gap = text[last:match.start()]
    word = match.group()
    initial = index == 0 or (gap.endswith(' ') and any(c in '.!?' for c in gap))
    if word.lower() in PRONOUN_I:
      word = 'I' + word[1:]
    elif initial and word[0].islower():
      word = word[0].upper() + word[1:]
    pieces.append(gap)
    pieces.append(word)
    last = match.end()
  pieces.append(text[last:])
  return ''.join(pieces)


def salted(salt, *parts):
  return hashlib.sha256('|'.join((salt,) + parts).encode('utf-8')).hexdigest()


def sha256_file(path):
  digest = hashlib.sha256()
  with open(path, 'rb') as handle:
    for block in iter(lambda: handle.read(1 << 20), b''):
      digest.update(block)
  return digest.hexdigest()


def sms_messages(path):
  """Deduplicated ham as (text, is_builder_holdout); mirrors build_language_data.py."""
  seen = set()
  with open(path, encoding='utf-8') as handle:
    for line in handle:
      label, separator, text = line.rstrip('\n').partition('\t')
      key = text.strip().casefold()
      if label != 'ham' or not separator or not key or key in seen:
        continue
      seen.add(key)
      yield text, hashlib.sha256(key.encode('utf-8')).digest()[0] % 5 == 0


def training_keys(corpora):
  keys = set()
  with open(corpora / 'train.json', encoding='utf-8') as handle:
    for conversation in json.load(handle).values():
      for turn in conversation['content']:
        keys.add(fold_key(turn['message']))
  for text, holdout in sms_messages(corpora / 'SMSSpamCollection'):
    if not holdout:
      keys.add(fold_key(text))
  with bz2.open(corpora / 'eng_sentences.tsv.bz2', 'rt', encoding='utf-8') as handle:
    for line in handle:
      parts = line.rstrip('\n').split('\t')
      if len(parts) >= 3:
        keys.add(fold_key(parts[2]))
  return keys


def valid_words(corpora, extra_words):
  words = set()
  with gzip.open(corpora / 'en_US_wordlist.combined.gz', 'rt', encoding='utf-8') as handle:
    for line in handle:
      if line.startswith(' word='):
        fields = dict(part.split('=', 1) for part in line.strip().split(','))
        if fields.get('not_a_word') != 'true':
          words.add(fields['word'].lower())
  if extra_words and extra_words.exists():
    for line in extra_words.read_text(encoding='utf-8').splitlines():
      if line.strip() and not line.startswith('#'):
        words.add(line.split('\t')[0].lower())
  return words


class Collector:
  def __init__(self, excluded):
    self.excluded = excluded
    self.stats = {}

  def turns(self, source, texts):
    stats = self.stats.setdefault(source, {'turns': 0, 'kept': 0, 'contaminated': 0, 'skipped': 0})
    kept = []
    for text in texts:
      stats['turns'] += 1
      if fold_key(text) in self.excluded:
        stats['contaminated'] += 1
        continue
      value = canonical(text)
      if value is None:
        stats['skipped'] += 1
        continue
      if fold_key(value) in self.excluded:
        stats['contaminated'] += 1
        continue
      stats['kept'] += 1
      kept.append(value)
    return kept


def topical_sessions(collector, path, source, salt, count):
  with open(path, encoding='utf-8') as handle:
    conversations = json.load(handle)
  ranked = sorted(conversations, key=lambda cid: salted(salt, 'topical', source, cid))[:count]
  sessions = []
  for cid in ranked:
    content = conversations[cid]['content']
    for agent in ('agent_1', 'agent_2'):
      turns = collector.turns(source, [t['message'] for t in content if t['agent'] == agent])
      if turns:
        sessions.append({'source': source, 'id': f'{cid}/{agent}', 'turns': turns})
  return sessions


def taskmaster_sessions(collector, path, salt, counts):
  with open(path, encoding='utf-8') as handle:
    dialogs = json.load(handle)
  sides = {'develop': [], 'verify': []}
  for dialog in dialogs:
    digest = salted(salt, 'taskmaster', dialog['conversation_id'])
    sides['develop' if int(digest[:2], 16) % 2 == 0 else 'verify'].append((digest, dialog))
  result = {}
  for side, rows in sides.items():
    rows.sort(key=lambda row: row[0])
    sessions = []
    for _, dialog in rows[:counts[side]]:
      turns = collector.turns('taskmaster', [u['text'] for u in dialog['utterances']])
      if turns:
        sessions.append({'source': 'taskmaster', 'id': dialog['conversation_id'], 'turns': turns})
    result[side] = sessions
  return result


def sms_sessions(collector, path, salt):
  result = {'develop': [], 'verify': []}
  for text, holdout in sms_messages(path):
    if not holdout:
      continue
    digest = salted(salt, 'sms', text.strip().casefold())
    side = 'develop' if int(digest[:2], 16) % 2 == 0 else 'verify'
    turns = collector.turns('sms', [text])
    if turns:
      result[side].append((digest, {'source': 'sms', 'id': digest[:16], 'turns': turns}))
  return {side: [row for _, row in sorted(rows, key=lambda r: r[0])] for side, rows in result.items()}


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--corpora', required=True, type=Path, help='Directory with Topical-Chat splits, SMSSpamCollection, eng_sentences.tsv.bz2 and en_US_wordlist.combined.gz.')
  parser.add_argument('--taskmaster', required=True, type=Path, help='Taskmaster-1 TM-1-2019/self-dialogs.json.')
  parser.add_argument('--extra-words', type=Path, default=Path(__file__).with_name('extra_words.tsv'))
  parser.add_argument('--output', required=True, type=Path)
  parser.add_argument('--salt', default='pk-ksr-r1')
  parser.add_argument('--topical-conversations', type=int, default=60, help='Conversations per Topical-Chat file.')
  parser.add_argument('--taskmaster-dialogs', type=int, default=150, help='Dialogs per partition.')
  args = parser.parse_args()

  excluded = training_keys(args.corpora)
  collector = Collector(excluded)
  develop = topical_sessions(collector, args.corpora / 'valid_freq.json', 'topical-valid_freq', args.salt, args.topical_conversations)
  verify = (topical_sessions(collector, args.corpora / 'test_freq.json', 'topical-test_freq', args.salt, args.topical_conversations)
            + topical_sessions(collector, args.corpora / 'test_rare.json', 'topical-test_rare', args.salt, args.topical_conversations))
  sms = sms_sessions(collector, args.corpora / 'SMSSpamCollection', args.salt)
  taskmaster = taskmaster_sessions(collector, args.taskmaster, args.salt,
                                   {'develop': args.taskmaster_dialogs, 'verify': args.taskmaster_dialogs})
  partitions = {'develop': develop + sms['develop'] + taskmaster['develop'],
                'verify': verify + sms['verify'] + taskmaster['verify']}
  dictionary = valid_words(args.corpora, args.extra_words)

  args.output.mkdir(parents=True, exist_ok=True)
  manifest = {'version': VERSION, 'salt': args.salt, 'excludedTrainingKeys': len(excluded), 'topicalConversations': args.topical_conversations,
              'taskmasterDialogs': args.taskmaster_dialogs, 'filters': collector.stats, 'inputs': {}, 'outputs': {}}
  for name in ('valid_freq.json', 'test_freq.json', 'test_rare.json', 'train.json', 'SMSSpamCollection',
               'eng_sentences.tsv.bz2', 'en_US_wordlist.combined.gz'):
    manifest['inputs'][name] = sha256_file(args.corpora / name)
  manifest['inputs']['self-dialogs.json'] = sha256_file(args.taskmaster)
  for side, sessions in partitions.items():
    words = sorted({w.lower() for s in sessions for t in s['turns'] for w in WORD_RUN.findall(t)
                    if ALPHA_WORD.match(w) and w.lower() in dictionary})
    payload = {'version': VERSION, 'partition': side, 'salt': args.salt, 'sessions': sessions, 'validWords': words}
    path = args.output / f'{side}.json'
    path.write_text(json.dumps(payload, ensure_ascii=True, separators=(',', ':')), encoding='utf-8')
    by_source = {}
    for s in sessions:
      row = by_source.setdefault(s['source'], {'sessions': 0, 'turns': 0, 'characters': 0})
      row['sessions'] += 1
      row['turns'] += len(s['turns'])
      row['characters'] += sum(len(t) for t in s['turns'])
    manifest['outputs'][side] = {'sha256': sha256_file(path), 'sources': by_source}
    print(side, json.dumps(by_source))
  (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')


if __name__ == '__main__':
  main()
