#!/usr/bin/env python3
"""Diffs the pptx_inspect.py snapshots of two presentations.

    python pptx_compare.py a.pptx b.pptx [--ignore PATH ...] [--roundtrip] [--tolerance EMU] [--json]

Either argument may also be a snapshot .json written by `pptx_inspect.py --out`.
Paths look like `slides.0.shapes.3.text_frame.paragraphs.1.runs.0.font.size`;
--ignore takes shell-style globs over them (`*` crosses dots), e.g.
  --ignore 'core.*' --ignore '*.picture.image.sha256' --ignore 'slides.*.shapes.*.id'
--roundtrip ignores what a faithful editor legitimately rewrites (core.modified,
core.revision, core.last_modified_by, package.part_count, file, slide part names).
--tolerance treats numbers within that absolute distance as equal (EMU rounding).

Exit status: 0 no differences, 1 differences, 2 a file could not be opened.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pptx_inspect import inspect  # noqa: E402

ROUNDTRIP_IGNORES = [
    'file',
    'core.modified',
    'core.revision',
    'core.last_modified_by',
    'package.part_count',
    'slides.*.partname',
]


def load(path: Path) -> dict:
    if path.suffix.lower() == '.json':
        return json.loads(path.read_text(encoding='utf-8'))
    return inspect(path)


def diff(a, b, path: str, ignore: list[str], tol: float, out: list[dict]) -> None:
    if path and any(fnmatch.fnmatchcase(path, g) for g in ignore):
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            p = f'{path}.{k}' if path else str(k)
            if k not in b:
                if not any(fnmatch.fnmatchcase(p, g) for g in ignore):
                    out.append({'path': p, 'kind': 'removed', 'a': a[k]})
            elif k not in a:
                if not any(fnmatch.fnmatchcase(p, g) for g in ignore):
                    out.append({'path': p, 'kind': 'added', 'b': b[k]})
            else:
                diff(a[k], b[k], p, ignore, tol, out)
        return
    if isinstance(a, list) and isinstance(b, list):
        for i in range(max(len(a), len(b))):
            p = f'{path}.{i}' if path else str(i)
            if i >= len(b):
                if not any(fnmatch.fnmatchcase(p, g) for g in ignore):
                    out.append({'path': p, 'kind': 'removed', 'a': a[i]})
            elif i >= len(a):
                if not any(fnmatch.fnmatchcase(p, g) for g in ignore):
                    out.append({'path': p, 'kind': 'added', 'b': b[i]})
            else:
                diff(a[i], b[i], p, ignore, tol, out)
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        if abs(a - b) <= tol:
            return
    if a != b:
        out.append({'path': path, 'kind': 'changed', 'a': a, 'b': b})


def short(v, limit=120) -> str:
    s = json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[: limit - 3] + '...'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('a', type=Path)
    ap.add_argument('b', type=Path)
    ap.add_argument('--ignore', action='append', default=[], metavar='GLOB')
    ap.add_argument('--roundtrip', action='store_true', help='ignore fields a faithful save is allowed to change')
    ap.add_argument('--tolerance', type=float, default=0.0)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--max', type=int, default=200, help='differences printed (default 200)')
    args = ap.parse_args(argv)
    sys.setrecursionlimit(10000)
    a, b = load(args.a), load(args.b)
    for snap, p in ((a, args.a), (b, args.b)):
        if 'open_error' in snap:
            print(f'error: {p}: {snap["open_error"]}', file=sys.stderr)
            return 2
    ignore = list(args.ignore) + (ROUNDTRIP_IGNORES if args.roundtrip else [])
    out: list[dict] = []
    diff(a, b, '', ignore, args.tolerance, out)
    if args.json:
        print(json.dumps({'a': str(args.a), 'b': str(args.b), 'differences': out}, indent=2, ensure_ascii=False, default=str))
    else:
        for d in out[: args.max]:
            if d['kind'] == 'changed':
                print(f"~ {d['path']}: {short(d['a'])} -> {short(d['b'])}")
            elif d['kind'] == 'removed':
                print(f"- {d['path']}: {short(d['a'])}")
            else:
                print(f"+ {d['path']}: {short(d['b'])}")
        if len(out) > args.max:
            print(f'... {len(out) - args.max} more')
        print(f'{len(out)} difference(s)')
    return 1 if out else 0


if __name__ == '__main__':
    sys.exit(main())
