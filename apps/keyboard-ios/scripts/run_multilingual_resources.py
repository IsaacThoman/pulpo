#!/usr/bin/env python3
"""Serial opt-in simulator resource sweep. Build the default XCTest scheme first.

Example:
  python3 scripts/run_multilingual_resources.py baseline --derived-data /tmp/pulpo-resource-sweep/DerivedData
  # Freeze final candidate before using --held-out.
Reports/logs/xcresults stay outside the checkout. No compiler settings are changed.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

DEVICE = "7E1D7979-7307-4C53-8466-BB41154B383C"
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["baseline", "candidate", "heldout"])
    parser.add_argument("--derived-data", type=Path, required=True)
    parser.add_argument("--xctestrun", type=Path, help="Use archived build products (e.g. frozen baseline for held-out comparison)")
    parser.add_argument("--output", type=Path, default=Path("/tmp/pulpo-resource-sweep"))
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--held-out", action="store_true")
    parser.add_argument("--ui", action="store_true", help="Run actual XCUI tap sequence once after resource runs")
    args = parser.parse_args()
    if args.repetitions < 1:
        parser.error("repetitions must be positive")
    if args.stage == "heldout" and not args.held_out:
        parser.error("heldout stage requires --held-out")
    args.output.mkdir(parents=True, exist_ok=True)
    build = (["-xctestrun", str(args.xctestrun.resolve())] if args.xctestrun else
             ["-project", "PulpoKeyboard.xcodeproj", "-scheme", "PulpoKeyboard",
              "-derivedDataPath", str(args.derived_data.resolve())])
    command = ["xcodebuild"] + build + ["-destination", f"platform=iOS Simulator,id={DEVICE}",
               "-parallel-testing-enabled", "NO", "test-without-building"]
    for mode in ["en_US", "es", "en_es"]:
        label = f"{args.stage}-{mode}"
        output = args.output / label
        environment = os.environ | {
            "TEST_RUNNER_PK_RESOURCE_DATA": str(ROOT / "LanguageData"),
            "TEST_RUNNER_PK_RESOURCE_MODE": mode,
            "TEST_RUNNER_PK_RESOURCE_HELDOUT": "1" if args.held_out else "0",
            "TEST_RUNNER_PK_RESOURCE_REPORT": str(output),
        }
        with (args.output / f"{label}.log").open("w") as log:
            result = subprocess.run(command + ["-only-testing:PulpoKeyboardUITests/MultilingualResourceSweepTests",
                                    "-test-iterations", str(args.repetitions), "-test-repetition-relaunch-enabled", "YES",
                                    "-resultBundlePath", str(args.output / f"{label}.xcresult")],
                                    cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT)
        print(f"{label}: exit {result.returncode}", flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)
        reports = sorted(args.output.glob(f"{label}.*.json"))
        if len(reports) != args.repetitions:
            raise SystemExit(f"Expected {args.repetitions} distinct fresh-process reports; found {len(reports)}")
        for report_path in reports:
            report = json.loads(report_path.read_text())
            print(json.dumps({"report": str(report_path), "summary": report["summary"]}, sort_keys=True), flush=True)
    if args.ui:
        with (args.output / f"{args.stage}-ui.log").open("w") as log:
            result = subprocess.run(command + ["-only-testing:PulpoKeyboardUITests/MultilingualResourceInteractionTests",
                                    "-resultBundlePath", str(args.output / f"{args.stage}-ui.xcresult")],
                                    cwd=ROOT, env=os.environ | {"TEST_RUNNER_PK_RESOURCE_UI": "1"},
                                    stdout=log, stderr=subprocess.STDOUT)
        print(f"{args.stage}-ui: exit {result.returncode}", flush=True)
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
