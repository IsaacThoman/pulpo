#!/usr/bin/env python3
"""Verify this immutable packet and its five exposed API observations only."""
import gzip
import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


manifest = json.loads((HERE / "manifest.json").read_bytes())
paths = list(HERE.rglob("*"))
require(not any(p.is_symlink() for p in paths), "packet symlink")
actual = {str(p.relative_to(HERE)) for p in paths
          if p.is_file() and p != HERE / "manifest.json"}
require(actual == set(manifest), "packet file inventory")
for name, binding in manifest.items():
    relative = Path(name)
    require(not relative.is_absolute() and ".." not in relative.parts, "unsafe path")
    target = HERE / relative
    require(not target.is_symlink(), "symlink")
    data = target.read_bytes()
    require(type(binding["bytes"]) is int and len(data) == binding["bytes"], name + " bytes")
    require(sha(data) == binding["sha256"], name + " digest")

witness = HERE / "public-api-witness"
intent = json.loads((witness / "intent-before-execution.json").read_bytes())
require(sha((witness / "main.swift.txt").read_bytes()) == intent["clientSHA256"], "client")
expected = intent["expectedWeights"]
require(expected == dict(dense40=40, dense41=41, sparse41=40, dense64=64, tapless41=0),
        "frozen expected weights")
comparison = json.loads((witness / "comparison.json").read_bytes())
verdicts = {}
for label in ("baseline", "candidate"):
    info = intent["versions"][label]
    archive = gzip.decompress((witness / (label + "-sources.tar.gz")).read_bytes())
    require(sha(archive) == info["archiveSHA256"], label + " source archive")
    raw = (witness / (label + ".json")).read_bytes()
    rows = json.loads(raw)
    require(type(rows) is list and [r["id"] for r in rows] == list(expected), label + " rows")
    derived = []
    for row in rows:
        require(set(row) == {"id", "targetLength", "tapCount", "weight"}, "row fields")
        require(type(row["targetLength"]) is int and type(row["tapCount"]) is int,
                "integer lengths")
        require(type(row["weight"]) in (int, float) and math.isfinite(row["weight"]),
                "finite numeric weight")
        derived.append(dict(row, expectedWeight=expected[row["id"]],
                            **{"pass": row["weight"] == expected[row["id"]]}))
    stored = comparison[label]
    require(type(stored["exit"]) is int and stored["exit"] == 0, label + " exit")
    require(stored["rawSHA256"] == sha(raw), label + " raw digest")
    require(all(type(row["pass"]) is bool for row in stored["rows"]), "verdict type")
    require(stored["rows"] == derived, label + " recomputed observations")
    verdicts[label] = [row["pass"] for row in derived]
require(verdicts["baseline"] == [True] * 5, "baseline preservation")
require(verdicts["candidate"] == [True, False, False, False, True], "three retained regressions")
print(json.dumps({"scope": "packet bytes and five exposed API rows only",
                  "files": len(manifest), "baselinePassed": 5,
                  "candidatePassed": 2, "regressions": 3}, sort_keys=True))
