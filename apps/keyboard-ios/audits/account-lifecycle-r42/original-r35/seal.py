#!/usr/bin/env python3
"""Seal or verify executable sources before the single blind reveal."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["create", "verify"])
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--baseline", type=Path, required=True)
parser.add_argument("--manifest", type=Path, required=True)
args = parser.parse_args()
audit = "audits/account-lifecycle-r35/"
candidate_extra = [audit + f for f in ["public-protocol.md", "compare.py", "replay.py", "validate.py", "seal.py", "native-server.py"]]


def sources(root):
    prefix = "apps/keyboard-ios/"
    paths = [prefix + p for p in ["App", "Extension", "AppTests", "UITests", "LanguageData", "PulpoKeyboardKit/Sources",
                                 "PulpoKeyboardKit/Tests", "PulpoKeyboardKit/Package.swift", "project.yml"]]
    return [p[len(prefix):] for p in subprocess.check_output(["git", "ls-files", "--", *paths], cwd=root, text=True).splitlines()]


def digest(root, names):
    return {name: hashlib.sha256((root / "apps/keyboard-ios" / name).read_bytes()).hexdigest() for name in names}


current = {"candidate": digest(args.candidate, sources(args.candidate) + candidate_extra), "baseline": digest(args.baseline, sources(args.baseline))}
if args.mode == "create":
    current["commits"] = {label: subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
                          for label, root in [("candidate", args.candidate), ("baseline", args.baseline)]}
    current["blindCases"] = {"count": 24, "sha256": "88bbdd0804e39b7d86596916062f1a2d8c4c92a77e1b6bdd5ba1b62383741de9",
                            "authorNotesSHA256": "506f2b89d387375e0065eff5937e061bd58d4be812878711788a1b52067b9e81"}
    current["policy"] = "One blind reveal after smoke/review; no source/runner/compare retuning after reveal. Retain all outcomes."
    args.manifest.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
else:
    sealed = json.loads(args.manifest.read_text())
    assert all(current[label] == sealed[label] for label in ("candidate", "baseline")), "Executable source changed after freeze"
print("R35 executable seal " + args.mode + ": pass")
