#!/usr/bin/env python3
"""Build a literal-only spelling supplement and append it to an existing PKD1.

Export the pinned ESDB source with `./scowl word-list 60 A 1 --wo-poses=abbr`.
Pass that export, or the checked-in filtered word list, as --words. No existing
word IDs, frequencies, trie, glide buckets, shortcuts, or n-grams are changed.
"""

import argparse
import os
import re
import struct
import tempfile
from pathlib import Path


def select_validation_words(path, displays, shortcut_sources):
  """Retain ordinary lowercase spellings without overriding existing policy."""
  existing = {word.casefold() for word in displays}
  forbidden = {word.casefold() for word in shortcut_sources}
  return sorted({
    word for word in path.read_text(encoding='utf-8').splitlines()
    if re.fullmatch(r'[a-z]{3,}', word) and word not in existing and word not in forbidden
  })


def validation_payload(words):
  return ('\n'.join(words) + ('\n' if words else '')).encode('ascii')


def read_sections(data):
  if len(data) < 12 or data[:4] != b'PKD1':
    raise ValueError('not a PKD1 dictionary')
  version, count = struct.unpack_from('<II', data, 4)
  if version != 1 or 12 + count * 20 > len(data):
    raise ValueError('unsupported or truncated PKD1 header')
  sections = []
  seen = set()
  for index in range(count):
    tag, offset, length = struct.unpack_from('<4sQQ', data, 12 + index * 20)
    if tag in seen or offset + length > len(data):
      raise ValueError('invalid PKD1 section')
    seen.add(tag)
    sections.append((tag, data[offset:offset + length]))
  return sections


def uints(data):
  return struct.unpack(f'<{len(data) // 4}I', data)


def dictionary_displays(sections):
  parts = dict(sections)
  offsets = uints(parts[b'WKOF'])
  displays = [parts[b'WKEY'][a:b].decode('utf-8') for a, b in zip(offsets, offsets[1:])]
  overrides = uints(parts[b'DSID'])
  offsets = uints(parts[b'DSOF'])
  for index, word_id in enumerate(overrides):
    displays[word_id] = parts[b'DSTX'][offsets[index]:offsets[index + 1]].decode('utf-8')
  # This includes not_a_word display entries, so they remain excluded even when
  # an external spelling list contains the same spelling as a name or acronym.
  return displays


def encode_sections(sections):
  offset = (12 + len(sections) * 20 + 7) & ~7
  table = bytearray()
  payload = bytearray()
  for tag, data in sections:
    table += struct.pack('<4sQQ', tag, offset, len(data))
    padded = data + b'\0' * ((-len(data)) % 8)
    payload += padded
    offset += len(padded)
  header = b'PKD1' + struct.pack('<II', 1, len(sections)) + table
  return header + b'\0' * ((-len(header)) % 8) + payload


def append_validation_words(dictionary, words):
  sections = read_sections(dictionary)
  shortcuts = [line.split('\t', 1)[0] for line in dict(sections)[b'SHRT'].decode('utf-8').splitlines()]
  selected = select_validation_words(words, dictionary_displays(sections), shortcuts)
  sections = [(tag, data) for tag, data in sections if tag != b'VWRD']
  sections.append((b'VWRD', validation_payload(selected)))
  return encode_sections(sections), len(selected)


def atomic_write(path, data):
  path.parent.mkdir(parents=True, exist_ok=True)
  temporary = None
  try:
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.pkdict-', delete=False) as handle:
      temporary = Path(handle.name)
      handle.write(data)
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)
  finally:
    if temporary is not None:
      temporary.unlink(missing_ok=True)


def main():
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--dictionary', required=True, type=Path)
  parser.add_argument('--words', required=True, type=Path)
  parser.add_argument('--output', required=True, type=Path)
  parser.add_argument('--filtered-output', type=Path, help='Optionally save only the accepted spellings.')
  args = parser.parse_args()
  data, count = append_validation_words(args.dictionary.read_bytes(), args.words)
  atomic_write(args.output, data)
  if args.filtered_output:
    args.filtered_output.write_bytes(dict(read_sections(data))[b'VWRD'])
  print(f'{args.output.name}: {count} literal-only spellings, {len(data)} bytes')


if __name__ == '__main__':
  main()
