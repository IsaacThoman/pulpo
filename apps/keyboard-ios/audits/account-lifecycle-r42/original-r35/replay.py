#!/usr/bin/env python3
"""Serial UUID-pinned XCTest replay. Output stays outside checkout; no log reads."""
import argparse
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("stage", choices=["baseline", "candidate"])
parser.add_argument("--checkout", type=Path, required=True)
parser.add_argument("--fixtures", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--derived-data", type=Path, required=True)
parser.add_argument("--development", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
root = args.checkout.resolve() / "apps/keyboard-ios"
label = args.stage + ("-development" if args.development else "-heldout")
with (args.output / (label + "-generate.log")).open("w") as log:
    generated = subprocess.run(["xcodegen", "generate"], cwd=root, stdout=log, stderr=subprocess.STDOUT)
if generated.returncode:
    raise SystemExit(generated.returncode)
command = ["/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild", "-project", "PulpoKeyboard.xcodeproj",
           "-scheme", "PulpoKeyboard", "-destination", "platform=iOS Simulator,id=1EDC5D9A-7E25-432A-B5B1-9A8B702306A7",
           "-derivedDataPath", str(args.derived_data.resolve()), "-parallel-testing-enabled", "NO",
           "-collect-test-diagnostics", "never", "-only-testing:PulpoKeyboardAppTests/AccountLifecycleR35BenchmarkTests",
           "-resultBundlePath", str((args.output / (label + ".xcresult")).resolve()), "test"]
if args.stage == "baseline":
    command.append("SWIFT_ACTIVE_COMPILATION_CONDITIONS=$(inherited) DEBUG R35_BASELINE")
if args.development:
    command.append("-only-testing:PulpoKeyboardAppTests/AccountLifecycleR35Tests")
environment = os.environ | {"TEST_RUNNER_R35_FIXTURES": str(args.fixtures.resolve()),
                           "TEST_RUNNER_R35_REPORT": str((args.output / (label + ".json")).resolve())}
with (args.output / (label + ".log")).open("w") as log:
    result = subprocess.run(command, cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
print(f"{label}: exit {result.returncode}", flush=True)
raise SystemExit(result.returncode)
