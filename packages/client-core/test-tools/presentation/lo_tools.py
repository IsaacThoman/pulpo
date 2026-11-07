#!/usr/bin/env python3
"""LibreOffice helpers shared by render_reference.sh and lo_open_check.sh.

    python lo_tools.py convert <file> <outdir> [--to pdf|pptx] [--hidden-slides] [--timeout 180]
    python lo_tools.py pdf-pages <file.pdf>
    python lo_tools.py slide-count <file.pptx> [--include-hidden]

`convert` copies the input into a private temp directory (so odd file names and
concurrent runs never collide), runs headless soffice with a private profile
(PULPO_LO_PROFILE, default /tmp/pulpo-pptx-lo-profile), retries when the profile
is locked by another run, and prints the output path. It exits 1 when LibreOffice
produced no file or an empty one; soffice itself exits 0 in that case.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

SOFFICE_CANDIDATES = ('/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/bin/libreoffice')


def soffice_path() -> str:
    env = os.environ.get('PULPO_SOFFICE')
    if env:
        return env
    found = shutil.which('soffice') or shutil.which('libreoffice')
    if found:
        return found
    for c in SOFFICE_CANDIDATES:
        if os.path.exists(c):
            return c
    raise SystemExit('soffice not found; set PULPO_SOFFICE')


def convert(src: Path, outdir: Path, to: str = 'pdf', hidden_slides: bool = False, timeout: int = 180, attempts: int = 5) -> Path:
    profile = os.environ.get('PULPO_LO_PROFILE', '/tmp/pulpo-pptx-lo-profile')
    outdir.mkdir(parents=True, exist_ok=True)
    target = to
    if to == 'pdf':
        opts = {'ExportNotesPages': {'type': 'boolean', 'value': 'false'}}
        if hidden_slides:
            opts['ExportHiddenSlides'] = {'type': 'boolean', 'value': 'true'}
        target = 'pdf:impress_pdf_Export:' + json.dumps(opts, separators=(',', ':'))
    ext = to.split(':')[0]
    last = ''
    with tempfile.TemporaryDirectory(prefix='pulpo-lo-in-') as tmp:
        # A neutral name keeps soffice away from shell- or URL-hostile file names
        work = Path(tmp) / ('input' + (src.suffix.lower() or '.pptx'))
        shutil.copyfile(src, work)
        produced = Path(tmp) / 'out' / f'input.{ext}'
        for attempt in range(attempts):
            if produced.exists():
                produced.unlink()
            try:
                proc = subprocess.run(
                    [soffice_path(), f'-env:UserInstallation=file://{profile}', '--headless', '--invisible', '--norestore', '--nologo', '--nodefault', '--nolockcheck',
                     '--convert-to', target, '--outdir', str(produced.parent), str(work)],
                    capture_output=True, text=True, timeout=timeout,
                )
                last = '\n'.join(l for l in (proc.stdout + proc.stderr).splitlines() if l.strip() and 'Fontconfig' not in l)
            except subprocess.TimeoutExpired:
                last = f'timed out after {timeout}s'
                break  # A hang is a property of the file; retrying will not help
            if produced.exists() and produced.stat().st_size > 0:
                dest = outdir / f'{src.stem}.{ext}'
                shutil.move(str(produced), dest)
                return dest
            # "source file could not be loaded" / "no export filter" (e.g. LibreOffice read a
            # non-presentation as a text document) are final; anything else may be a profile lock
            if 'could not be loaded' in last or 'no export filter' in last:
                break
            if proc.returncode < 0 or proc.returncode >= 128:
                last = f'soffice crashed (exit {proc.returncode}) {last}'.strip()
                break
            time.sleep(1.5 * (attempt + 1))
    sys.stderr.write(f'LibreOffice conversion failed for {src}: {last}\n')
    raise SystemExit(1)


def pdf_pages(pdf: Path) -> int:
    if shutil.which('pdfinfo'):
        proc = subprocess.run(['pdfinfo', str(pdf)], capture_output=True, text=True)
        m = re.search(r'^Pages:\s+(\d+)', proc.stdout, re.M)
        if proc.returncode == 0 and m:
            return int(m.group(1))
    data = pdf.read_bytes()
    # Fallback: count page objects (LibreOffice writes uncompressed object headers)
    return len(re.findall(rb'/Type\s*/Page(?![s\w])', data))


def slide_count(pptx: Path, include_hidden: bool = False) -> int:
    with zipfile.ZipFile(pptx) as z:
        rels = z.read('ppt/_rels/presentation.xml.rels').decode('utf-8', 'replace')
        pres = z.read('ppt/presentation.xml').decode('utf-8', 'replace')
        targets = dict(re.findall(r'<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"', rels))
        targets.update({k: v for v, k in re.findall(r'<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"', rels)})
        count = 0
        for rid in re.findall(r'<p:sldId\b[^>]*?r:id="([^"]+)"', pres):
            target = targets.get(rid)
            if not target:
                continue
            name = target.lstrip('/') if target.startswith('/') else 'ppt/' + target
            try:
                head = z.read(name)[:4000].decode('utf-8', 'replace')
            except KeyError:
                continue
            m = re.search(r'<p:sld\b[^>]*>', head)
            hidden = bool(m and re.search(r'\bshow="(0|false)"', m.group(0)))
            if include_hidden or not hidden:
                count += 1
        return count


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('convert')
    c.add_argument('file', type=Path)
    c.add_argument('outdir', type=Path)
    c.add_argument('--to', default='pdf')
    c.add_argument('--hidden-slides', action='store_true')
    c.add_argument('--timeout', type=int, default=int(os.environ.get('PULPO_LO_TIMEOUT', '180')))
    p = sub.add_parser('pdf-pages')
    p.add_argument('file', type=Path)
    s = sub.add_parser('slide-count')
    s.add_argument('file', type=Path)
    s.add_argument('--include-hidden', action='store_true')
    args = ap.parse_args(argv)
    if args.cmd == 'convert':
        print(convert(args.file, args.outdir, args.to, args.hidden_slides, args.timeout))
    elif args.cmd == 'pdf-pages':
        print(pdf_pages(args.file))
    else:
        print(slide_count(args.file, args.include_hidden))
    return 0


if __name__ == '__main__':
    sys.exit(main())
