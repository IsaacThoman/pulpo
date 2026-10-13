#!/usr/bin/env python3
"""Prepare external How-We-Swipe logs for participant-disjoint decoder audits.

Download swipelogs.zip from https://osf.io/sj67f/ separately. Raw data and
generated cases belong outside Git. This script does not train the dictionary.
The source dataset is MIT licensed, copyright 2021 L. A. Leiva, S. Kim,
W. Cui, X. Bi, and A. Oulasvirta; see the dataset's OSF license metadata.
"""

import argparse
import collections
import hashlib
import json
import pathlib
import re
import zipfile


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


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


def prepare(archive, output, limit):
    groups = collections.defaultdict(list)
    counts = collections.Counter()
    with zipfile.ZipFile(archive) as source:
        for name in sorted(source.namelist()):
            if not name.endswith(".log"):
                continue
            user = pathlib.PurePosixPath(name).stem
            split = participant_split(user)
            for ordinal, (key, points) in enumerate(trajectories(source.read(name).decode().splitlines())):
                sentence, word, failed, width, height = key
                if len(set((x, y) for x, y, _ in points)) < 2:
                    counts["stationary"] += 1
                    continue
                w, h = int(width), int(height)
                if w <= 0 or h <= 0:
                    counts["invalid_geometry"] += 1
                    continue
                # Logging app: 10 columns, 4 rows (last is dummy space keys),
                # one CSS-pixel key margin, centers at pitch/2 + 0.5 pixels.
                # Our model's top row y is zero and top-left x is 0.5.
                points_normalized = [[(x - 0.5) / (w / 10), (y - 0.5) / (h / 4) - 0.5] for x, y, _ in points]
                identifier = digest(f"{user}:{sentence}:{ordinal}")
                groups[(split, failed)].append({
                    "id": identifier, "participant": digest(user), "word": word,
                    "points": points_normalized,
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--limit", type=int, default=3000, help="Per split/stratum; zero selects all")
    args = parser.parse_args()
    prepare(args.archive, args.output, args.limit)
