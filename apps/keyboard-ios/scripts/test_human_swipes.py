import json
import math
import pathlib
import tempfile
import unittest
import zipfile

from prepare_human_swipes import CANVAS_ROWS, normalize, participant_split, prepare, renormalize, trajectories


def collection_layout(document_width, document_height):
    """Letter boxes and canvas size as js/main.js and js/keyboard-impl.js build them (portrait)."""
    w, h = document_width / 10, document_height * 0.3 / 4
    boxes = {}
    for row, (letters, offset) in enumerate((("qwertyuiop", 0), ("asdfghjkl", w / 2), ("zxcvbnm", w * 1.5))):
        for column, letter in enumerate(letters):
            boxes[letter] = (w * column + 1 + offset, h * row + 1, w - 1, h - 1)
    # measure(): ten keys' widths, three letter rows plus the 0.7-high dummy row.
    # Assigning canvas.width/height truncates to whole pixels.
    return boxes, math.floor(10 * w), math.floor(3 * h + 0.7 * h)


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

    def test_collection_key_centers_land_on_model_centers(self):
        # The logged keyboard height is the canvas: 3.7 key pitches, not four.
        # LetterGeometry.qwerty in key pitches.
        model = {letter: (start + column, row)
                 for row, letters, start in ((0, "qwertyuiop", 0.5), (1, "asdfghjkl", 1.0), (2, "zxcvbnm", 2.0))
                 for column, letter in enumerate(letters)}
        for width, height in ((360, 775), (411, 868), (375, 703)):
            boxes, canvas_width, canvas_height = collection_layout(width, height)
            for letter, (x, y, w, h) in boxes.items():
                (cx, cy), = normalize([(x + w / 2, y + h / 2, 0)], canvas_width, canvas_height)
                self.assertAlmostEqual(cx, model[letter][0], delta=0.01, msg=letter)
                self.assertAlmostEqual(cy, model[letter][1], delta=0.01, msg=letter)
            # Presses on the dummy row are never logged as touch-downs; it begins
            # half a pitch below the bottom letter row's center.
            (_, boundary), = normalize([(0, 3 * canvas_height / CANVAS_ROWS + 1, 0)], canvas_width, canvas_height)
            self.assertAlmostEqual(boundary, 2.5, delta=0.02)

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
            self.assertEqual(case["points"][0], [59.5 / 40, 24.5 / (200 / 3.7) - 0.5])
            self.assertEqual(case["times"], [0, 0.001])
            self.assertNotIn("person", case["participant"])

    def test_renormalize_changes_only_points_and_keeps_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = pathlib.Path(directory)
            archive = directory / "traces.zip"
            with zipfile.ZipFile(archive, "w") as source:
                source.writestr("swipelogs/person.log", "\n".join([
                    "practice 1 400 200 touchstart 1 1 1 1 0 no 0",
                    "we_try 2 400 200 touchstart 60 25 1 1 0 we 0",
                    "we_try 3 400 200 touchend 100 25 1 1 0 we 0",
                    "we_try 4 400 200 touchstart 300 100 1 1 0 try 0",
                    "we_try 5 400 200 touchend 220 30 1 1 0 try 0",
                ]))
            prepare(archive, directory / "fresh", 0)
            split = participant_split("person")
            fresh = json.loads((directory / "fresh" / (split + ".json")).read_text())
            # An older sample: reversed order, an annotation, and stale coordinates.
            stale = [{**case, "points": [[0, 0]] * len(case["points"]), "prefix": "We "} for case in reversed(fresh)]
            sample = directory / "old" / "sample.json"
            sample.parent.mkdir()
            sample.write_text(json.dumps(stale, separators=(",", ":")) + "\n")
            renormalize(archive, [sample], directory / "new")
            rewritten = json.loads((directory / "new" / "sample.json").read_text())
            self.assertEqual([case["id"] for case in rewritten], [case["id"] for case in stale])
            self.assertEqual([case["points"] for case in rewritten], [case["points"] for case in reversed(fresh)])
            for old, new in zip(stale, rewritten):
                self.assertEqual({**old, "points": None}, {**new, "points": None})
            manifest = json.loads((directory / "new" / "manifest.json").read_text())
            self.assertEqual(manifest["samples"]["sample.json"]["count"], 2)
            with self.assertRaises(ValueError):
                renormalize(archive, [sample], directory / "old")
            sample.write_text(json.dumps([{**stale[0], "times": [0, 1]}]) + "\n")
            with self.assertRaises(ValueError):
                renormalize(archive, [sample], directory / "mismatch")


if __name__ == "__main__":
    unittest.main()
