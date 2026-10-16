#!/usr/bin/env python3
"""Frozen comparison: retain all paired outcomes, including unavailable/failing cases."""
import argparse
import hashlib
import json
import statistics
from pathlib import Path


def status(case):
    if case["unavailable"]:
        return "unavailable"
    return "fail" if case["failures"] else "pass"


def summarize(cases):
    values = [case["elapsedSeconds"] for case in cases]
    counts = {}
    for case in cases:
        for key, value in case["counts"].items():
            counts[key] = counts.get(key, 0) + value
    return {
        "cases": len(cases),
        "casesWithFailures": sum(bool(c["failures"]) for c in cases),
        "statusCounts": {s: sum(status(c) == s for c in cases) for s in ("pass", "fail", "unavailable")},
        "checkpointFailures": sum(not c["pass"] for row in cases for c in row["checks"]),
        "runnerFailures": [dict(id=c["id"], failures=c["failures"]) for c in cases if c["failures"]],
        "primitiveCounts": counts,
        "elapsedSeconds": {"median": statistics.median(values) if values else None, "min": min(values) if values else None, "max": max(values) if values else None, "total": sum(values)},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--seal", type=Path, required=True)
    args = parser.parse_args()
    baseline, candidate = (json.loads(p.read_text()) for p in (args.baseline, args.candidate))
    raw = args.fixtures.read_bytes()
    fixtures = json.loads(raw)
    seal = json.loads(args.seal.read_text())["blindCases"]
    assert hashlib.sha256(raw).hexdigest() == seal["sha256"] and len(fixtures) == seal["count"], "Sealed fixture identity differs"
    assert [c["id"] for c in baseline] == [c["id"] for c in fixtures], "Baseline does not contain complete sealed input"
    assert [c["id"] for c in baseline] == [c["id"] for c in candidate], "Pairing/order differs"
    pairs = []
    common_old, common_new = [], []
    common_ops = {"startLogin", "startRefresh", "awaitRequest", "respond", "waitTask", "cancelTask", "signOut", "checkpoint", "reload"}
    for old, new, fixture in zip(baseline, candidate, fixtures):
        assert old["purpose"] == new["purpose"]
        assert old["purpose"] == fixture["purpose"]
        assert [e["step"] for e in old["events"] if "step" in e] == fixture["steps"] == [e["step"] for e in new["events"] if "step" in e], "Inputs differ"
        common = all(step["op"] in common_ops for step in fixture["steps"])
        if common:
            common_old.append(old)
            common_new.append(new)
        pairs.append({"id": old["id"], "baseline": status(old), "candidate": status(new),
                      "commonOperations": common,
                      "baselineFailures": old["failures"], "candidateFailures": new["failures"],
                      "baselineUnavailable": old["unavailable"], "candidateUnavailable": new["unavailable"],
                      "elapsedDeltaSeconds": new["elapsedSeconds"] - old["elapsedSeconds"]})
    result = {"baseline": summarize(baseline), "candidate": summarize(candidate), "pairs": pairs,
              "commonOperations": {"definition": "Input schedules using only operations supported by both versions; never selected by observed outcome.",
                                   "ids": [c["id"] for c in common_old], "baseline": summarize(common_old), "candidate": summarize(common_new)},
              "limits": ["One serial simulator replay per version; latency includes barriers, Keychain, snapshot I/O, and host scheduling.",
                         "No allocation instrumentation; no statistical speedup claim.",
                         "No case dropped or unavailable result converted to pass.",
                         "UI/audio/deep-link ownership and Keychain failures are outside the fixture runner."]}
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"baseline": result["baseline"]["statusCounts"], "candidate": result["candidate"]["statusCounts"]}, sort_keys=True))


if __name__ == "__main__":
    main()
