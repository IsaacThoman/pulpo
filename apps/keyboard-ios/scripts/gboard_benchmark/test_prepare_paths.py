"""Fixtures for preserving the geometry/timestamp relationship in replay input."""
import unittest

from prepare_paths import prepare_item


class PreparePathsTests(unittest.TestCase):
  def test_baseline_retains_corner_and_interpolates_its_time(self):
    # The first segment is slow, the second fast; equal spacing must not imply
    # equal timing or accidentally reuse the original five timestamp entries.
    source = {'points': [[0, 0], [0.3, 0], [1.2, 0], [1.2, 0.3], [1.2, 1.2]],
              'times': [10, 11, 14, 14.1, 14.4]}
    result = prepare_item(source)
    self.assertEqual(result['points'], [[0, 0], [0.6, 0], [1.2, 0], [1.2, 0.6], [1.2, 1.2]])
    self.assertEqual(result['times'], [10, 12, 14, 14.2, 14.4])
    self.assertEqual(source['times'], [10, 11, 14, 14.1, 14.4])

  def test_revisited_coordinate_keeps_its_later_timestamp(self):
    source = {'points': [[0, 0], [1.2, 0], [0, 0], [0, 1.2]],
              'times': [0, 2, 5, 9]}
    result = prepare_item(source)
    self.assertEqual(result['points'][4], [0, 0])
    self.assertEqual(result['times'][4], 5)
    self.assertEqual(result['times'], [0, 1, 2, 3.5, 5, 7, 9])

  def test_recorded_mode_keeps_stationary_samples_and_pause(self):
    source = {'word': 'test', 'points': [[0, 0], [0, 0], [0.01, 0], [2, 0]],
              'times': [3.5, 3.5, 5.0, 5.017]}
    result = prepare_item(source, 'recorded')
    self.assertEqual(result['points'], source['points'])
    self.assertEqual(result['times'], source['times'])
    self.assertEqual(result['replayTiming'], 'recorded')
    result['points'][0][0] = 9
    self.assertEqual(source['points'][0][0], 0)

  def test_baseline_supports_untimed_paths(self):
    result = prepare_item({'points': [[0, 0], [1.2, 0]]})
    self.assertEqual(result['points'], [[0, 0], [0.6, 0], [1.2, 0]])
    self.assertNotIn('times', result)

  def test_rejects_timestamp_misalignment_and_nonfinite_or_reversed_time(self):
    for times in (None, [0], [0, float('nan')], [0, -1]):
      with self.subTest(times=times), self.assertRaises(ValueError):
        prepare_item({'points': [[0, 0], [1, 1]], 'times': times}, 'recorded')


if __name__ == '__main__':
  unittest.main()
