import hashlib
import tempfile
import unittest
from pathlib import Path

from build_language_data import message_training_texts, parse_wordlist, sentence_tokens


class LanguageDataTests(unittest.TestCase):
  def test_spelling_error_flags_and_shortcuts_survive_import(self):
    with tempfile.TemporaryDirectory() as directory:
      path = Path(directory) / 'words.combined'
      path.write_text(' word=wierd,f=0,not_a_word=true\n  shortcut=weird,f=whitelist\n word=weird,f=96,flags=\n')
      words, shortcuts = parse_wordlist(path)
      self.assertTrue(words['wierd']['not_a_word'])
      self.assertFalse(words['weird']['not_a_word'])
      self.assertEqual(shortcuts, [('wierd', 'weird')])

  def test_message_partition_excludes_spam_duplicates_and_holdout(self):
    messages = [f'This is message {i}' for i in range(30)]
    with tempfile.TemporaryDirectory() as directory:
      path = Path(directory) / 'messages.tsv'
      path.write_text('\n'.join(['spam\tDo not train on this'] + [f'ham\t{message}' for message in messages] + ['ham\t' + messages[0].upper()]))
      actual = list(message_training_texts(path))
      expected = [message for message in messages if hashlib.sha256(message.casefold().encode()).digest()[0] % 5 != 0]
      self.assertEqual(actual, expected)
      self.assertNotEqual(len(actual), len(messages))

  def test_sentence_boundaries_do_not_join_unrelated_words(self):
    self.assertEqual(list(sentence_tokens("I'm here. Are you?")), [["I'm", 'here'], ['Are', 'you']])


if __name__ == '__main__':
  unittest.main()
