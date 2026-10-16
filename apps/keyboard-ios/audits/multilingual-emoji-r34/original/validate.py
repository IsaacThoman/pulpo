#!/usr/bin/env python3
"""Strict R34 suite grammar. CLI: validate.py SUITE [SCHEMA]. No row filtering."""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOUND = 1_000_000

class Invalid(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise Invalid(message)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON object key: {key!r}")
        result[key] = value
    return result

def load(path):
    def bad_constant(value):
        raise Invalid(f"invalid JSON constant: {value}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle, object_pairs_hook=unique_object, parse_constant=bad_constant)

def integer(value, lo, hi, where):
    require(type(value) is int and lo <= value <= hi, f"{where}: integer {lo}...{hi} required (not bool/float)")

def string(value, where, nonempty=True):
    require(type(value) is str and (bool(value) or not nonempty), f"{where}: {'nonempty ' if nonempty else ''}string required")
    require(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), f"{where}: unpaired surrogate")

def strings(value, where, nonempty=False):
    require(type(value) is list and (bool(value) or not nonempty), f"{where}: {'nonempty ' if nonempty else ''}array required")
    for i, item in enumerate(value):
        string(item, f"{where}[{i}]")

def fields(value, required, allowed, where):
    require(type(value) is dict, f"{where}: object required")
    require(set(required) <= value.keys(), f"{where}: missing fields {sorted(set(required) - value.keys())}")
    require(value.keys() <= set(allowed), f"{where}: unknown fields {sorted(value.keys() - set(allowed))}")

def validate(suite, schema=None):
    schema = load(HERE / "schema.json") if schema is None else schema
    # Fail closed when this implementation and the immutable descriptor diverge.
    expected = {
        "requiredTopLevel": ["version", "families", "cases"],
        "caseRequired": ["id", "family", "action", "query", "acceptable", "maxRank", "role"],
        "actions": ["search", "wrapper", "fixture"], "roles": ["useful", "control"],
        "optionalCommon": ["stratum", "forbidden", "equivalentTo", "expectEmpty"],
        "searchParameters": ["limit", "preferred"], "wrapperParameters": ["limit", "recents", "tones"],
        "fixtureParameters": ["entries", "spanishAliases", "limit", "preferred"],
        "fixtureEntryRequired": ["emoji", "name", "keywords"], "fixtureEntryOptional": ["tones"],
        "fixtureAliasRequired": ["emoji", "name"],
    }
    require(schema.get("version") == 2 and all(schema.get(k) == v for k, v in expected.items()), "schema descriptor changed; implementation review required")
    require(schema.get("limits") == {"directDefault": 48, "directCeiling": 60, "queryCharacters": 80, "wrapperQueryCharacters": 40}, "schema limits changed")
    fields(suite, schema["requiredTopLevel"], schema["requiredTopLevel"], "suite")
    integer(suite["version"], 2, 2, "version")
    strings(suite["families"], "families", True)
    require(len(set(suite["families"])) == len(suite["families"]), "duplicate family")
    require(type(suite["cases"]) is list, "cases: array required")
    ids = set()
    refs = {}
    for index, case in enumerate(suite["cases"]):
        at = f"cases[{index}]"
        require(type(case) is dict, f"{at}: object required")
        action = case.get("action")
        require(type(action) is str and action in schema["actions"], f"{at}: unknown action")
        allowed = schema["caseRequired"] + schema["optionalCommon"] + schema[action + "Parameters"]
        fields(case, schema["caseRequired"], allowed, at)
        for key in ("id", "family"):
            string(case[key], at + "." + key)
        require(case["id"] not in ids, f"{at}: duplicate id")
        ids.add(case["id"])
        require(case["family"] in suite["families"], f"{at}: undeclared family")
        string(case["query"], at + ".query", False)
        require(type(case["role"]) is str and case["role"] in schema["roles"], f"{at}: invalid role")
        if "stratum" in case:
            require(type(case["stratum"]) is str and case["stratum"] in ("en", "es", "mixed", "control"), f"{at}: invalid stratum")
        require(case["role"] != "useful" or case.get("stratum") in ("en", "es", "mixed"), f"{at}: useful requires en/es/mixed stratum")
        integer(case["maxRank"], 1, 60, at + ".maxRank")
        if "expectEmpty" in case:
            require(type(case["expectEmpty"]) is bool, f"{at}: expectEmpty must be Boolean")
        strings(case["acceptable"], at + ".acceptable")
        require(case["acceptable"] or (case.get("expectEmpty") is True and case["role"] == "control"), f"{at}: empty acceptable requires control + expectEmpty")
        for key in ("forbidden", "recents"):
            if key in case:
                strings(case[key], at + "." + key)
        if "equivalentTo" in case:
            string(case["equivalentTo"], at + ".equivalentTo")
            require(case["equivalentTo"] != case["id"], f"{at}: self reference")
            refs[case["id"]] = case["equivalentTo"]
        if "limit" in case:
            integer(case["limit"], -BOUND, BOUND, at + ".limit")
        for key in ("preferred", "tones"):
            if key in case:
                require(type(case[key]) is dict, f"{at}.{key}: object required")
                for glyph, value in case[key].items():
                    string(glyph, at + "." + key + " key")
                    if key == "preferred":
                        integer(value, -BOUND, BOUND, at + ".preferred value")
                    else:
                        string(value, at + ".tones value")
        if action == "fixture":
            require("entries" in case, f"{at}: fixture entries required")
            require(type(case["entries"]) is list and case["entries"], f"{at}: nonempty entries required")
            bases = set()
            for i, entry in enumerate(case["entries"]):
                entry_at = f"{at}.entries[{i}]"
                fields(entry, schema["fixtureEntryRequired"], schema["fixtureEntryRequired"] + schema["fixtureEntryOptional"], entry_at)
                string(entry["emoji"], entry_at + ".emoji")
                string(entry["name"], entry_at + ".name")
                strings(entry["keywords"], entry_at + ".keywords")
                if "tones" in entry:
                    strings(entry["tones"], entry_at + ".tones")
                require(entry["emoji"] not in bases, f"{entry_at}: duplicate fixture base")
                bases.add(entry["emoji"])
            if "spanishAliases" in case:
                require(type(case["spanishAliases"]) is list and case["spanishAliases"], f"{at}: nonempty spanishAliases required when present")
                aliases = set()
                for i, alias in enumerate(case["spanishAliases"]):
                    alias_at = f"{at}.spanishAliases[{i}]"
                    fields(alias, schema["fixtureAliasRequired"], schema["fixtureAliasRequired"], alias_at)
                    string(alias["emoji"], alias_at + ".emoji")
                    string(alias["name"], alias_at + ".name")
                    require(alias["emoji"] not in aliases, f"{alias_at}: duplicate alias (including absent glyphs)")
                    aliases.add(alias["emoji"])
    require(set(refs.values()) <= ids, "equivalentTo references unknown case")
    complete = set()
    for case_id in refs:
        trail = set()
        cursor = case_id
        while cursor in refs and cursor not in complete:
            require(cursor not in trail, "cyclic equivalentTo references")
            trail.add(cursor)
            cursor = refs[cursor]
        complete.update(trail)
    return suite

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", type=Path)
    parser.add_argument("schema", type=Path, nargs="?", default=HERE / "schema.json")
    args = parser.parse_args()
    try:
        suite = validate(load(args.suite), load(args.schema))
    except (ValueError, OSError, TypeError) as error:
        parser.exit(1, f"invalid suite: {error}\n")
    print(json.dumps({"valid": True, "cases": len(suite["cases"]), "families": len(suite["families"])}))

if __name__ == "__main__":
    main()
