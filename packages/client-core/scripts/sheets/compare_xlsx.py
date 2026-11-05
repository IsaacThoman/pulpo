#!/usr/bin/env python3
"""Diff two inspect_xlsx dumps (or two workbooks, which are inspected first).

    ~/.cache/pulpo-sheets-venv/bin/python -I compare_xlsx.py A B [--ignore PATTERN,...]
        [--values] [--no-styles] [--format json|text] [--max N]

A and B may be .xlsx/.xlsm/.xltx files or JSON files written by inspect_xlsx.py.
Differences are reported as slash-separated paths into the dump, e.g.
``sheets/Sheet1/cells/B2/font/bold``.

--ignore takes comma-separated patterns (repeatable):
  * a pattern without '/' matches any single path segment (fnmatch), e.g.
    ``package``, ``font``, ``warnings``, ``calc``;
  * a pattern with '/' is fnmatch'ed against the path and each of its prefixes,
    e.g. ``sheets/*/columns``, ``sheets/Data/cells/A1``, ``workbook/calc/*``.
``file`` (the basename) is always ignored.

Prints JSON ``{"equal": bool, "differences": [{"path", "kind", "a", "b"}], ...}``
(or one line per difference with --format text). Exit 0 if equal, 1 if
different, 2 if either side could not be inspected.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import sys

sys.dont_write_bytecode = True  # keep the scripts dir free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sheets_common import emit  # noqa: E402

MISSING = "<missing>"


def load_side(path: str, values: bool, styles: bool) -> dict:
    if path.lower().endswith(".json"):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    from inspect_xlsx import inspect

    return inspect(path, values=values, styles=styles)


class Matcher:
    def __init__(self, patterns: list[str]):
        self.segment = [p for p in patterns if "/" not in p]
        self.path = [p for p in patterns if "/" in p]

    def ignored(self, parts: list[str]) -> bool:
        for seg in parts:
            for pat in self.segment:
                if fnmatch.fnmatchcase(seg, pat):
                    return True
        if self.path:
            for i in range(1, len(parts) + 1):
                prefix = "/".join(parts[:i])
                for pat in self.path:
                    if fnmatch.fnmatchcase(prefix, pat):
                        return True
        return False


def diff(a, b, parts: list[str], matcher: Matcher, out: list, limit: int) -> None:
    if len(out) >= limit:
        return
    if parts and matcher.ignored(parts):
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b), key=str):
            sub = parts + [str(key)]
            if key not in a:
                if not matcher.ignored(sub):
                    out.append({"path": "/".join(sub), "kind": "added", "a": MISSING, "b": b[key]})
            elif key not in b:
                if not matcher.ignored(sub):
                    out.append({"path": "/".join(sub), "kind": "removed", "a": a[key], "b": MISSING})
            else:
                diff(a[key], b[key], sub, matcher, out, limit)
            if len(out) >= limit:
                return
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append({"path": "/".join(parts), "kind": "length", "a": len(a), "b": len(b)})
        for i in range(min(len(a), len(b))):
            diff(a[i], b[i], parts + [str(i)], matcher, out, limit)
        for i in range(len(b), len(a)):
            out.append({"path": "/".join(parts + [str(i)]), "kind": "removed", "a": a[i], "b": MISSING})
        for i in range(len(a), len(b)):
            out.append({"path": "/".join(parts + [str(i)]), "kind": "added", "a": MISSING, "b": b[i]})
        return
    if type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool)):
        out.append({"path": "/".join(parts), "kind": "type", "a": a, "b": b})
        return
    if a != b:
        out.append({"path": "/".join(parts), "kind": "changed", "a": a, "b": b})


def short(v) -> str:
    text = json.dumps(v, sort_keys=True, ensure_ascii=False) if v is not MISSING else MISSING
    return text if len(text) <= 120 else text[:117] + "..."


def compare(a: dict, b: dict, ignore: list[str], limit: int = 500) -> dict:
    matcher = Matcher(["file"] + ignore)
    out: list = []
    diff(a, b, [], matcher, out, limit)
    return {"equal": not out, "count": len(out), "truncated": len(out) >= limit, "differences": out}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--ignore", action="append", default=[], help="comma-separated ignore patterns")
    ap.add_argument("--values", action="store_true", help="inspect with cached values (data_only)")
    ap.add_argument("--no-styles", action="store_true")
    ap.add_argument("--format", choices=("json", "text"), default="json")
    ap.add_argument("--max", type=int, default=500, help="stop after N differences")
    args = ap.parse_args()

    ignore = [p.strip() for chunk in args.ignore for p in chunk.split(",") if p.strip()]
    sides = []
    for path in (args.a, args.b):
        if not os.path.isfile(path):
            emit({"error": {"type": "FileNotFoundError", "message": path}}, 2)
        sides.append(load_side(path, args.values, not args.no_styles))
    errors = {name: side["error"] for name, side in zip(("a", "b"), sides) if "error" in side}
    if errors:
        emit({"error": {"type": "InspectFailed", "sides": errors}}, 2)

    result = compare(sides[0], sides[1], ignore, args.max)
    result["a"] = args.a
    result["b"] = args.b
    result["ignore"] = ignore
    code = 0 if result["equal"] else 1
    if args.format == "text":
        if result["equal"]:
            print("equal")
        for d in result["differences"]:
            print(f"{d['kind']:8s} {d['path']}: {short(d['a'])} -> {short(d['b'])}")
        if result["truncated"]:
            print(f"... stopped after {args.max} differences")
        sys.exit(code)
    emit(result, code)


if __name__ == "__main__":
    main()
