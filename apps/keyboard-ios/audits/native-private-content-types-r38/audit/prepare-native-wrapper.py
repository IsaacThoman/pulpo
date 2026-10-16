#!/usr/bin/env python3
"""Embed only explicitly supplied R38 inputs into a temporary XCTest source.

Does not search for, discover, or open any other case corpus. No builds.
"""
import argparse
import base64
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", type=Path)
    parser.add_argument("calibration", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    template = Path(__file__).with_name("BehaviorNativeTests.swift.txt").read_text()
    for marker, path in [("__R38_CASES_BASE64__", args.cases),
                         ("__R38_CALIBRATION_BASE64__", args.calibration)]:
        data = path.read_bytes()
        json.loads(data)  # Fail before writing a wrapper with malformed JSON.
        template = template.replace(marker, base64.b64encode(data).decode("ascii"))
    args.output.write_text(template)
    print(args.output)


if __name__ == "__main__":
    main()
