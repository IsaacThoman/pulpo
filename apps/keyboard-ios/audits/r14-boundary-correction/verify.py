#!/usr/bin/env python3
"""Verify retained R14 evidence; optionally replay archived Core sources in /tmp."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

PACKAGE = "apps/keyboard-ios/audits/r14-boundary-correction"
ENGINE = "apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift"
KIT = "apps/keyboard-ios/PulpoKeyboardKit"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def compare_reports(folder, results, temporary, split):
    generated = temporary / (split + "-comparison.json")
    completed = subprocess.run(
        [sys.executable, str(folder / "report.py"), str(results["baseline"]),
         str(results["candidate"]), str(generated)], capture_output=True, text=True)
    retained = load(folder / (split + "-report.json"))
    require(completed.returncode == (0 if retained["accuracyGate"] else 1),
            split + " report command failed: " + completed.stderr)
    recreated = load(generated)
    for field in ["summary", "accuracyGate", "rows"]:
        require(recreated[field] == retained[field], split + " comparison differs: " + field)
    # Original absolute /tmp filenames are historical metadata, not dependencies.
    require(sorted(recreated["raw_sha256"].values()) == sorted(retained["raw_sha256"].values()),
            split + " paired raw hashes differ")
    return recreated


def verify(folder):
    manifest = load(folder / "retained-manifest.json")
    actual_files = {str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file()}
    require(actual_files == set(manifest["files"]) | {"retained-manifest.json"},
            "Unrecorded or missing package files")
    for name, expected in manifest["files"].items():
        data = (folder / name).read_bytes()
        require(len(data) == expected["bytes"] and digest(data) == expected["sha256"],
                "Retained file mismatch: " + name)
    historical = load(folder / "agent-manifest.json")
    for original, expected in historical["versionedArtifactSHA256"].items():
        require(digest((folder / manifest["historicalPathMap"][original]).read_bytes()) == expected,
                "Historical artifact mismatch: " + original)
    freeze = load(folder / "freeze.json")
    require(digest((folder / "heldout.json").read_bytes()) == freeze["sealedHeldoutSHA256"],
            "Sealed heldout hash mismatch")
    for original, expected in freeze["sha256"].items():
        actual = (manifest["sourceSHA256"]["candidate"] if original == ENGINE
                  else digest((folder / manifest["historicalPathMap"][original]).read_bytes()))
        require(actual == expected, "Frozen candidate artifact mismatch: " + original)
    with tempfile.TemporaryDirectory(prefix="pulpo-r14-verify-") as name:
        temporary = Path(name)
        for split in ["dev", "heldout"]:
            cases = load(folder / (split + ".json"))
            case_ids = {case["id"] for case in cases}
            restricted = {case["id"] for case in cases
                          if case.get("field") in {"password", "email", "url", "number"}}
            require(len(case_ids) == len(cases), "Duplicate input IDs: " + split)
            require(len(cases) == manifest["datasets"][split]["uniqueCases"], "Input count mismatch: " + split)
            require(sum(not case.get("ambiguous", False) for case in cases)
                    == manifest["datasets"][split]["uniqueScoredCases"], "Scored input mismatch: " + split)
            results = {}
            for version in ["baseline", "candidate"]:
                key = split + "-" + version
                metadata = manifest["results"][key]
                packed = (folder / metadata["gzipFile"]).read_bytes()
                require(packed[4:8] == bytes(4) and packed[3] & 8 == 0,
                        "Gzip must have zero timestamp and no embedded filename: " + key)
                raw = gzip.decompress(packed)
                rows = json.loads(raw)
                require(digest(raw) == metadata["uncompressedSHA256"], "Raw hash mismatch: " + key)
                require(digest(raw) == historical[key]["sha256"], "Historical raw hash mismatch: " + key)
                require(len(rows) == metadata["rows"], "Row count mismatch: " + key)
                require(len(rows) == len(cases) * 4 and {row["id"] for row in rows} == case_ids,
                        "Case coverage mismatch: " + key)
                require(len({(row["id"], row["timing"]) for row in rows}) == len(rows),
                        "Repeated case/timing key: " + key)
                require({row["timing"] for row in rows} == set(manifest["timingModes"]),
                        "Timing mode mismatch: " + key)
                require(sum(not row["ambiguous"] for row in rows) == metadata["scoredExecutions"],
                        "Scored denominator mismatch: " + key)
                require(all(row["personalCount"] == 0 for row in rows
                            if row["id"] in restricted), "Restricted-field learning mismatch: " + key)
                results[version] = temporary / (key + ".json")
                results[version].write_bytes(raw)
            report = compare_reports(folder, results, temporary, split)
            print(split + ": " + json.dumps(report["summary"]["all"], sort_keys=True)
                  + "; accuracyGate=" + str(report["accuracyGate"]))
    print("PASS: all retained hashes, historical mappings, raw arrays and compact comparisons")
    return manifest


def archive(repo, revision, destination, paths):
    data = subprocess.check_output(["git", "-C", str(repo), "archive", revision, "--", *paths])
    destination.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as bundle:
        for member in bundle.getmembers():
            require(member.isfile() or member.isdir(), "Archive contains a link or special file")
            target = (destination / member.name).resolve()
            require(os.path.commonpath([str(destination.resolve()), str(target)]) == str(destination.resolve()),
                    "Archive path escapes temporary directory")
        bundle.extractall(destination)


def replay(folder, selection, artifact_ref):
    repo = Path(subprocess.check_output(
        ["git", "-C", str(folder), "rev-parse", "--show-toplevel"], text=True).strip())
    require(shutil.which("swift") is not None, "Core replay needs a compatible Swift toolchain")
    with tempfile.TemporaryDirectory(prefix="pulpo-r14-replay-") as name:
        temporary = Path(name)
        # Read fixture, patch and inputs from a committed archive, never live source.
        archive(repo, artifact_ref, temporary / "artifacts", [PACKAGE])
        frozen = temporary / "artifacts" / PACKAGE
        manifest = verify(frozen)
        splits = ["dev", "heldout"] if selection == "all" else [selection]
        results = {split: {} for split in splits}
        for version in ["baseline", "candidate"]:
            tree = temporary / version
            archive(repo, manifest["baselineCommit"], tree, [KIT, "apps/keyboard-ios/LanguageData"])
            require(digest((tree / ENGINE).read_bytes()) == manifest["sourceSHA256"]["baseline"],
                    "Archived baseline source does not match R14")
            if version == "candidate":
                subprocess.run(["git", "-C", str(tree), "apply", "--unidiff-zero",
                                str(frozen / "rejected.patch")], check=True)
                require(digest((tree / ENGINE).read_bytes()) == manifest["sourceSHA256"]["candidate"],
                        "Rejected patch does not recreate frozen candidate source")
            target = tree / KIT / "Tests/KeyboardCoreTests/BoundaryCorrectionSweepTests.swift"
            shutil.copyfile(frozen / "fixtures/BoundaryCorrectionSweepTests.swift.txt", target)
            for split in splits:
                output = temporary / (split + "-" + version + ".json")
                env = dict(os.environ, PULPO_BOUNDARY_CASES=str(frozen / (split + ".json")),
                           PULPO_BOUNDARY_RESULTS=str(output))
                subprocess.run(["swift", "test", "--package-path", str(tree / KIT), "-c", "release",
                                "--scratch-path", str(temporary / ("build-" + version)),
                                "--filter", "BoundaryCorrectionSweepTests"], env=env, check=True)
                results[split][version] = output
        for split in splits:
            compare_reports(frozen, results[split], temporary, split)
            print("PASS: archived Core replay exactly matches retained " + split + " rows")
    print("Temporary sources/builds/results removed; no native build or device operation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay", choices=["dev", "heldout", "all"],
                        help="Optional macOS Core replay; compiles Swift only inside a temporary directory")
    parser.add_argument("--artifact-ref", default="HEAD", help="Committed artifact tree for replay (default HEAD)")
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    verify(folder)
    if args.replay:
        replay(folder, args.replay, args.artifact_ref)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("FAIL:", error, file=sys.stderr)
        raise SystemExit(1)
