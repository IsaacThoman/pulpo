#!/usr/bin/env python3
"""Exposed, independent protocol smoke; no semantic utility claims.

smoke-runner.py BASELINE_RUNNER CATALOG OUTPUTDIR [--candidate-runner RUNNER]
  [--suite ARBITRARY_EXPOSED_SUITE] [--summary LOW_VOLUME_JSON]

Generated exposed inputs and every execution artifact live in OUTPUTDIR, which
must be outside the repository. --suite also executes any strictly valid exposed
suite in full; its oracle failures are reported, never silently dropped.
Candidate mode checks chosen fixture oracles and invariant localized suffixes;
it allows the inherited English portion to depend on query order/repetition.
"""
import argparse
import copy
import hashlib
import json
import subprocess
from pathlib import Path
from validate import Invalid, load, validate, require
from compare import compare

HERE = Path(__file__).resolve().parent
SCHEMA = HERE / "schema.json"
API = HERE / "api-map.md"


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_suite():
    cases, expected, localized, groups = [], {}, {}, []
    families = ["exposed-protocol", "exposed-orthography", "exposed-capacity", "exposed-unicode"]

    def add(case_id, query, *, action="search", values=None, local=None, family="exposed-protocol", **kwargs):
        case = {"id": case_id, "family": family, "action": action, "query": query,
                "acceptable": local if local else (values if values is not None and (values or kwargs.get("expectEmpty")) else ["r34-oracle-not-a-utility-target"]),
                "maxRank": 60, "role": "control"}
        case.update(kwargs)
        cases.append(case)
        if values is not None:
            expected[case_id] = values
        if local is not None:
            localized[case_id] = local
        return case

    add("direct-english", "heart", acceptable=["❤️"], stratum="en", forbidden=["r34-absent"], expectEmpty=False)
    add("direct-case", "HEART", acceptable=["❤️"], equivalentTo="direct-english", stratum="en", forbidden=[])
    for value in (0, -1, -1_000_000):
        add(f"direct-limit-{value}", "heart", values=[], expectEmpty=True, limit=value)
    for limit in (1, 48, 60, 1_000_000):
        add(f"direct-cap-{limit}", "face", acceptable=["😀", "😊", "😃"], limit=limit, preferred={"😊": 1_000_000, "😀": -1_000_000})
    add("direct-empty", "", values=[], expectEmpty=True)
    add("direct-punctuation", "!!!", values=[], expectEmpty=True, forbidden=["😂"])
    add("direct-digits", "89017", values=[], expectEmpty=True)
    add("direct-over80", "q" * 81, values=[], expectEmpty=True)
    add("direct-80", "q" * 80, values=[], expectEmpty=True)
    add("direct-negative-preference", "heart", acceptable=["❤️"], preferred={"❤️": -1_000_000})
    add("direct-zero-preference", "heart", acceptable=["❤️"], preferred={"❤️": 0})
    add("direct-two-preference", "heart", acceptable=["❤️"], preferred={"❤️": 2})

    add("wrapper-toned", "thumbs up", action="wrapper", acceptable=["👍🏽"], limit=1,
        recents=["👍🏻", "👍", "r34-missing"], tones={"👍": "👍🏽"}, stratum="control",
        forbidden=["👍"], expectEmpty=False)
    add("wrapper-toned-case", "THUMBS UP", action="wrapper", acceptable=["👍🏽"], limit=1,
        recents=["👍🏻", "👍", "r34-missing"], tones={"👍": "👍🏽"}, equivalentTo="wrapper-toned")
    add("wrapper-recent-dedupe", "", action="wrapper", values=["👍🏿", "❤️", "😂"],
        limit=3, recents=["👍🏿", "👍🏻", "👍", "❤️", "r34-missing"], tones={"👍": "👍🏽"})
    add("wrapper-default", "", action="wrapper", acceptable=["😂"], recents=[], tones={})
    add("wrapper-popular-tone", "", action="wrapper", acceptable=["👍🏽"], recents=[], tones={"👍": "👍🏽"}, limit=60)
    add("wrapper-whitespace", " \t\n", action="wrapper", values=["😂"], limit=1)
    add("wrapper-punctuation", "!!!", action="wrapper", values=[], expectEmpty=True, recents=["😂"])
    for limit in (0, -1, -1_000_000):
        add(f"wrapper-empty-limit-{limit}", "", action="wrapper", values=[], expectEmpty=True, limit=limit)
        add(f"wrapper-text-limit-{limit}", "heart", action="wrapper", values=[], expectEmpty=True, limit=limit)
    add("wrapper-buffer", "  thumbs\t\n  up ", action="wrapper", acceptable=["👍"], recents=[], tones={})
    add("wrapper-nonempty-cap", "face", action="wrapper", acceptable=["😀", "😊", "😃"], limit=60)

    entries = [{"emoji": "r34-fixture-copper", "name": "copper lantern", "keywords": ["beacon"], "tones": ["r34-copper-tone"]},
               {"emoji": "r34-fixture-linen", "name": "linen compass", "keywords": ["beacon"]},
               {"emoji": "r34-fixture-accent", "name": "cañalo signal", "keywords": []}]
    aliases = [{"emoji": "r34-fixture-copper", "name": "zunefa rómulo"},
               {"emoji": "r34-fixture-linen", "name": "zuñefa rómulo"},
               {"emoji": "r34-absent-alias", "name": "velúmina"}]
    add("fixture-english", "copper lantern", action="fixture", values=["r34-fixture-copper"], entries=entries,
        spanishAliases=aliases, limit=48, preferred={"r34-fixture-linen": 2}, stratum="en", forbidden=["r34-absent-alias"], expectEmpty=False)
    add("fixture-english-case", "COPPER LANTERN", action="fixture", values=["r34-fixture-copper"], entries=entries,
        spanishAliases=aliases, equivalentTo="fixture-english")
    add("fixture-no-alias", "copper lantern", action="fixture", values=["r34-fixture-copper"], entries=entries)
    add("fixture-independent-keyword", "beacon", action="fixture", values=["r34-fixture-copper", "r34-fixture-linen"], entries=entries)
    add("fixture-preferred-positive", "beacon", action="fixture", values=["r34-fixture-linen", "r34-fixture-copper"], entries=entries, preferred={"r34-fixture-linen": 1_000_000})
    add("fixture-preferred-negative", "beacon", action="fixture", values=["r34-fixture-copper", "r34-fixture-linen"], entries=entries, preferred={"r34-fixture-linen": -1_000_000})
    for case_id, query in (("english-diacritic-ascii", "canalo"), ("english-diacritic-upper", "CAÑALO"), ("english-diacritic-nfd", "can\u0303alo")):
        add(case_id, query, action="fixture", values=["r34-fixture-accent"], entries=entries, family="exposed-orthography")
    small_controls = [("spanish-n", "zunefa", ["r34-fixture-copper"], ["r34-fixture-linen"]),
                      ("spanish-enye", "zuñefa", ["r34-fixture-linen"], ["r34-fixture-copper"]),
                      ("spanish-enye-upper", "ZUÑEFA", ["r34-fixture-linen"], ["r34-fixture-copper"]),
                      ("spanish-enye-nfd", "zun\u0303efa", ["r34-fixture-linen"], ["r34-fixture-copper"]),
                      ("spanish-vowel", "romulo", ["r34-fixture-copper", "r34-fixture-linen"], []),
                      ("spanish-vowel-upper", "RÓMULO", ["r34-fixture-copper", "r34-fixture-linen"], []),
                      ("spanish-vowel-nfd", "ro\u0301mulo", ["r34-fixture-copper", "r34-fixture-linen"], [])]
    for case_id, query, local, forbidden in small_controls:
        add(case_id, query, action="fixture", values=[], local=local, acceptable=local, forbidden=forbidden,
            entries=entries, spanishAliases=aliases, family="exposed-orthography", stratum="es")
    for suffix, query in (("phrase", "zunefa romulo"), ("punctuation", "zunefa/romulo"),
                          ("apostrophe", "zunefa'romulo"), ("curly-apostrophe", "zunefa’romulo"),
                          ("digits", "zunefa9romulo"), ("reorder", "romulo zunefa"),
                          ("repeat", "romulo zunefa romulo zunefa")):
        add("spanish-" + suffix, query, action="fixture", values=[], local=["r34-fixture-copper"], acceptable=["r34-fixture-copper"],
            entries=entries, spanishAliases=aliases, family="exposed-orthography")
    groups.append({"ids": ["spanish-" + s for s in ("phrase", "punctuation", "apostrophe", "curly-apostrophe", "digits", "reorder", "repeat")], "kind": "localized-suffix-only"})
    add("fixture-absent-alias", "velumina", action="fixture", values=[], expectEmpty=True,
        entries=entries, spanishAliases=aliases, forbidden=["r34-absent-alias"])
    add("fixture-absent-alias-only", "velumina", action="fixture", values=[], expectEmpty=True,
        entries=entries, spanishAliases=[aliases[-1]])
    for limit in (0, -1, -1_000_000):
        add(f"fixture-limit-{limit}", "copper", action="fixture", values=[], expectEmpty=True, entries=entries, spanishAliases=aliases, limit=limit)
    add("fixture-empty", "", action="fixture", values=[], expectEmpty=True, entries=entries, preferred={})
    add("fixture-over80", "zunefa " * 14, action="fixture", values=[], expectEmpty=True, entries=entries, spanishAliases=aliases)

    # At least 80 matching distinct full-name terms, avoiding the 12-per-term
    # postings cap. These are mechanics controls, never useful semantic families.
    overfull = [{"emoji": f"r34-cap-{i:03d}", "name": f"anchor beacon item{chr(97+i//26)}{chr(97+i%26)}", "keywords": []} for i in range(86)]
    for limit in (1, 48, 60, 1_000_000):
        add(f"fixture-english-cap-{limit}", "anchor", action="fixture", values=[e["emoji"] for e in overfull[:min(limit, 60)]], entries=overfull, limit=limit, family="exposed-capacity")
    localized_entries = [{"emoji": f"r34-local-{i:03d}", "name": f"copper beacon item{chr(97+i//26)}{chr(97+i%26)}", "keywords": []} for i in range(86)]
    localized_aliases = [{"emoji": e["emoji"], "name": "sémura lázuli"} for e in localized_entries]
    for limit in (1, 48, 60):
        ids = []
        for suffix, query in (("plain", "semura lazuli"), ("order", "lazuli semura"), ("repeat", "semura lazuli semura"), ("upper-nfd", "LA\u0301ZULI SE\u0301MURA")):
            case_id = f"localized-cap-{limit}-{suffix}"; ids.append(case_id)
            local = [e["emoji"] for e in localized_entries[:limit]]
            add(case_id, query, action="fixture", values=[], local=local, acceptable=local, entries=localized_entries,
                spanishAliases=localized_aliases, limit=limit, preferred={localized_entries[-1]["emoji"]: 1_000_000}, family="exposed-capacity")
        groups.append({"ids": ids, "kind": "localized-suffix-only"})

    # Deliberately different legacy occupancy, with the same canonical localized
    # token sets. Reserve seven English bases, even when the actual legacy row is
    # empty. Includes all combining-mark categories and a newer Unicode letter.
    patterns = [("apostrophe", "cove's amber", ["cove's amber", "amber s cove", "amber cove s cove"]),
                ("digits", "rivet7umber", ["rivet7umber", "umber rivet", "rivet umber rivet"]),
                ("Mn", "r\u034fivet7umber", ["r\u034fivet7umber", "umber r\u034fivet", "r\u034fivet umber r\u034fivet"]),
                ("Mc", "r\u093eivet7umber", ["r\u093eivet7umber", "umber r\u093eivet", "r\u093eivet umber r\u093eivet"]),
                ("Me", "r\u20ddivet7umber", ["r\u20ddivet7umber", "umber r\u20ddivet", "r\u20ddivet umber r\u20ddivet"]),
                ("newUnicode", "r\U0001e4d0ivet7umber", ["r\U0001e4d0ivet7umber", "umber r\U0001e4d0ivet", "r\U0001e4d0ivet umber r\U0001e4d0ivet"])]
    for label, english, queries in patterns:
        reserved = [{"emoji": f"r34-reserved-{label}-{i}", "name": english, "keywords": []} for i in range(7)]
        all_entries = reserved + localized_entries
        all_aliases = [{"emoji": e["emoji"], "name": queries[1]} for e in localized_entries]
        add(f"unicode-exact-{label}", english, action="fixture", entries=reserved, acceptable=[reserved[0]["emoji"]], family="exposed-unicode")
        expected[f"unicode-exact-{label}"] = None  # Assert exact-name target first, not invented tail order.
        for limit in (1, 48, 60):
            ids = []
            for index, query in enumerate(queries):
                case_id = f"reserve-{label}-{limit}-{index}"; ids.append(case_id)
                local = [e["emoji"] for e in localized_entries[:max(0, limit-7)]]
                legacy = ([e["emoji"] for e in reserved[:min(limit, 7)]] if label == "apostrophe" else [reserved[0]["emoji"]]) if index == 0 else []
                add(case_id, query, action="fixture", values=legacy, local=local, acceptable=local or legacy,
                    expectEmpty=not (local or legacy), entries=all_entries, spanishAliases=all_aliases,
                    limit=limit, family="exposed-capacity")
            groups.append({"ids": ids, "kind": "localized-suffix-only"})
    # One ASCII canonical letter, with wrappers/repetition, adds nothing localized.
    for index, query in enumerate(("s", "S", "s s s", "(s)", "s9s", "s's")):
        add(f"ascii-single-{index}", query, action="fixture", values=[], local=[], expectEmpty=True,
            entries=entries[:2], spanishAliases=[{"emoji": e["emoji"], "name": "sémura"} for e in entries[:2]])
    # A non-ASCII one-letter token may add a fixture match.
    for index, query in enumerate(("ñ", "Ñ", "n\u0303")):
        add(f"nonascii-single-{index}", query, action="fixture", values=[], local=["r34-fixture-copper"], acceptable=["r34-fixture-copper"],
            entries=entries[:1], spanishAliases=[{"emoji": "r34-fixture-copper", "name": "ñavoru"}], family="exposed-orthography")
    suite = {"version": 2, "families": families, "cases": cases}
    validate(suite)
    return suite, expected, localized, groups


