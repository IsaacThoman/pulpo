#!/usr/bin/env python3
"""Part-level comparison of two OOXML packages (xlsx/xlsm/docx/pptx zips).

    ~/.cache/pulpo-sheets-venv/bin/python -I xml_parts_diff.py A B [--max-diffs N] [--ignore-part GLOB]...

Every part is classified as:
  identical   byte-for-byte equal
  equivalent  XML that differs only in serialisation: attribute order,
              insignificant whitespace, namespace prefixes / declaration
              placement, XML declaration, entity/char-ref spelling. For
              [Content_Types].xml and *.rels child order is also ignored.
  different   XML with a real change; ``changes`` lists up to N element-level
              differences as paths like /worksheet/sheetData/row[2]/c[1]@s
  binary      non-XML parts that differ (sizes and sha256 reported)
plus ``added`` / ``removed`` part names. ``order`` reports whether the zip
entry order differs. Exit 0 when nothing is different (identical/equivalent
only), 1 otherwise, 2 if a zip cannot be read.

DTDs are refused (reported as different with an error) - corpus files are untrusted.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import os
import re
import sys
import zipfile

sys.dont_write_bytecode = True  # keep the scripts dir free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sheets_common import emit, parse_xml, read_part  # noqa: E402

XML_EXTS = (".xml", ".rels", ".vml")
UNORDERED_PARTS = ("[Content_Types].xml",)
XML_NS = "http://www.w3.org/XML/1998/namespace"


def is_xml(name: str, data: bytes) -> bool:
    if name.lower().endswith(XML_EXTS):
        return True
    head = data[:200].lstrip(b"\xef\xbb\xbf \t\r\n")
    return head.startswith(b"<?xml") or head.startswith(b"<")


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else str(tag)


def significant_text(text: str | None, preserve: bool) -> str | None:
    if text is None:
        return None
    if preserve:
        return text
    return None if text.strip() == "" else text


def canon(el, unordered: bool, preserve: bool = False) -> tuple:
    """Hashable canonical form: (tag-with-ns-uri, sorted attrs, text, children, tail-less)."""
    space = el.get(f"{{{XML_NS}}}space")
    if space is not None:
        preserve = space == "preserve"
    attrs = tuple(sorted(el.attrib.items()))
    children = [canon(c, unordered, preserve) + (significant_text(c.tail, preserve),) for c in el]
    if unordered:
        children.sort(key=repr)
    return (el.tag, attrs, significant_text(el.text, preserve), tuple(children))


def tree_changes(a, b, path: str, out: list, limit: int, preserve: bool = False) -> None:
    if len(out) >= limit:
        return
    if a.tag != b.tag:
        out.append({"path": path, "kind": "tag", "a": a.tag, "b": b.tag})
        return
    space = a.get(f"{{{XML_NS}}}space")
    if space is not None:
        preserve = space == "preserve"
    for key in sorted(set(a.attrib) | set(b.attrib)):
        va, vb = a.attrib.get(key), b.attrib.get(key)
        if va != vb:
            out.append({"path": f"{path}@{local(key) if not key.startswith('{') else key}", "kind": "attr", "a": va, "b": vb})
            if len(out) >= limit:
                return
    ta, tb = significant_text(a.text, preserve), significant_text(b.text, preserve)
    if ta != tb:
        out.append({"path": f"{path}/text()", "kind": "text", "a": clip(ta), "b": clip(tb)})
    ca, cb = list(a), list(b)
    counters: dict = {}
    for i in range(max(len(ca), len(cb))):
        if len(out) >= limit:
            return
        ref = ca[i] if i < len(ca) else cb[i]
        name = local(ref.tag)
        counters[name] = counters.get(name, 0) + 1
        sub = f"{path}/{name}[{counters[name]}]"
        if i >= len(ca):
            out.append({"path": sub, "kind": "added", "b": clip(summary(cb[i]))})
        elif i >= len(cb):
            out.append({"path": sub, "kind": "removed", "a": clip(summary(ca[i]))})
        else:
            tree_changes(ca[i], cb[i], sub, out, limit, preserve)
            tla, tlb = significant_text(ca[i].tail, preserve), significant_text(cb[i].tail, preserve)
            if tla != tlb:
                out.append({"path": f"{sub}/tail()", "kind": "text", "a": clip(tla), "b": clip(tlb)})


def summary(el) -> str:
    attrs = " ".join(f'{local(k)}="{v}"' for k, v in sorted(el.attrib.items()))
    return f"<{local(el.tag)}{' ' + attrs if attrs else ''}>{'...' if len(el) else (el.text or '')}"


def clip(v):
    if isinstance(v, str) and len(v) > 200:
        return v[:197] + "..."
    return v


def prefixes(data: bytes) -> dict:
    return dict(sorted(re.findall(rb'xmlns:?([A-Za-z0-9_.-]*)="([^"]*)"', data[:200000])))


def equivalence_notes(da: bytes, db: bytes) -> list[str]:
    notes = []
    decl = re.compile(rb"^\s*(\xef\xbb\xbf)?<\?xml[^>]*\?>")
    ma, mb = decl.match(da), decl.match(db)
    if (ma.group(0) if ma else b"") != (mb.group(0) if mb else b""):
        notes.append("xml-declaration")
    if prefixes(da) != prefixes(db):
        notes.append("namespace-prefixes")
    strip = re.compile(rb">\s+<")
    if strip.sub(b"><", da) != strip.sub(b"><", db) or not notes:
        notes.append("attribute-order-or-whitespace")
    return notes


def diff_packages(a_path: str, b_path: str, max_diffs: int = 25, ignore: list[str] | None = None) -> dict:
    ignore = ignore or []
    with zipfile.ZipFile(a_path) as za, zipfile.ZipFile(b_path) as zb:
        names_a = [n for n in za.namelist() if not n.endswith("/")]
        names_b = [n for n in zb.namelist() if not n.endswith("/")]
        skip = lambda n: any(fnmatch.fnmatchcase(n, g) for g in ignore)  # noqa: E731
        set_a = {n for n in names_a if not skip(n)}
        set_b = {n for n in names_b if not skip(n)}
        result: dict = {
            "a": a_path,
            "b": b_path,
            "added": sorted(set_b - set_a),
            "removed": sorted(set_a - set_b),
            "identical": [],
            "equivalent": {},
            "different": {},
            "binary": {},
            "order": "same",
        }
        common_a = [n for n in names_a if n in set_b and n in set_a]
        common_b = [n for n in names_b if n in set_a and n in set_b]
        if common_a != common_b:
            result["order"] = "different"
        for name in sorted(set_a & set_b):
            da = read_part(za, name)
            db = read_part(zb, name)
            if da == db:
                result["identical"].append(name)
                continue
            if is_xml(name, da) and is_xml(name, db):
                try:
                    ra, rb = parse_xml(da), parse_xml(db)
                except Exception as exc:
                    result["different"][name] = {"error": f"{type(exc).__name__}: {exc}"[:300]}
                    continue
                unordered = name in UNORDERED_PARTS or name.endswith(".rels")
                if canon(ra, unordered) == canon(rb, unordered):
                    notes = equivalence_notes(da, db)
                    if unordered and canon(ra, False) != canon(rb, False):
                        notes = ["child-order"] + [n for n in notes if n != "attribute-order-or-whitespace"]
                    result["equivalent"][name] = notes
                    continue
                changes: list = []
                if unordered:
                    ka = sorted(repr(canon(c, True)) for c in ra)
                    kb = sorted(repr(canon(c, True)) for c in rb)
                    only_a = [summary(c) for c in ra if repr(canon(c, True)) not in kb]
                    only_b = [summary(c) for c in rb if repr(canon(c, True)) not in ka]
                    changes = [{"path": f"/{local(ra.tag)}/*", "kind": "removed", "a": clip(s)} for s in only_a]
                    changes += [{"path": f"/{local(rb.tag)}/*", "kind": "added", "b": clip(s)} for s in only_b]
                    changes = changes[:max_diffs]
                else:
                    tree_changes(ra, rb, f"/{local(ra.tag)}", changes, max_diffs)
                result["different"][name] = {"changes": changes, "truncated": len(changes) >= max_diffs}
            else:
                result["binary"][name] = {
                    "a": {"size": len(da), "sha256": hashlib.sha256(da).hexdigest()},
                    "b": {"size": len(db), "sha256": hashlib.sha256(db).hexdigest()},
                }
    result["summary"] = {
        "added": len(result["added"]),
        "removed": len(result["removed"]),
        "identical": len(result["identical"]),
        "equivalent": len(result["equivalent"]),
        "different": len(result["different"]),
        "binary": len(result["binary"]),
    }
    result["same"] = not (result["added"] or result["removed"] or result["different"] or result["binary"])
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--max-diffs", type=int, default=25, help="element differences reported per part")
    ap.add_argument("--ignore-part", action="append", default=[], help="glob of part names to skip (repeatable)")
    args = ap.parse_args()
    try:
        result = diff_packages(args.a, args.b, args.max_diffs, args.ignore_part)
    except (OSError, zipfile.BadZipFile, ValueError) as exc:
        emit({"error": {"type": type(exc).__name__, "message": str(exc)[:500]}}, 2)
    emit(result, 0 if result["same"] else 1)


if __name__ == "__main__":
    main()
