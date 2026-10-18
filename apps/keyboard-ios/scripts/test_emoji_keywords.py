import copy
import tempfile
import unittest
from pathlib import Path

from build_language_data import add_emoji_keywords, emoji_annotation_keywords


class EmojiKeywordTests(unittest.TestCase):
  def write_annotations(self, directory, name, text, language='en'):
    path = Path(directory) / name
    path.write_text(f'<ldml><identity><language type="{language}"/></identity>'
                    f'<annotations>{text}</annotations></ldml>', encoding='utf-8')
    return path

  def test_merges_keywords_and_tts_names_without_variation_selector_duplicates(self):
    with tempfile.TemporaryDirectory() as directory:
      base = self.write_annotations(directory, 'base.xml',
        '<annotation cp="☕">coffee | drink | coffee</annotation>'
        '<annotation cp="☕" type="tts">hot beverage</annotation>')
      derived = self.write_annotations(directory, 'derived.xml',
        '<annotation cp="☕️">caffeine | drink</annotation>'
        '<annotation cp="🫂">↑↑↑</annotation>')
      self.assertEqual(emoji_annotation_keywords([base, derived]),
                       {'☕': ['caffeine', 'coffee', 'drink', 'hot beverage']})

  def test_enrichment_preserves_catalog_data_and_only_retains_available_sequences(self):
    original = {'version': '18.0', 'categories': [{'id': 'people', 'name': 'People', 'emoji': [
      {'e': '👍', 'n': 'thumbs up', 'v': 0.6, 't': ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']},
      {'e': '🫪', 'n': 'new emoji', 'v': 18.0},
    ]}]}
    with tempfile.TemporaryDirectory() as directory:
      source = self.write_annotations(directory, 'base.xml',
        '<annotation cp="👍">good | hand | yes</annotation>'
        '<annotation cp="☕">coffee</annotation>')
      enriched = add_emoji_keywords(copy.deepcopy(original), [source])
      self.assertEqual(enriched['categories'][0]['emoji'][0]['k'], ['good', 'hand', 'yes'])
      self.assertNotIn('k', enriched['categories'][0]['emoji'][1])
      for emoji in enriched['categories'][0]['emoji']:
        emoji.pop('k', None)
      self.assertEqual(enriched, original)

  def test_rejects_accidental_non_english_annotation_input(self):
    with tempfile.TemporaryDirectory() as directory:
      source = self.write_annotations(directory, 'fr.xml', '<annotation cp="👍">oui</annotation>', language='fr')
      with self.assertRaisesRegex(ValueError, 'English CLDR'):
        emoji_annotation_keywords([source])


if __name__ == '__main__':
  unittest.main()
