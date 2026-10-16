#!/usr/bin/env python3
"""Compare explicit author oracles. CLI: compare.py SUITE BASELINEOUTPUT CANDIDATEOUTPUT OUTPUTREPORT.
No raw array change, synthetic row, or smoke result is counted as semantic utility.
"""
import argparse
import json
from pathlib import Path
from validate import Invalid, load, validate, string, identity


def read_output(path, suite):
    expected = [identity(c["id"]) for c in suite["cases"]]
    errors, rows, invalid = [], {}, {}
    try:
        payload = load(path)
        if type(payload) is not list:
            raise Invalid("output must be an ordered array")
    except (OSError, ValueError) as error:
        return {}, {}, [f"output unavailable: {error}"]
    order = []
    for i, row in enumerate(payload):
        if type(row) is not dict or type(row.get("id")) is not str:
            errors.append(f"row {i}: object with string id required")
            continue
        case_id = identity(row["id"])
        order.append(case_id)
        if case_id in rows:
            invalid.setdefault(case_id, []).append("duplicate output id")
        else:
            rows[case_id] = row
        if case_id not in expected:
            errors.append(f"unknown output id: {case_id}")
    if order != expected:
        errors.append("output row order/ids differ from suite (missing/extra/reordered/duplicate)")
    for case in suite["cases"]:
        case_id = identity(case["id"])
        if case_id not in rows:
            invalid[case_id] = ["missing output row"]
            continue
        row = rows[case_id]
        problems = invalid.setdefault(case_id, [])
        if set(row) != {"id", "values", "baseValues", "query"}:
            problems.append("output fields must be exactly id/values/baseValues/query")
        for key in ("values", "baseValues"):
            if type(row.get(key)) is not list or any(type(x) is not str or not x for x in row[key]):
                problems.append(f"{key}: array of nonempty strings required")
        if type(row.get("query")) is not str:
            problems.append("query: string required")
        elif case["action"] != "wrapper" and row["query"] != case["query"]:
            problems.append("raw query echo mismatch")
        for key in ("id", "query", "values", "baseValues"):
            items = row.get(key) if key in ("values", "baseValues") else [row.get(key)]
            if type(items) is list:
                for item in items:
                    if type(item) is str:
                        try:
                            string(item, key, nonempty=key != "query")
                        except Invalid as error:
                            problems.append(str(error))
        if not problems:
            if len(row["values"]) != len(row["baseValues"]):
                problems.append("values/baseValues length mismatch")
            if case["action"] != "wrapper" and row["values"] != row["baseValues"]:
                problems.append("direct/fixture baseValues must equal values")
    return rows, invalid, errors


def evaluate(case, rows, invalid, execution_errors):
    case_id = identity(case["id"])
    raw = rows.get(case_id)
    problems = list(invalid.get(case_id, []))
    if raw is None and not problems:
        problems.append("output unavailable")
    # Preserve observed ranks/hits for readable rows even when another row is
    # missing. Whole-output errors still prevent certification of this run.
    available = not problems
    problems.extend(execution_errors)
    values = raw.get("values") if raw else None
    bases = raw.get("baseValues") if raw else None
    safe_values = values if type(values) is list and all(type(v) is str for v in values) else []
    target_ranks = [{"target": target, "rank": safe_values.index(target) + 1 if available and target in safe_values else None}
                    for target in dict.fromkeys(case["acceptable"])]
    accepted = [x["target"] for x in target_ranks if x["rank"] is not None and x["rank"] <= case["maxRank"]]
    best = min((x["rank"] for x in target_ranks if x["rank"] is not None), default=None)
    forbidden_hits = [v for v in dict.fromkeys(case.get("forbidden", [])) if available and v in safe_values]
    empty_ok = (len(safe_values) == 0 and bases == []) if available else None
    equivalent = None
    ref = case.get("equivalentTo")
    if ref:
        peer = rows.get(identity(ref))
        peer_available = peer is not None and not invalid.get(identity(ref))
        equivalent = {"id": ref, "available": peer_available,
                      "equalValues": values == peer["values"] if available and peer_available else None,
                      "equalBaseValues": bases == peer["baseValues"] if available and peer_available else None}
        if not peer_available:
            problems.append("equivalence reference unavailable")
        elif not (equivalent["equalValues"] and equivalent["equalBaseValues"]):
            problems.append("ordered equivalence mismatch")
    if available:
        if case["acceptable"] and not accepted:
            problems.append("no explicit acceptable target within maxRank")
        if case.get("expectEmpty") and not empty_ok:
            problems.append("expected empty output")
        if forbidden_hits:
            problems.append("forbidden target present")
    return {"available": available, "pass": available and not problems, "errors": problems,
            "values": values, "baseValues": bases, "query": raw.get("query") if raw else None,
            "targetRanks": target_ranks, "bestTargetRank": best, "maxRank": case["maxRank"],
            "acceptedAlternatives": accepted, "forbiddenHits": forbidden_hits,
            "expectEmpty": case.get("expectEmpty", False), "emptySatisfied": empty_ok,
            "equivalence": equivalent}