def coverage(suite):
    schema = load(SCHEMA)
    result = {}
    for action in schema["actions"]:
        rows = [r for r in suite["cases"] if r["action"] == action]
        seen = set().union(*(set(r) for r in rows))
        required = set(schema["caseRequired"] + schema["optionalCommon"] + schema[action + "Parameters"])
        require(rows and required <= seen, f"unexercised {action} fields: {sorted(required-seen)}")
        result[action] = {"executedRows": len(rows), "requiredFields": schema["caseRequired"],
                          "commonOptionalFields": schema["optionalCommon"], "parameters": schema[action + "Parameters"],
                          "allCovered": True}
    entry_seen = set().union(*(set(e) for r in suite["cases"] for e in r.get("entries", [])))
    alias_seen = set().union(*(set(a) for r in suite["cases"] for a in r.get("spanishAliases", [])))
    require(set(schema["fixtureEntryRequired"] + schema["fixtureEntryOptional"]) <= entry_seen, "fixture entry fields unexercised")
    require(set(schema["fixtureAliasRequired"]) <= alias_seen, "alias fields unexercised")
    return {"actions": result, "topLevel": sorted(suite), "fixtureEntry": sorted(entry_seen), "fixtureAlias": sorted(alias_seen), "allCovered": True}


def negatives(suite):
    small = {"version": 2, "families": ["f"], "cases": [{"id": "a", "family": "f", "action": "search", "query": "heart", "acceptable": ["❤️"], "maxRank": 1, "role": "control"}]}
    fixture = copy.deepcopy(next(r for r in suite["cases"] if r["id"] == "fixture-english"))
    fixture["family"] = "f"
    fixture["id"] = "a"
    wrapper = copy.deepcopy(next(r for r in suite["cases"] if r["id"] == "wrapper-toned"))
    wrapper["family"] = "f"; wrapper["id"] = "a"
    tests = []

    def mutation(name, fn, kind="search"):
        x = copy.deepcopy(small)
        if kind != "search":
            x["cases"] = [copy.deepcopy(fixture if kind == "fixture" else wrapper)]
        fn(x)
        tests.append((name, x))

    for field in ("version", "families", "cases"):
        mutation("missing-top-" + field, lambda x, field=field: x.pop(field))
    mutation("unknown-top", lambda x: x.update(extra=True))
    for field in load(SCHEMA)["caseRequired"]:
        mutation("missing-case-" + field, lambda x, field=field: x["cases"][0].pop(field))
    bad_fields = {"id": ["", 1, None], "family": ["", "undeclared", [], True], "action": ["invalid", 4],
                  "query": [1, None, False], "acceptable": [[], "❤️", [""], [False]],
                  "maxRank": [0, 61, True, 1.0, "1"], "role": ["invalid", False],
                  "stratum": ["invalid", True], "forbidden": ["❤️", [""], [3]],
                  "expectEmpty": [0, "true", None], "equivalentTo": ["a", "missing", "", True],
                  "limit": [-1_000_001, 1_000_001, True, False, 1.0, -1.0, "1", None],
                  "preferred": [[], {"": 1}, {"❤️": True}, {"❤️": 1.0}, {"❤️": -1_000_001}, {"❤️": 1_000_001}]}
    for field, values in bad_fields.items():
        for i, value in enumerate(values):
            mutation(f"bad-{field}-{i}", lambda x, field=field, value=value: x["cases"][0].update({field: value}))
    for i, value in enumerate(([], [""], ["f", "f"], "f", [False])):
        mutation(f"families-{i}", lambda x, value=value: x.update(families=value))
    for i, value in enumerate((True, 2.0, 3, "2")):
        mutation(f"version-{i}", lambda x, value=value: x.update(version=value))
    mutation("case-list-type", lambda x: x.update(cases={}))
    mutation("case-object-type", lambda x: x.update(cases=[False]))
    mutation("duplicate-id", lambda x: x["cases"].append(copy.deepcopy(x["cases"][0])))
    mutation("unknown-case", lambda x: x["cases"][0].update(typo=True))
    for action, other_fields in (("search", {"recents": [], "tones": {}, "entries": [], "spanishAliases": []}),
                                 ("wrapper", {"preferred": {}, "entries": [], "spanishAliases": []}),
                                 ("fixture", {"recents": [], "tones": {}})):
        for key, value in other_fields.items():
            mutation(f"wrong-action-{action}-{key}", lambda x, key=key, value=value: x["cases"][0].update({key: value}), action)
    mutation("useful-missing-stratum", lambda x: x["cases"][0].update(role="useful"))
    mutation("useful-control-stratum", lambda x: x["cases"][0].update(role="useful", stratum="control"))
    mutation("empty-acceptable-useful", lambda x: x["cases"][0].update(role="useful", stratum="es", acceptable=[], expectEmpty=True))
    def cycle(x):
        x["cases"][0]["equivalentTo"] = "b"
        second = copy.deepcopy(x["cases"][0]); second.update(id="b", equivalentTo="a"); x["cases"].append(second)
    mutation("cyclic-reference", cycle)
    for field, values in {"recents": ["x", [""], [0]], "tones": [[], {"": "👍"}, {"👍": ""}, {"👍": 1}]}.items():
        for i, value in enumerate(values):
            mutation(f"wrapper-{field}-{i}", lambda x, field=field, value=value: x["cases"][0].update({field: value}), "wrapper")
    for field, values in {"entries": [[], {}, [None]], "spanishAliases": [[], {}, [None]]}.items():
        for i, value in enumerate(values):
            mutation(f"fixture-{field}-{i}", lambda x, field=field, value=value: x["cases"][0].update({field: value}), "fixture")
    mutation("fixture-missing-entries", lambda x: x["cases"][0].pop("entries"), "fixture")
    for key in ("emoji", "name", "keywords"):
        mutation("entry-missing-" + key, lambda x, key=key: x["cases"][0]["entries"][0].pop(key), "fixture")
    for key, value in (("emoji", ""), ("name", ""), ("keywords", "x"), ("keywords", [""]), ("tones", [""]), ("tones", "x"), ("extra", "x")):
        mutation(f"entry-invalid-{key}-{len(tests)}", lambda x, key=key, value=value: x["cases"][0]["entries"][0].update({key: value}), "fixture")
    mutation("duplicate-base", lambda x: x["cases"][0]["entries"].append(copy.deepcopy(x["cases"][0]["entries"][0])), "fixture")
    for key in ("emoji", "name"):
        mutation("alias-missing-" + key, lambda x, key=key: x["cases"][0]["spanishAliases"][0].pop(key), "fixture")
        mutation("alias-empty-" + key, lambda x, key=key: x["cases"][0]["spanishAliases"][0].update({key: ""}), "fixture")
    mutation("alias-extra", lambda x: x["cases"][0]["spanishAliases"][0].update(extra="x"), "fixture")
    mutation("duplicate-alias-identical", lambda x: x["cases"][0]["spanishAliases"].append(copy.deepcopy(x["cases"][0]["spanishAliases"][0])), "fixture")
    mutation("duplicate-alias-conflicting", lambda x: x["cases"][0]["spanishAliases"].append({"emoji": x["cases"][0]["spanishAliases"][0]["emoji"], "name": "conflicting"}), "fixture")
    mutation("duplicate-absent-alias", lambda x: x["cases"][0]["spanishAliases"].append(copy.deepcopy(x["cases"][0]["spanishAliases"][-1])), "fixture")
    return tests


