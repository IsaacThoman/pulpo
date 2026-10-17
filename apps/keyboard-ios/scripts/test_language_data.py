import hashlib
import tempfile
import unittest
from pathlib import Path

import json
from build_language_data import conversation_training_texts, message_training_texts, parse_wordlist, quantize_interpolation_weight, sentence_tokens
from prepare_prediction_holdout import next_word_cases


class LanguageDataTests(unittest.TestCase):
  def test_finite_history_support_never_quantizes_away_backoff(self):
    for support in [1, 20, 1_000, 20_000, 1_000_000, 1_000_000_000]:
      weight = support / (support + 20)
      stored = quantize_interpolation_weight(weight)
      self.assertGreater(stored, 0)
      self.assertLess(stored / 255, 1)
    self.assertEqual(quantize_interpolation_weight(0), 0)

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

  def test_conversations_use_turns_only_and_exclude_training_duplicates(self):
    def conversation(messages):
      return {'c': {'article_url': 'Never train on metadata', 'content': [{'message': m, 'agent': 'Never train on speaker IDs'} for m in messages]}}
    with tempfile.TemporaryDirectory() as directory:
      train = Path(directory) / 'train.json'
      test = Path(directory) / 'test.json'
      train.write_text(json.dumps(conversation(['Hello there', 'hello there', 'Meet me tomorrow'])))
      test.write_text(json.dumps(conversation(['HELLO  there', 'Call me. See you later!'])))
      self.assertEqual(list(conversation_training_texts([train])), ['Hello there', 'Meet me tomorrow'])
      self.assertEqual(list(next_word_cases(test, [train])), [
        {'prefix': 'Call', 'expected': 'me'}, {'prefix': 'See', 'expected': 'you'}, {'prefix': 'See you', 'expected': 'later'},
      ])


if __name__ == '__main__':
  unittest.main()