def compare(suite, baseline_path, candidate_path):
    baseline, bi, be = read_output(baseline_path, suite)
    candidate, ci, ce = read_output(candidate_path, suite)
    rows = []
    for case in suite["cases"]:
        b = evaluate(case, baseline, bi, be)
        c = evaluate(case, candidate, ci, ce)
        # A wrapper's exact buffer is produced by Swift. Never approximate Unicode
        # grapheme truncation with Python codepoint slicing.
        if case["action"] == "wrapper" and b["available"] and c["available"] and b["query"] != c["query"]:
            c["pass"] = False
            c["errors"].append("wrapper query echo differs from baseline actual buffer")
        changed = b["values"] != c["values"] or b["baseValues"] != c["baseValues"]
        rows.append({"id": case["id"], "family": case["family"], "role": case["role"],
                     "stratum": case.get("stratum"), "action": case["action"], "inputQuery": case["query"],
                     "acceptable": list(dict.fromkeys(case["acceptable"])), "forbidden": case.get("forbidden", []),
                     "baseline": b, "candidate": c, "rawArraysChanged": changed,
                     "arraysComparable": b["available"] and c["available"],
                     "transition": f"{'pass' if b['pass'] else 'fail'}-to-{'pass' if c['pass'] else 'fail'}"})
    family_utility = []
    for family in suite["families"]:
        useful = [r for r in rows if identity(r["family"]) == identity(family) and r["role"] == "useful"]
        item = {"family": family, "usefulRows": len(useful)}
        for name in ("baseline", "candidate"):
            accepted = sorted({v for r in useful if r[name]["pass"] for v in r[name]["acceptedAlternatives"]})
            item[name] = {"passingRows": sum(r[name]["pass"] for r in useful),
                          "unavailableRows": sum(not r[name]["available"] for r in useful),
                          "uniqueAcceptedAlternatives": accepted,
                          "hasAcceptedUsefulRow": any(r[name]["pass"] for r in useful),
                          "allUsefulRowsPass": bool(useful) and all(r[name]["pass"] for r in useful)}
        family_utility.append(item)
    aggregates = {}
    for name, errors in (("baseline", be), ("candidate", ce)):
        useful = [r for r in rows if r["role"] == "useful"]
        controls = [r for r in rows if r["role"] == "control"]
        aggregates[name] = {"executionValid": not errors and all(r[name]["available"] for r in rows),
                            "executionErrors": errors, "allRowsPass": not errors and all(r[name]["pass"] for r in rows),
                            "useful": {"denominator": len(useful), "passing": sum(r[name]["pass"] for r in useful),
                                       "unavailable": sum(not r[name]["available"] for r in useful),
                                       "uniqueAcceptedAlternatives": sorted({v for r in useful if r[name]["pass"] for v in r[name]["acceptedAlternatives"]}),
                                       "familiesWithAcceptedUsefulRow": [f["family"] for f in family_utility if f[name]["hasAcceptedUsefulRow"]]},
                            "controls": {"denominator": len(controls), "passing": sum(r[name]["pass"] for r in controls),
                                         "unavailable": sum(not r[name]["available"] for r in controls)}}
    return {"version": 2, "interpretation": "Explicit author target sets only; synthetic/control rows never add semantic utility. No domain-admission decision.",
            "summary": aggregates, "familyUtility": family_utility,
            "changedRawArrays": [{"id": r["id"], "transition": r["transition"], "arraysComparable": r["arraysComparable"],
                                   "baselineValues": r["baseline"]["values"], "candidateValues": r["candidate"]["values"],
                                   "baselineBaseValues": r["baseline"]["baseValues"], "candidateBaseValues": r["candidate"]["baseValues"]}
                                  for r in rows if r["rawArraysChanged"]],
            "regressions": [r["id"] for r in rows if r["baseline"]["pass"] and not r["candidate"]["pass"]],
            "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        suite = validate(load(args.suite))
        report = compare(suite, args.baseline, args.candidate)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f"comparison failed: {error}\n")
    print(json.dumps({"rows": len(report["rows"]), "changedRawArrays": len(report["changedRawArrays"]), "regressions": report["regressions"],
                      "baselineExecutionValid": report["summary"]["baseline"]["executionValid"],
                      "candidateExecutionValid": report["summary"]["candidate"]["executionValid"]}))
    # Oracle failure is data. Missing/malformed execution is an unsuccessful CLI.
    if not all(report["summary"][r]["executionValid"] for r in ("baseline", "candidate")):
        parser.exit(1)

if __name__ == "__main__":
    main()
