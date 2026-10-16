#!/usr/bin/env python3
"""Direct macOS Swift compilation only. No package/native/device build."""
import argparse
from pathlib import Path
import shlex
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    audit = Path(__file__).resolve().parent
    keyboard = audit.parents[2]
    output = args.output_directory.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sources = sorted((keyboard / "PulpoKeyboardKit/Sources/KeyboardCore").rglob("*.swift"))
    for name in ["BehaviorRunner", "BehaviorMain"]:
        path = output / f"{name}.swift"
        path.write_bytes((audit / f"{name}.swift.txt").read_bytes())
        sources.append(path)
    command = ["swiftc", "-swift-version", "6", "-parse-as-library",
               *map(str, sources), "-o", str(output / "r38-behavior")]
    print(shlex.join(command), flush=True)
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
