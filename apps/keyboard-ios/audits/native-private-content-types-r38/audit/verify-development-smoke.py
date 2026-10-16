#!/usr/bin/env python3
"""Execute only the named development fixtures and verify their evidence."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("--output-directory", type=Path, help="Write new reports here; default is a fresh temporary directory")
    args = parser.parse_args()
    output_directory = args.output_directory or Path(tempfile.mkdtemp(prefix="pulpo-r38-smoke-"))
    output_directory.mkdir(parents=True, exist_ok=True)
    audit = Path(__file__).resolve().parent
    keyboard = audit.parents[2]
    reports = {}
    for name, expected_exit in [("development-smoke", 0), ("development-errors-smoke", 1)]:
        output = output_directory / f"{name}-core-results.json"
        command = [str(args.executable.resolve()), str(audit / f"{name}.json"),
                   str(audit.parent / "calibration-baseline.json"),
                   str(keyboard / "LanguageData"), str(output), "development"]
        result = subprocess.run(command, check=False)
        assert result.returncode == expected_exit, (name, result.returncode)
        reports[name] = json.loads(output.read_text())

    report = reports["development-smoke"]
    assert report["failureCount"] == 0
    assert len(report["results"]) == 18
    steps = [step for result in report["results"] for step in result["steps"]]
    operations = {step["op"] for step in steps}
    assert operations == {"type", "insert", "space", "delete", "field", "host", "capture", "choose",
                          "guardOrigin", "invalidateGuard", "destination", "automatic", "confirm"}
    kinds = {step["action"]["captured"]["kind"] for step in steps if "captured" in step["action"]}
    assert kinds == {"literal", "completion", "correction", "prediction"}
    for result in report["results"]:
        if result["id"] == "development-learning-normal":
            word = "hola" if result["language"] == "es" else "hello"
            assert result["steps"][-1]["actual"]["pairCounts"][word][word] == 1
        if result["id"] == "development-learning-private":
            assert not any(result["steps"][-1]["actual"]["pairCounts"].values())
        if result["id"] == "development-allops":
            no_origin = result["steps"][1]
            assert no_origin["action"]["outcome"] == "unavailable"
            assert no_origin["action"]["guardBefore"]["availability"] == "noOrigin"
            assert not no_origin["action"]["explicitExpectedRefusal"]

    errors = reports["development-errors-smoke"]
    assert errors["failureCount"] == 18
    for result in errors["results"]:
        assert len(result["steps"]) == 11
        assert result["steps"][5]["actual"]["capturedChoice"] is None
        assert result["steps"][6]["failures"] == ["choose has no captured choice"]
        assert result["steps"][-1]["passed"]
        assert result["steps"][-1]["actual"]["text"].endswith("!?")
    print(f"Reports: {output_directory}")
    print(f"Verified {len(steps)} successful transitions across 18 case/languages, all 13 operations, all 4 capture kinds; "
          "18 deliberate failures retained and later steps executed.")


if __name__ == "__main__":
    main()
