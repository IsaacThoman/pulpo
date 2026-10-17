import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from build_validation_words import append_validation_words, encode_sections, read_sections, select_validation_words


class ValidationWordsTests(unittest.TestCase):
  def test_selection_keeps_spellings_separate_from_keys_and_excludes_policy_sources(self):
    with tempfile.TemporaryDirectory() as directory:
      words = Path(directory) / 'words.txt'
      words.write_text("fir\nFir\nyew\na\nx2\ndiff's\ndiffs\nhello\namd\nmote\nthier\n")
      selected = select_validation_words(words, ['hello', 'AMD', 'mote', "diff's"], ['thier'])
      self.assertEqual(selected, ['diffs', 'fir', 'yew'])

  def test_appending_preserves_all_original_section_payloads_and_is_reproducible(self):
    import struct
    sections = [
      (b'WKEY', b'amddiffshello'), (b'WKOF', struct.pack('<4I', 0, 3, 8, 13)),
      (b'DSID', struct.pack('<2I', 0, 1)), (b'DSOF', struct.pack('<3I', 0, 3, 9)),
      (b'DSTX', b"AMDdiff's"), (b'SHRT', b'thier\ttheir'),
      (b'META', b'{"wordCount":3}'), (b'TRIE', b'preserve trie bytes'),
      (b'BGID', b'preserve ngram word IDs'), (b'GLID', b'preserve glide IDs'),
    ]
    original = encode_sections(sections)
    with tempfile.TemporaryDirectory() as directory:
      words = Path(directory) / 'words.txt'
      words.write_text('fir\ndiffs\namd\nthier\nyew\n')
      updated, count = append_validation_words(original, words)
      self.assertEqual(count, 3)
      self.assertEqual(dict(read_sections(updated))[b'VWRD'], b'diffs\nfir\nyew\n')
      for tag, payload in sections:
        self.assertEqual(dict(read_sections(updated))[tag], payload)
      self.assertEqual(append_validation_words(original, words)[0], updated)
      self.assertEqual(append_validation_words(updated, words)[0], updated)

  def test_rejects_bad_or_truncated_dictionary_headers(self):
    for data in [b'', b'not a dictionary', b'PKD1\x01\x00\x00\x00\x01\x00\x00\x00']:
      with self.assertRaises(ValueError):
        read_sections(data)

  def test_full_builder_filters_the_optional_vocabulary(self):
    import build_language_data as builder
    with tempfile.TemporaryDirectory() as directory:
      root = Path(directory)
      (root / 'scripts').mkdir()
      for name in ['extra_words.tsv', 'extra_shortcuts.tsv']:
        (root / 'scripts' / name).write_text('')
      low = ['alpha', 'bravo', 'cedar', 'delta', 'eagle', 'note']
      high = ['green', 'house', 'ivory', 'jelly', 'kitten', 'lemon']
      wordlist = root / 'words.combined'
      wordlist.write_text(''.join(f' word={word},f={frequency}\n' for words, frequency in [(low, 100), (high, 200)] for word in words)
                          + ' word=mote,f=50,not_a_word=true\n  shortcut=note,f=whitelist\n')
      sentences = root / 'sentences.tsv'
      sentences.write_text('1\teng\t' + ' '.join(low) + '\n' + ''.join(f'{i + 2}\teng\t' + ' '.join(high) + '\n' for i in range(10)))
      vocabulary = root / 'accepted.txt'
      vocabulary.write_text('fir\ndiffs\nnote\nmote\n')
      args = SimpleNamespace(wordlist=wordlist, sentences=sentences, messages=None,
                             conversations=[], max_successors=48, validation_wordlist=vocabulary)
      with patch.object(builder, 'ROOT', root), contextlib.redirect_stdout(io.StringIO()):
        builder.build(args)
      sections = dict(read_sections((root / 'LanguageData' / 'en_US.pkdict').read_bytes()))
      self.assertEqual(sections[b'VWRD'], b'diffs\nfir\n')
      self.assertIn(b'mote\tnote', sections[b'SHRT'])


if __name__ == '__main__':
  unittest.main()
