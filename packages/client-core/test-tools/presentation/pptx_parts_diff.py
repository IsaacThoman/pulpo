#!/usr/bin/env python3
"""Part-level comparison of two OOXML packages.

    python pptx_parts_diff.py a.pptx b.pptx [--max-lines 40] [--json] [--strict] [--ignore GLOB ...]

For every part name in either package it reports one of:
  added / removed      the part exists in only one package
  identical            same bytes
  c14n-equal           bytes differ but the XML is equal after Canonical XML 2.0
                       (attribute order, quoting, empty-element form, declaration, encoding)
  normalized-equal     equal once indentation-only whitespace is dropped and namespace
                       prefixes are renamed (n0, n1, ...); text in a:t and xml:space="preserve" kept
  different            real change; XML parts get a short unified diff of the canonical forms
  binary-different     non-XML part with different bytes (sizes and sha256 shown)

Exit status: 0 when nothing is added, removed or different (c14n/normalized-equal parts
count as equal unless --strict); 1 otherwise; 2 when a file is not a readable zip.
XML is parsed without entity expansion or network access.
"""

from __future__ import annotations

import argparse
import difflib
import fnmatch
import hashlib
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

XML_SUFFIXES = ('.xml', '.rels', '.vml')
PRESERVE_TEXT = {'t', 'instrText', 'delText'}
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
MAX_PART_BYTES = 64 * 1024 * 1024


def parser() -> etree.XMLParser:
    return etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, remove_comments=False)


def read_parts(path: Path) -> dict[str, bytes]:
    parts: dict[str, bytes] = {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            if info.file_size > MAX_PART_BYTES:
                parts[info.filename] = b'<<part larger than %d bytes skipped>>' % MAX_PART_BYTES
                continue
            parts[info.filename] = z.read(info)
    return parts


def is_xml(name: str, data: bytes) -> bool:
    if name.lower().endswith(XML_SUFFIXES):
        return True
    head = data[:64].lstrip(b'\xef\xbb\xbf \t\r\n')
    return head.startswith(b'<?xml')


def strip_layout_whitespace(root) -> None:
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        local = etree.QName(el).localname
        preserve = local in PRESERVE_TEXT or el.get(XML_SPACE) == 'preserve'
        if el.text is not None and not el.text.strip() and len(el) and not preserve:
            el.text = None
        if el.tail is not None and not el.tail.strip():
            parent = el.getparent()
            if parent is None or not (etree.QName(parent).localname in PRESERVE_TEXT or parent.get(XML_SPACE) == 'preserve'):
                el.tail = None


def canonical(data: bytes, normalized: bool) -> str:
    root = etree.fromstring(data, parser())
    if normalized:
        strip_layout_whitespace(root)
        return etree.canonicalize(root, rewrite_prefixes=True)
    return etree.canonicalize(root)


def pretty(data: bytes) -> list[str]:
    """Canonical form, one element per line, so diffs are readable."""
    root = etree.fromstring(data, parser())
    strip_layout_whitespace(root)
    root = etree.fromstring(etree.canonicalize(root).encode(), parser())
    etree.indent(root, space='  ')
    return [line if len(line) <= 240 else line[:237] + '...' for line in etree.tostring(root, encoding='unicode').splitlines()]


def compare_part(name: str, a: bytes, b: bytes, max_lines: int) -> dict:
    if a == b:
        return {'part': name, 'status': 'identical'}
    if is_xml(name, a) or is_xml(name, b):
        try:
            ca, cb = canonical(a, False), canonical(b, False)
            if ca == cb:
                return {'part': name, 'status': 'c14n-equal', 'bytes': [len(a), len(b)]}
            na, nb = canonical(a, True), canonical(b, True)
            if na == nb:
                return {'part': name, 'status': 'normalized-equal', 'bytes': [len(a), len(b)]}
            diff = list(difflib.unified_diff(pretty(a), pretty(b), 'a/' + name, 'b/' + name, lineterm='', n=2))
            out = {'part': name, 'status': 'different', 'bytes': [len(a), len(b)], 'diff_lines': len(diff)}
            out['diff'] = diff[:max_lines] + ([f'... {len(diff) - max_lines} more diff lines'] if len(diff) > max_lines else [])
            return out
        except etree.XMLSyntaxError as e:
            return {'part': name, 'status': 'different', 'bytes': [len(a), len(b)], 'xml_error': str(e)[:200]}
    return {
        'part': name,
        'status': 'binary-different',
        'bytes': [len(a), len(b)],
        'sha256': [hashlib.sha256(a).hexdigest()[:16], hashlib.sha256(b).hexdigest()[:16]],
    }


def diff_packages(a: Path, b: Path, max_lines: int = 40, ignore: list[str] | None = None) -> list[dict]:
    pa, pb = read_parts(a), read_parts(b)
    ignore = ignore or []
    results = []
    for name in sorted(set(pa) | set(pb)):
        if any(fnmatch.fnmatch(name, g) for g in ignore):
            continue
        if name not in pb:
            results.append({'part': name, 'status': 'removed', 'bytes': [len(pa[name]), None]})
        elif name not in pa:
            results.append({'part': name, 'status': 'added', 'bytes': [None, len(pb[name])]})
        else:
            results.append(compare_part(name, pa[name], pb[name], max_lines))
    return results


FAILING = {'added', 'removed', 'different', 'binary-different'}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('a', type=Path)
    ap.add_argument('b', type=Path)
    ap.add_argument('--max-lines', type=int, default=40, help='diff lines shown per part (default 40)')
    ap.add_argument('--ignore', action='append', default=[], metavar='GLOB', help='part names to skip, e.g. docProps/*')
    ap.add_argument('--strict', action='store_true', help='byte differences in XML-equal parts also fail')
    ap.add_argument('--json', action='store_true', help='print results as JSON')
    ap.add_argument('--all', action='store_true', help='also list identical parts')
    args = ap.parse_args(argv)
    try:
        results = diff_packages(args.a, args.b, args.max_lines, args.ignore)
    except (zipfile.BadZipFile, OSError) as e:
        print(f'error: {e}', file=sys.stderr)
        return 2
    failing = FAILING | ({'c14n-equal', 'normalized-equal'} if args.strict else set())
    bad = [r for r in results if r['status'] in failing]
    if args.json:
        print(json.dumps({'a': str(args.a), 'b': str(args.b), 'parts': results if args.all else [r for r in results if r['status'] != 'identical'], 'failing': len(bad)}, indent=2))
    else:
        counts: dict[str, int] = {}
        for r in results:
            counts[r['status']] = counts.get(r['status'], 0) + 1
        for r in results:
            if r['status'] == 'identical' and not args.all:
                continue
            extra = ''
            if r.get('bytes'):
                extra = f"  ({r['bytes'][0]} -> {r['bytes'][1]} bytes)"
            if r.get('sha256'):
                extra += f"  sha256 {r['sha256'][0]} -> {r['sha256'][1]}"
            if r.get('xml_error'):
                extra += f"  xml error: {r['xml_error']}"
            print(f"{r['status']:>17}  {r['part']}{extra}")
            for line in r.get('diff', []):
                print('                   ' + line)
        print('summary: ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