def run(runner, catalog, suite_path, output_path, success=True):
    # Stale output can never masquerade as execution of this input.
    output_path.unlink(missing_ok=True)
    result = subprocess.run([str(runner), str(catalog), str(suite_path), str(output_path)], text=True, capture_output=True, timeout=90)
    require(not result.stdout, "runner unexpectedly printed payload/stdout")
    if success:
        require(result.returncode == 0, f"runner execution failed: {result.stderr.strip()}")
        require(output_path.is_file(), "runner succeeded without output")
    else:
        require(result.returncode != 0 and not output_path.exists(), "invalid/missing resource unexpectedly executed")
    return result


def comparator_selfcheck(directory):
    # Output failures, fail-to-fail raw changes, explicit rank, negatives,
    # references and unique family utility are checked without any emoji semantics.
    base = {"version": 2, "families": ["explicit-family", "controls"], "cases": [
        {"id": "useful", "family": "explicit-family", "action": "search", "query": "x", "acceptable": ["A", "A", "B"], "maxRank": 1, "role": "useful", "stratum": "en", "forbidden": ["Z"]},
        {"id": "fail-fail", "family": "controls", "action": "search", "query": "y", "acceptable": ["Q"], "maxRank": 1, "role": "control"},
        {"id": "empty", "family": "controls", "action": "search", "query": "", "acceptable": [], "maxRank": 1, "role": "control", "expectEmpty": True},
        {"id": "equiv", "family": "controls", "action": "search", "query": "z", "acceptable": ["A"], "maxRank": 1, "role": "control", "equivalentTo": "useful"}]}
    validate(base)
    def row(case_id, values, query):
        return {"id": case_id, "values": values, "baseValues": values, "query": query}
    baseline = [row("useful", ["A"], "x"), row("fail-fail", ["X"], "y"), row("empty", [], ""), row("equiv", ["A"], "z")]
    candidate = [row("useful", ["B", "A", "Z"], "x"), row("fail-fail", ["Y"], "y"), row("empty", ["X"], ""), row("equiv", ["A"], "z")]
    b, c = directory / "comparator-selfcheck-baseline.json", directory / "comparator-selfcheck-candidate.json"
    write(directory / "comparator-selfcheck-suite.json", base); write(b, baseline); write(c, candidate)
    result = compare(base, b, c)
    require(result["rows"][0]["candidate"]["targetRanks"] == [{"target": "A", "rank": 2}, {"target": "B", "rank": 1}], "explicit rank/unique targets")
    require(result["rows"][0]["candidate"]["forbiddenHits"] == ["Z"] and not result["rows"][0]["candidate"]["pass"], "forbidden check")
    require(not result["rows"][2]["candidate"]["pass"] and not result["rows"][3]["candidate"]["pass"], "empty/equivalence check")
    require(any(r["id"] == "fail-fail" and r["transition"] == "fail-to-fail" for r in result["changedRawArrays"]), "fail-to-fail raw changes missing")
    require(result["summary"]["baseline"]["useful"]["uniqueAcceptedAlternatives"] == ["A"], "unique alternatives")
    require(result["summary"]["candidate"]["useful"]["uniqueAcceptedAlternatives"] == [], "failing forbidden row counted as utility")
    rank_only = copy.deepcopy(candidate); rank_only[0] = row("useful", ["X", "A"], "x")
    write(c, rank_only)
    require(not compare(base, b, c)["rows"][0]["candidate"]["pass"], "maxRank not enforced")
    single_alternative = copy.deepcopy(candidate); single_alternative[0] = row("useful", ["B"], "x")
    write(c, single_alternative)
    alternative_report = compare(base, b, c)
    require(alternative_report["summary"]["candidate"]["useful"]["uniqueAcceptedAlternatives"] == ["B"], "unique passing alternative count")
    wrapper_suite = copy.deepcopy(base)
    for case in wrapper_suite["cases"]:
        case["action"] = "wrapper"
    write(directory / "comparator-selfcheck-wrapper-suite.json", wrapper_suite)
    toned = copy.deepcopy(baseline)
    toned[0]["baseValues"] = ["base-one"]; toned[3]["baseValues"] = ["base-two"]
    write(c, toned)
    eq = compare(wrapper_suite, b, c)["rows"][3]["candidate"]["equivalence"]
    require(eq["equalValues"] is True and eq["equalBaseValues"] is False, "baseValues-only equivalence mismatch missed")
    write(c, candidate[:-1])
    missing = compare(base, b, c)
    require(not missing["summary"]["candidate"]["executionValid"] and len(missing["rows"]) == 4 and not missing["rows"][-1]["candidate"]["available"], "missing row silently dropped")
    write(c, candidate + [candidate[0]])
    require(not compare(base, b, c)["summary"]["candidate"]["executionValid"], "duplicate output id accepted")
    write(c, list(reversed(candidate)))
    require(not compare(base, b, c)["summary"]["candidate"]["executionValid"], "reordered output accepted")
    malformed = copy.deepcopy(candidate); malformed[0]["extra"] = True
    write(c, malformed)
    require(not compare(base, b, c)["summary"]["candidate"]["executionValid"], "unknown output field accepted")
    c.write_text("not json", encoding="utf-8")
    require(compare(base, b, c)["summary"]["candidate"]["useful"]["unavailable"] == 1, "unreadable output denominator")
    c.unlink()
    require(compare(base, b, c)["summary"]["candidate"]["controls"]["unavailable"] == 3, "missing output denominator")
    return {"explicitTargetRanks": True, "uniqueAlternatives": True, "familyUtilitySeparateFromControls": True,
            "forbiddenEmptyEquivalence": True, "baseValuesOnlyEquivalence": True, "maxRankBoundary": True, "failFailRawArrays": True, "missingMalformedDuplicateOrderUnknownOutput": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("runner", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("outputdir", type=Path)
    parser.add_argument("--candidate-runner", type=Path)
    parser.add_argument("--suite", type=Path)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args()
    try:
        directory = args.outputdir.resolve()
        repo = HERE.parents[3]
        require(not directory.is_relative_to(repo), "execution artifacts must be outside repository")
        directory.mkdir(parents=True, exist_ok=True)
        summary_path = args.summary if args.summary else directory / "protocol-smoke-summary.json"
        summary_path.unlink(missing_ok=True)
        args.runner = args.runner.resolve(); args.catalog = args.catalog.resolve()
        suite, expected, localized, groups = build_suite()
        suite_path = directory / "protocol-exposed-smoke.json"
        manifest_path = directory / "protocol-exposed-oracles.json"
        write(suite_path, suite)
        write(manifest_path, {"classification": "EXPOSED controls only; not semantic utility", "baselineExpected": expected,
                              "candidateLocalizedSuffixExpected": localized, "localizedInvariantGroups": groups})
        field_coverage = coverage(suite)
        baseline_path = directory / "baseline-output.json"
        run(args.runner, args.catalog, suite_path, baseline_path)
        baseline_report = compare(suite, baseline_path, baseline_path)
        require(baseline_report["summary"]["baseline"]["executionValid"], "baseline execution incomplete/invalid")
        baseline = {r["id"]: r for r in load(baseline_path)}
        for case_id, values in expected.items():
            if values is None:
                case = next(r for r in suite["cases"] if r["id"] == case_id)
                require(baseline[case_id]["values"][:1] == case["acceptable"][:1], f"exact-name legacy target not first: {case_id}")
            else:
                require(baseline[case_id]["values"] == values, f"baseline explicit English/empty control mismatch: {case_id}: {baseline[case_id]['values']!r}")
        require(baseline["wrapper-buffer"]["query"] == "thumbs up ", "wrapper actual buffer echo")
        require(baseline["wrapper-whitespace"]["query"] == "", "wrapper whitespace buffer")
        require(baseline["wrapper-toned"]["values"] == ["👍🏽"] and baseline["wrapper-toned"]["baseValues"] == ["👍"], "wrapper tone/base mapping")
        require(baseline["wrapper-recent-dedupe"]["baseValues"] == ["👍", "❤️", "😂"], "wrapper recent base dedupe")
        require(all(r["role"] == "control" for r in suite["cases"]), "smoke must never claim semantic utility")
        # All declared schema oracles outside localized additions must actually pass.
        localized_ids = set(localized)
        exempt = localized_ids | {r["id"] for r in suite["cases"] if r["id"].startswith("reserve-")}
        failures = [r["id"] for r in baseline_report["rows"] if r["id"] not in exempt and not r["baseline"]["pass"]]
        require(not failures, f"baseline nonlocalized oracle failures: {failures}")
        write(directory / "baseline-oracle-report.json", baseline_report)
        invalid_tests = negatives(suite)
        rejected = []
        negative_path = directory / "protocol-exposed-invalid.json"
        negative_output = directory / "negative-output.json"
        for name, invalid in invalid_tests:
            write(negative_path, invalid)
            try:
                validate(load(negative_path))
            except (ValueError, TypeError):
                pass
            else:
                raise Invalid("Python validator accepted invalid case: " + name)
            run(args.runner, args.catalog, negative_path, negative_output, False)
            rejected.append(name)
        # Retain every exposed negative input for machine-only exclusion, not just
        # the last mutation. This archive itself is not an executable suite.
        write(directory / "protocol-exposed-negative-archive.json", [{"name": n, "suite": s} for n, s in invalid_tests])
        lexical = [
            ("duplicate-json-key", '{"version":2,"version":2,"families":["f"],"cases":[]}'),
            ("exponent-integer", '{"version":2e0,"families":["f"],"cases":[]}'),
            ("nan", '{"version":NaN,"families":["f"],"cases":[]}'),
            ("trailing", '{"version":2,"families":["f"],"cases":[]} false'),
            ("leading-zero", '{"version":02,"families":["f"],"cases":[]}'),
            ("unpaired-surrogate", '{"version":2,"families":["\\ud800"],"cases":[]}'),
        ]
        for name, raw in lexical:
            negative_path.write_text(raw, encoding="utf-8")
            try:
                validate(load(negative_path))
            except (ValueError, TypeError):
                pass
            else:
                raise Invalid("validator accepted lexical negative: " + name)
            run(args.runner, args.catalog, negative_path, negative_output, False)
            rejected.append(name)
        # Mandatory resource failures are tested even with valid fixture inputs.
        fixture_suite = {"version": 2, "families": suite["families"], "cases": [next(r for r in suite["cases"] if r["id"] == "fixture-english")]}
        fixture_path = directory / "protocol-exposed-fixture-only.json"; write(fixture_path, fixture_suite)
        absent = directory / "resource-deliberately-absent.json"
        absent.unlink(missing_ok=True)
        run(args.runner, absent, fixture_path, negative_output, False)
        malformed = directory / "malformed-catalog.json"; malformed.write_text("{}", encoding="utf-8")
        run(args.runner, malformed, fixture_path, negative_output, False)
        bad_input = directory / "input-deliberately-absent.json"; bad_input.unlink(missing_ok=True)
        run(args.runner, args.catalog, bad_input, negative_output, False)
        comparator_checks = comparator_selfcheck(directory)
        result = {"protocolSmokePassed": True, "domainAdmission": "not evaluated", "semanticUtilityClaimed": False,
                  "baselineCommit": "e6871a164cfbc2eca4d0b3da700364a55e4e4dcb",
                  "hashes": {p.name: digest(p) for p in (SCHEMA, API, HERE / "runner.swift", HERE / "validate.py", HERE / "compare.py", HERE / "smoke-runner.py", args.runner, args.catalog)},
                  "artifacts": {"suite": str(suite_path), "oracles": str(manifest_path), "negativeArchive": str(directory / "protocol-exposed-negative-archive.json"),
                                "fixtureOnlySuite": str(fixture_path), "comparatorSuite": str(directory / "comparator-selfcheck-suite.json"), "comparatorWrapperSuite": str(directory / "comparator-selfcheck-wrapper-suite.json"),
                                "baselineOutput": str(baseline_path), "baselineOracleReport": str(directory / "baseline-oracle-report.json")},
                  "inputHashes": {p.name: digest(p) for p in (suite_path, manifest_path, directory / "protocol-exposed-negative-archive.json", fixture_path, directory / "comparator-selfcheck-suite.json", directory / "comparator-selfcheck-wrapper-suite.json")},
                  "executedBaselineRows": len(suite["cases"]), "explicitBaselineAssertions": len(expected) + 4,
                  "allFieldCoverage": field_coverage, "rejectedInvalidInputs": len(rejected), "rejectionNames": rejected,
                  "mandatoryResourceFailures": ["absent catalog with fixture-only input", "invalid catalog with fixture-only input", "absent input"],
                  "comparatorSelfcheck": comparator_checks,
                  "baselineLocalizedOracleFailuresExpected": [r["id"] for r in baseline_report["rows"] if not r["baseline"]["pass"]],
                  "localizedInvariantGroupsPrepared": len(groups),
                  "legacyOrderDependenceWitnesses": [{"group": g["ids"], "distinctRawArrays": len({json.dumps(baseline[i]["values"]) for i in g["ids"]})}
                                                    for g in groups if len({json.dumps(baseline[i]["values"]) for i in g["ids"]}) > 1]}
        if args.candidate_runner:
            candidate_path = directory / "candidate-output.json"
            run(args.candidate_runner.resolve(), args.catalog, suite_path, candidate_path)
            comparison = compare(suite, baseline_path, candidate_path)
            write(directory / "candidate-oracle-report.json", comparison)
            require(comparison["summary"]["candidate"]["executionValid"], "candidate execution incomplete/invalid")
            candidate = {r["id"]: r for r in load(candidate_path)}
            suffixes = {}
            for case in suite["cases"]:
                case_id = case["id"]; b, c = baseline[case_id], candidate[case_id]
                for field in ("values", "baseValues"):
                    require(c[field][:len(b[field])] == b[field], f"legacy ordered prefix lost: {case_id}/{field}")
                suffixes[case_id] = c["values"][len(b["values"]):]
                if case_id in localized:
                    require(suffixes[case_id] == localized[case_id], f"independent localized fixture oracle failed: {case_id}")
                if case_id not in localized and not case_id.startswith("reserve-"):
                    require(c["values"] == b["values"] and c["baseValues"] == b["baseValues"], f"English-only/exact legacy control changed: {case_id}")
            for group in groups:
                require(all(suffixes[i] == suffixes[group["ids"][0]] for i in group["ids"]), f"localized order/repetition invariance failed: {group['ids']}")
            require(comparison["summary"]["candidate"]["allRowsPass"], "candidate explicit suite oracles failed")
            # For every prepared oracle (including zero reserved capacity) inspect
            # the suffix, never require whole-array equality for English variants.
            result["candidate"] = {"passed": True, "runnerSHA256": digest(args.candidate_runner.resolve()),
                                   "executedRows": len(candidate), "localizedFixtureAssertions": len(localized), "localizedInvariantGroups": len(groups)}
        if args.suite:
            extra_suite = validate(load(args.suite))
            extra_output = directory / "arbitrary-baseline-output.json"
            run(args.runner, args.catalog, args.suite.resolve(), extra_output)
            other = extra_output
            if args.candidate_runner:
                other = directory / "arbitrary-candidate-output.json"
                run(args.candidate_runner.resolve(), args.catalog, args.suite.resolve(), other)
            report = compare(extra_suite, extra_output, other)
            write(directory / "arbitrary-oracle-report.json", report)
            require(report["summary"]["baseline"]["executionValid"] and report["summary"]["candidate"]["executionValid"], "arbitrary exposed suite execution invalid")
            result["arbitraryExposedSuite"] = {"path": str(args.suite.resolve()), "sha256": digest(args.suite), "rows": len(extra_suite["cases"]),
                                               "oracleReport": str(directory / "arbitrary-oracle-report.json"), "summary": report["summary"]}
        write(summary_path, result)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        parser.exit(1, f"smoke failed: {error}\n")
    print(json.dumps({"passed": True, "executedBaselineRows": result["executedBaselineRows"], "rejectedInvalidInputs": len(rejected),
                      "suite": str(suite_path), "summary": str(summary_path)}))

if __name__ == "__main__":
    main()
