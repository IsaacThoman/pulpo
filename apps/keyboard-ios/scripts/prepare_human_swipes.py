#!/usr/bin/env python3
"""Prepare external How-We-Swipe logs for participant-disjoint decoder audits.

Download swipelogs.zip from https://osf.io/sj67f/ separately. Raw data and
generated cases belong outside Git. This script does not train the dictionary.
The source dataset is MIT licensed, copyright 2021 L. A. Leiva, S. Kim,
W. Cui, X. Bi, and A. Oulasvirta; see the dataset's OSF license metadata.

--renormalize rewrites existing samples' points under the current geometry,
matching gestures by id, so frozen selections stay comparable.
"""

import argparse
import collections
import hashlib
import json
import pathlib
import re
import zipfile

# Collection keyboard geometry, from js/keyboard-impl.js and js/main.js in
# github.com/luileito/swipetest. main.js sets the key pitch to width / 10 and
# container height / 4, because measure() counts four rows, then sizes the
# canvas to the layout: three letter rows plus a 0.7-pitch dummy space row.
# The logged keyboard height is that canvas, so a row is height / 3.7. (The
# authors' own analysis scripts divide by four.) Each key has a one-pixel
# left/top margin, so centers sit at pitch / 2 + 0.5 pixels.
COLUMNS = 10
CANVAS_ROWS = 3.7


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def normalize(points, width, height):
    """Canvas pixels to key pitches: q's center is (0.5, 0) and rows are 1 apart."""
    pitch_x, pitch_y = width / COLUMNS, height / CANVAS_ROWS
    return [[(x - 0.5) / pitch_x, (y - 0.5) / pitch_y - 0.5] for x, y, *_ in points]


def participant_split(user):
    # Freeze by participant, not gesture: one person's motor habits must not
    # occur on both sides of a tuning/verification comparison.
    return "verify" if int(digest("hws-participant-v1:" + user)[:8], 16) % 5 == 0 else "develop"


def trajectories(lines):
    """Keep original start AND lift coordinates; tolerate missing browser events.

    Some malformed duplicate rows have an extra error flag. Match the authors'
    accepted 12-column schema, retaining failed attempts as a separate stratum.
    """
    chunk = []
    previous = None
    first_sentence = None
    for line in lines:
        row = line.split()
        if len(row) != 12 or row[11] not in ("0", "1"):
            continue
        sentence, timestamp, width, height, event, x, y, _, _, _, word, failed = row
        if not re.fullmatch(r"[a-z]+", word):
            continue
        if first_sentence is None:
            first_sentence = sentence
        # The first sentence is practice in the collection protocol.
        if sentence == first_sentence:
            continue
        key = (sentence, word, failed, width, height)
        if key != previous or event == "touchstart":
            if chunk:
                yield previous, chunk
            chunk = []
        previous = key
        if event in ("touchstart", "touchmove", "touchend"):
            point = (int(x), int(y), int(timestamp))
            if not chunk or chunk[-1] != point:
                chunk.append(point)
        if event == "touchend":
            if chunk:
                yield key, chunk
            chunk = []
    if chunk:
        yield previous, chunk


def gestures(archive):
    """Every trajectory with its participant and stable identifier."""
    with zipfile.ZipFile(archive) as source:
        for name in sorted(source.namelist()):
            if not name.endswith(".log"):
                continue
            user = pathlib.PurePosixPath(name).stem
            for ordinal, (key, points) in enumerate(trajectories(source.read(name).decode().splitlines())):
                yield user, digest(f"{user}:{key[0]}:{ordinal}"), key, points


def prepare(archive, output, limit):
    groups = collections.defaultdict(list)
    counts = collections.Counter()
    for user, identifier, key, points in gestures(archive):
        sentence, word, failed, width, height = key
        if len(set((x, y) for x, y, _ in points)) < 2:
            counts["stationary"] += 1
            continue
        w, h = int(width), int(height)
        if w <= 0 or h <= 0:
            counts["invalid_geometry"] += 1
            continue
        groups[(participant_split(user), failed)].append({
            "id": identifier, "participant": digest(user), "word": word,
            "points": normalize(points, w, h),
            "times": [(t - points[0][2]) / 1000 for _, _, t in points],
            "sentence": sentence.replace("_", " "),
        })
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"source": "https://osf.io/sj67f/", "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(), "excluded": dict(counts), "splits": {}}
    for (split, failed), cases in sorted(groups.items()):
        cases.sort(key=lambda case: digest("hws-order-v1:" + case["id"]))
        selected = cases[:limit] if limit else cases
        label = split + ("-failed" if failed == "1" else "")
        path = output / (label + ".json")
        path.write_text(json.dumps(selected, separators=(",", ":")) + "\n")
        manifest["splits"][label] = {"available": len(cases), "selected": len(selected), "participants": len(set(c["participant"] for c in selected)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


def renormalize(archive, samples, output):
    """Recompute the points of existing samples from the archive, by gesture id.

    Selection, order, times and any added fields are kept, so a sample frozen
    under an earlier geometry differs only in its coordinates.
    """
    if len({path.name for path in samples}) != len(samples):
        raise ValueError("samples must have distinct file names")
    loaded = {path: json.loads(path.read_text()) for path in samples}
    wanted = {case["id"] for cases in loaded.values() for case in cases}
    found = {}
    for user, identifier, key, points in gestures(archive):
        if identifier in wanted:
            found[identifier] = (user, key, points)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(), "canvasRows": CANVAS_ROWS, "samples": {}}
    for path, cases in loaded.items():
        for case in cases:
            if case["id"] not in found:
                raise ValueError(f"{path.name}: gesture {case['id']} is not in the archive")
            user, (_, word, _, width, height), points = found[case["id"]]
            times = [(t - points[0][2]) / 1000 for _, _, t in points]
            if (case["participant"], case["word"], case.get("times", times)) != (digest(user), word, times):
                raise ValueError(f"{path.name}: gesture {case['id']} does not match the archive")
            case["points"] = normalize(points, int(width), int(height))
        target = output / path.name
        if target.resolve() == path.resolve():
            raise ValueError(f"refusing to overwrite {path}")
        target.write_text(json.dumps(cases, separators=(",", ":")) + "\n")
        manifest["samples"][path.name] = {
            "source": str(path), "sourceSHA256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "count": len(cases), "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--limit", type=int, default=3000, help="Per split/stratum; zero selects all")
    parser.add_argument("--renormalize", type=pathlib.Path, nargs="+", metavar="SAMPLE",
                        help="Rewrite these existing samples into OUTPUT instead of selecting new ones")
    args = parser.parse_args()
    if args.renormalize:
        renormalize(args.archive, args.renormalize, args.output)
    else:
        prepare(args.archive, args.output, args.limit)
