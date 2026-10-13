import json
import pathlib
import tempfile
import unittest
import zipfile

from prepare_human_swipes import participant_split, prepare, trajectories


class HumanSwipePreparationTests(unittest.TestCase):
    def test_keeps_release_and_excludes_practice_and_malformed_duplicates(self):
        rows = [
            "practice 1 400 200 touchstart 1 1 1 1 0 no 0",
            "practice 2 400 200 touchend 2 2 1 1 0 no 0",
            "we_try 3 400 200 touchstart 60 25 1 1 0 we 0",
            "we_try 4 400 200 touchmove 80 30 1 1 0 we 0",
            "we_try 4 400 200 touchmove 80 30 1 1 0 we 0 0",
            "we_try 5 400 200 touchend 100 25 1 1 0 we 0",
        ]
        chunks = list(trajectories(rows))
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0][1], [(60, 25, 3), (80, 30, 4), (100, 25, 5)])

    def test_separates_retries_and_tolerates_missing_start(self):
        rows = [
            "practice 1 400 200 touchstart 1 1 1 1 0 no 0",
            "a_test 2 400 200 touchmove 20 25 1 1 0 test 1",
            "a_test 3 400 200 touchend 40 25 1 1 0 test 1",
            "a_test 4 400 200 touchstart 20 25 1 1 0 test 0",
            "a_test 5 400 200 touchend 100 25 1 1 0 test 0",
        ]
        chunks = list(trajectories(rows))
        self.assertEqual([key[2] for key, _ in chunks], ["1", "0"])
        self.assertEqual([len(points) for _, points in chunks], [2, 2])

    def test_coordinate_conversion_and_participant_split_are_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = pathlib.Path(directory)
            archive = directory / "traces.zip"
            with zipfile.ZipFile(archive, "w") as source:
                source.writestr("swipelogs/person.log", "\n".join([
                    "practice 1 400 200 touchstart 1 1 1 1 0 no 0",
                    "we_try 2 400 200 touchstart 60 25 1 1 0 we 0",
                    "we_try 3 400 200 touchend 100 25 1 1 0 we 0",
                ]))
            for label in ("one", "two"):
                prepare(archive, directory / label, 0)
            split = participant_split("person")
            output = directory / "one" / (split + ".json")
            self.assertEqual(output.read_bytes(), (directory / "two" / output.name).read_bytes())
            case = json.loads(output.read_text())[0]
            self.assertEqual(case["points"][0], [59.5 / 40, 24.5 / 50 - 0.5])
            self.assertEqual(case["times"], [0, 0.001])
            self.assertNotIn("person", case["participant"])


if __name__ == "__main__":
    unittest.main()
