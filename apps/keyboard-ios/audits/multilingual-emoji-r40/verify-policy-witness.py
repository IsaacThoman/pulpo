#!/usr/bin/env python3
"""Independent baseline final-index observations; no candidate source/output.

WITNESS CATALOG SUITE BASELINE_OUTPUT ORACLES OUTPUTDIR
This is a finite executable safety/control gate, never a formal domain proof.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def required_count(key):
    if key.startswith("reserve-"): return 7 if key.endswith("-0") else 0
    if key.startswith("r40-v4-orphan-context-"): return 1 if key.endswith("-1") else 0
    if key.startswith("r40-v4-ignored-substrings-"): return 7 if key.endswith("-0") else 0
    if key.startswith("r40-v4-scalar-boundary-"): return 7 if key.endswith("-0") else 0
    if key.startswith("r40-v4-retained-postings-"): return 20
    if key.startswith("r40-v4-exact-winner-"): return 0 if key.endswith("-3") else 20
    if key.startswith(("r40-final-red-heart-mixed-", "r40-final-red-heart-es-", "r40-final-internal-")): return 0
    if key.startswith("r40-final-red-heart-en-"): return 86
    if key.startswith("r40-final-orphan-iota-"): return 7 if key.endswith("-1") else 0
    if key.startswith("r40-final-orphan-Mc-"): return 0 if key.endswith("-0") else 7
    if key.startswith("r40-final-FF9E-context-"): return 7 if key.endswith(("-0", "-2")) else 0
    if key.startswith("r40-final-bounded-"): return 12
    if key.startswith(("r40-final-exact-Mc-", "r40-final-exact-musical-")): return 7
    return None


def main():
    binary, catalog, suite_path, baseline_path, oracle_path, directory = sys.argv[1:]
    out = Path(directory).resolve(); out.mkdir(parents=True, exist_ok=True)
    raw = out / "baseline-final-index-witnesses.json"
    subprocess.run([binary, catalog, suite_path, str(raw)], check=True)
    rows, suite = load(raw), load(suite_path)
    baseline, oracles = {r["id"]: r for r in load(baseline_path)}, load(oracle_path)
    assert [r["id"] for r in rows] == [r["id"] for r in suite["cases"]]
    witnesses = {r["id"]: r for r in rows}; checks = []
    suffixes = oracles.get("candidateLocalizedSuffixExpected", {})
    for case, row in zip(suite["cases"], rows):
        key = row["id"]; local = suffixes.get(key, [])
        assert not row["escapedLegacy"], key
        assert not set(local) & set(row["E"]), (key, "localized oracle overlaps envelope")
        if case["action"] != "wrapper": assert row["legacyDirect"] == baseline[key]["values"], key
        wanted = required_count(key)
        if wanted is not None: assert len(row["E"]) == wanted, (key, len(row["E"]), wanted)
        cap = max(0, min(case.get("limit", 48), 60))
        if case["action"] != "wrapper": assert len(baseline[key]["values"]) + len(local) <= cap, key
        checks.append({"id": key, "pass": True, "envelopeCount": len(row["E"]),
                       "explicitEnvelopeCount": wanted, "localizedCount": len(local)})
    for group in oracles.get("localizedInvariantGroups", []):
        identities = {json.dumps([witnesses[k]["T"], witnesses[k]["W"], witnesses[k]["X"]], ensure_ascii=False) for k in group["ids"]}
        assert len(identities) == 1, ("different C in invariant group", group)
    exact = []
    for row in rows:
        if row["id"].startswith("r40-final-exact-Mc-") and "EnglishOnly" not in row["id"] and row["id"].endswith(("-1", "-2")):
            assert row["legacyDirect"] and all(e["F"] == row["X"] and e["N"] != row["W"] for e in row["entries"][:7])
            exact.append(row["id"])
    report = {"pass": True, "classification": "finite independent baseline witness only; formal domain approval remains separate",
              "checkedRows": len(rows), "allLegacyRowsContained": True,
              "sameCInvariantGroupsChecked": len(oracles.get("localizedInvariantGroups", [])),
              "explicitEnvelopeCountsChecked": sum(r["explicitEnvelopeCount"] is not None for r in checks),
              "v6FalseExactImplicationWitnesses": exact, "rows": checks,
              "raw": str(raw), "rawSHA256": sha(raw),
              "inputHashes": {str(p): sha(p) for p in [binary, catalog, suite_path, baseline_path, oracle_path]}}
    write(out / "witness-checks.json", report)
    print(json.dumps({k: v for k, v in report.items() if k not in ("rows", "inputHashes")}))


if __name__ == "__main__": main()
