import hashlib
import json
import math
import struct
import tempfile
import unittest
from pathlib import Path

from build_multilingual_data import author_attribution, merge_dictionaries, packed, vocabulary_sections
from build_validation_words import dictionary_displays, encode_sections, read_sections, uints

DATA = Path(__file__).resolve().parent.parent / 'LanguageData'


class MultilingualDataTests(unittest.TestCase):
  def test_bundled_resources_are_pinned_and_english_is_unchanged(self):
    expected = {
      'en_US.pkdict': '168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64',
      'es.pkdict': '66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb',
      'en_es.pkdict': '93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237',
      'TATOEBA-SPANISH-AUTHORS.txt': 'acc6388b3bff0048563d4a92256c59ed88f61d8ab385b3e81267f89318007980',
    }
    for name, digest in expected.items():
      with self.subTest(resource=name):
        self.assertEqual(hashlib.sha256((DATA / name).read_bytes()).hexdigest(), digest)

  def test_bilingual_dictionary_reproduces_from_bundled_monolingual_inputs(self):
    result = merge_dictionaries((DATA / 'en_US.pkdict').read_bytes(), (DATA / 'es.pkdict').read_bytes())
    self.assertEqual(result, (DATA / 'en_es.pkdict').read_bytes())

  def test_every_remapped_ngram_and_trie_range_is_in_bounds(self):
    for language in ['es', 'en_es']:
      with self.subTest(language=language):
        sections = dict(read_sections((DATA / f'{language}.pkdict').read_bytes()))
        metadata = json.loads(sections[b'META'])
        count = metadata['wordCount']
        self.assertGreater(count, 10000)
        self.assertEqual(len(dictionary_displays(sections.items())), count)
        for offset_tag, id_tag, score_tag, histories in [
            (b'BGOF', b'BGID', b'BGSC', count + 1),
            (b'TGOF', b'TGID', b'TGSC', metadata['trigramHistories'])]:
          offsets, ids = uints(sections[offset_tag]), uints(sections[id_tag])
          self.assertEqual(len(offsets), histories + 1)
          self.assertEqual(offsets[-1], len(ids))
          self.assertEqual(len(ids), len(sections[score_tag]))
          self.assertTrue(all(a <= b for a, b in zip(offsets, offsets[1:])))
          self.assertTrue(all(word < count for word in ids))
        histories = struct.unpack(f'<{metadata["trigramHistories"]}Q', sections[b'TGHI'])
        self.assertEqual(list(histories), sorted(set(histories)))
        self.assertTrue(all((h >> 32) < count and (h & 0xffffffff) < count for h in histories))
        nodes = list(struct.iter_unpack('<IIIBBBB', sections[b'TRIE']))
        for first, lo, hi, byte, children, terminals, frequency in nodes:
          self.assertLessEqual(first + children, len(nodes))
          self.assertLessEqual(lo, hi)
          self.assertLessEqual(hi, count)
          self.assertLessEqual(lo + terminals, hi)

  def test_remapping_retains_english_contextual_probabilities(self):
    original = dict(read_sections((DATA / 'en_US.pkdict').read_bytes()))
    merged = dict(read_sections((DATA / 'en_es.pkdict').read_bytes()))

    def successors(sections, history):
      words = dictionary_displays(sections.items())
      i = len(words) if history is None else words.index(history)
      offsets, ids = uints(sections[b'BGOF']), uints(sections[b'BGID'])
      return {words[ids[p]]: sections[b'BGSC'][p] for p in range(offsets[i], offsets[i + 1])}

    before, after = successors(original, 'thank'), successors(merged, 'thank')
    self.assertIn('you', before)
    self.assertEqual(before, after)
    # The English literal-only vocabulary must also survive the merge.
    self.assertEqual(original[b'VWRD'], merged[b'VWRD'])

  def test_merge_keeps_accent_collisions_and_valid_spanish_over_english_typo_flags(self):
    def fixture(words):
      entries, sections = vocabulary_sections([(key, -frequency, display, flags)
                                              for key, display, frequency, flags in words])
      count = len(entries)
      sections.extend([(b'BGOF', packed([0] * (count + 2))), (b'BGID', b''),
                       (b'BGSC', b''), (b'BGBO', bytes(count + 1)),
                       (b'SHRT', b'ano\ta\xc3\xb1o'),
                       (b'META', json.dumps({'wordCount': count, 'unigramIntercept': -20,
                        'unigramSlope': .08, 'bigramQuant': 12, 'sources': ['test']}).encode())])
      return encode_sections(sections)

    english = fixture([('ano', 'ano', 90, 33), ('hello', 'hello', 120, 2), ('blocked', 'blocked', 90, 1)])
    spanish = fixture([('ano', 'ano', 100, 2), ('ano', 'año', 170, 2), ('blocked', 'blocked', 90, 2)])
    sections = dict(read_sections(merge_dictionaries(english, spanish)))
    displays = dictionary_displays(sections.items())
    self.assertEqual(set(displays), {'ano', 'año', 'hello', 'blocked'})
    self.assertEqual(sections[b'WFLG'][displays.index('ano')] & 33, 0)
    self.assertEqual(sections[b'WFLG'][displays.index('blocked')] & 1, 1)
    self.assertNotIn(b'ano\t', sections[b'SHRT'])
    self.assertEqual(json.loads(sections[b'META'])['unigramIntercept'], -20 - math.log(2))

  def test_attribution_matches_the_actual_training_export(self):
    with tempfile.TemporaryDirectory() as directory:
      basic, detailed = Path(directory) / 'sentences', Path(directory) / 'detailed'
      basic.write_text('1\tspa\tHola.\n2\tspa\tGracias.\n')
      detailed.write_text('1\tspa\tHola.\tMaría\ttime\n2\tspa\tGracias.\tMaría\ttime\n')
      credit = author_attribution(basic, detailed).decode()
      self.assertEqual(credit.count('María'), 1)
      self.assertNotIn('Hola.', credit)
      detailed.write_text('1\tspa\tDifferent.\tMaría\ttime\n')
      with self.assertRaisesRegex(ValueError, 'exports differ'):
        author_attribution(basic, detailed)


if __name__ == '__main__':
  unittest.main()
