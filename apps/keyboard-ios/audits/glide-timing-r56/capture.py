#!/usr/bin/env python3
"""Capture structured XCTest receipts without reading successful build logs."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("result", type=Path)
    parser.add_argument("label")
    parser.add_argument("--products", type=Path, default=Path("/tmp/pulpo-r56-timing/DD/Build/Products"))
    args = parser.parse_args()
    audit = Path(__file__).resolve().parent
    ios = audit.parent.parent
    raw = audit / "raw"
    raw.mkdir(exist_ok=True)
    artifacts = {}

    def save(name, data):
        path = raw / f"{args.label}-{name}.gz"
        path.write_bytes(gzip.compress(data, mtime=0))
        artifacts[str(path.relative_to(audit))] = {"decodedBytes": len(data), "decodedSHA256": digest(data), "gzipSHA256": digest(path.read_bytes())}

    summary = subprocess.check_output(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(args.result), "--compact"])
    save("summary.json", summary)
    with tempfile.TemporaryDirectory(prefix="r56-export-") as directory:
        subprocess.run(["xcrun", "xcresulttool", "export", "attachments", "--path", str(args.result), "--output-path", directory], check=True, stdout=subprocess.DEVNULL)
        exported = Path(directory)
        manifest = json.loads((exported / "manifest.json").read_bytes())
        save("attachment-manifest.json", (exported / "manifest.json").read_bytes())
        for test in manifest:
            for index, attachment in enumerate(test["attachments"]):
                name = attachment["suggestedHumanReadableName"].split("_0_")[0]
                save(f"{name}-{index}.json", (exported / attachment["exportedFileName"]).read_bytes())
    sources = sorted((ios / "PulpoKeyboardKit" / "Sources").rglob("*.swift"))
    sources += sorted((ios / "AppTests").glob("*R56*.swift"))
    sources += sorted((ios / "PulpoKeyboardKit" / "Tests" / "KeyboardCoreTests").glob("*R56*.swift"))
    sources += sorted((ios / "LanguageData").glob("*.pkdict"))
    sources += [ios / "project.yml", Path(__file__)]
    binaries = [p for p in args.products.rglob("*") if p.is_file() and (p.suffix == ".dylib" or p.name in {"PulpoKeyboard", "PulpoKeyboardExtension", "PulpoKeyboardAppTests", "PulpoKeyboardUITests"})]
    binding = {"result": str(args.result), "summary": json.loads(summary), "raw": artifacts,
               "sourcesAndResources": {str(p.relative_to(ios)): digest(p.read_bytes()) for p in sources},
               "binaries": {str(p): digest(p.read_bytes()) for p in binaries}}
    (audit / f"{args.label}-binding.json").write_text(json.dumps(binding, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"label": args.label, "tests": binding["summary"]["totalTestCount"], "passed": binding["summary"]["passedTests"], "failed": binding["summary"]["failedTests"], "artifacts": len(artifacts)}))


if __name__ == "__main__":
    main()
