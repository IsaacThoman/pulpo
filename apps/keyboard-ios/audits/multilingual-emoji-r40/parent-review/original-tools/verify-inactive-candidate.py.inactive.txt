"""Verify archived candidate bytes and, optionally, the restored baseline.

Run on the restored checkout with --check-baseline to also check the inactive
patch's before-images and git apply --check. Never applies a production patch.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-baseline", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((HERE / "candidate-source-manifest.json").read_text())
    patch = HERE / manifest["patch"]
    assert sha(patch.read_bytes()) == manifest["patchSHA256"]
    for entry in manifest["files"]:
        artifact = HERE / entry["archive"]
        data = artifact.read_bytes()
        if artifact.suffix == ".gz":
            data = gzip.decompress(data)
        assert len(data) == entry["bytes"] and sha(data) == entry["sha256"], entry["path"]
        if args.check_baseline:
            original = REPO / entry["path"]
            expected = entry["baselineSHA256"]
            assert (sha(original.read_bytes()) if original.exists() else None) == expected, entry["path"]
    if args.check_baseline:
        subprocess.run(["git", "apply", "--check", str(patch)], cwd=REPO, check=True)
    print(json.dumps({"verifiedSourceFiles": len(manifest["files"]), "inactivePatch": True,
                      "baselineChecked": args.check_baseline, "productionPatchApplied": False}))


if __name__ == "__main__":
    main()
