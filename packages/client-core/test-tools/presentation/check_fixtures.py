#!/usr/bin/env python3
"""Runs the fidelity tools over a fixture tree and prints a status table.

    python check_fixtures.py [DIR ...] [--no-lo] [--json out.json] [--timeout 180]

Default DIR is fixtures/presentation. For each .pptx/.pptm/.ppsx/.potx (and
anything in a `hostile/` folder) it records:
  inspect    pptx_inspect.py: ok, open_error (python-pptx refused), errors=N
             (per-object errors recorded in the snapshot), crash or timeout
  resave     python-pptx open+save, then pptx_compare.py --roundtrip and
             pptx_parts_diff.py on original vs resaved (sanity check of both tools)
  lo         lo_open_check.sh: ok N pages, or the failure reason
Tools run as subprocesses so a crash or hang in one file cannot stop the run.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DIR = HERE.parent.parent / 'fixtures' / 'presentation'
EXTS = {'.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm'}
PY = os.environ.get('PULPO_PPTX_PYTHON', '/tmp/pulpo-pptx-venv/bin/python')

RESAVE = r'''
import sys
from pptx import Presentation
Presentation(sys.argv[1]).save(sys.argv[2])
'''


def run(cmd: list[str], timeout: int) -> tuple[int | None, str, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return None, '', 'timeout'


def last_line(s: str) -> str:
    lines = [l for l in s.strip().splitlines() if l.strip()]
    return lines[-1][:160] if lines else ''


def check(path: Path, use_lo: bool, timeout: int, tmp: Path) -> dict:
    row: dict = {'file': str(path), 'bytes': path.stat().st_size}
    snap_path = tmp / (path.name + '.json')
    snap: dict = {}
    rc, out, err = run([PY, '-I', str(HERE / 'pptx_inspect.py'), str(path), '--out', str(snap_path), '--compact'], timeout)
    if rc is None:
        row['inspect'] = 'timeout'
    elif rc not in (0, 2):
        row['inspect'] = 'crash: ' + last_line(err)
    else:
        snap = json.loads(snap_path.read_text())
        if 'open_error' in snap:
            row['inspect'] = 'open_error: ' + snap['open_error'][:120]
        else:
            n = snap_path.read_text().count('"error"')
            row['inspect'] = 'ok' if n == 0 else f'ok, errors={n}'
            row['slides'] = len(snap.get('slides', [])) if isinstance(snap.get('slides'), list) else None
    if row['inspect'].startswith('ok') and snap.get('opened_with_patched_content_type'):
        row['resave'] = 'skipped: python-pptx cannot save this main content type'
    elif row['inspect'].startswith('ok'):
        resaved = tmp / ('resaved-' + path.stem + '.pptx')
        rc, out, err = run([PY, '-I', '-c', RESAVE, str(path), str(resaved)], timeout)
        if rc != 0:
            row['resave'] = 'save failed: ' + last_line(err)
        else:
            rc1, out1, _ = run([PY, '-I', str(HERE / 'pptx_compare.py'), str(path), str(resaved), '--roundtrip'], timeout)
            rc2, out2, _ = run([PY, '-I', str(HERE / 'pptx_parts_diff.py'), str(path), str(resaved)], timeout)
            row['resave'] = f'compare rc={rc1} ({last_line(out1)}); parts rc={rc2} ({last_line(out2)})'
    if use_lo:
        rc, out, err = run([str(HERE / 'lo_open_check.sh'), str(path)], timeout + 30)
        row['lo'] = 'timeout' if rc is None else (last_line(out) or last_line(err) or f'rc={rc}')
        row['lo_ok'] = rc == 0
    return row


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dirs', nargs='*', type=Path, default=[DEFAULT_DIR])
    ap.add_argument('--no-lo', action='store_true', help='skip LibreOffice')
    ap.add_argument('--json', type=Path, help='write all rows as JSON')
    ap.add_argument('--timeout', type=int, default=180)
    args = ap.parse_args(argv)
    files: list[Path] = []
    for d in args.dirs:
        if d.is_file():
            files.append(d)
            continue
        for f in sorted(d.rglob('*')):
            if f.is_file() and (f.suffix.lower() in EXTS) and not f.name.startswith('.'):
                files.append(f)
    rows = []
    with tempfile.TemporaryDirectory(prefix='pulpo-check-') as tmp:
        for f in files:
            row = check(f, not args.no_lo, args.timeout, Path(tmp))
            rows.append(row)
            rel = os.path.relpath(f, DEFAULT_DIR) if str(f).startswith(str(DEFAULT_DIR)) else str(f)
            print(f"{rel:<55} {row['inspect']:<40} {row.get('lo', '')}")
            if row.get('resave'):
                print(f"{'':<55} resave: {row['resave']}")
            sys.stdout.flush()
    if args.json:
        args.json.write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
