#!/usr/bin/env python3
"""Convert Word documents to PDFs, optionally rendering every PDF page to PNG."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
PROFILE = '-env:UserInstallation=file:///tmp/pulpo-docx-lo-profile'
PDFTOPPM = Path('/opt/homebrew/bin/pdftoppm')
TIMEOUT = 120


def page_count(pdf):
    try:
        from pypdf import PdfReader
    except ImportError:
        return len(re.findall(rb'/Type\s*/Page\b', pdf.read_bytes()))
    return len(PdfReader(str(pdf)).pages)


def convert(source, outdir, png=False):
    if not source.is_file():
        raise ValueError(f'Input does not exist: {source}')
    # A fresh output directory ensures a stale PDF cannot make a failed run pass.
    # Retry if another invocation using the shared private profile consumes the request.
    deadline = time.monotonic() + TIMEOUT
    with tempfile.TemporaryDirectory(prefix='pulpo-docx-', dir=outdir) as temporary:
        work = Path(temporary)
        pdf = work / (source.stem + '.pdf')
        last_output = ''
        for attempt in range(3):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f'LibreOffice exceeded {TIMEOUT}s: {last_output}')
            completed = subprocess.run(
                [SOFFICE, '--headless', PROFILE, '--convert-to', 'pdf',
                 '--outdir', str(work), str(source.resolve())],
                capture_output=True, text=True, timeout=remaining,
            )
            last_output = (completed.stdout + completed.stderr).strip()
            if completed.returncode == 0 and pdf.is_file() and pdf.stat().st_size > 0:
                break
            if attempt < 2:
                time.sleep(min(1 + attempt, max(0, deadline - time.monotonic())))
        else:
            raise RuntimeError(f'LibreOffice did not produce a nonempty PDF: {last_output}')
        pages = page_count(pdf)
        if pages < 1:
            raise RuntimeError('PDF has no readable pages')
        target = outdir / pdf.name
        shutil.move(str(pdf), target)
    print(f'{source}: {pages} page(s) -> {target}', flush=True)
    if png:
        if not PDFTOPPM.is_file():
            print(f'Warning: {PDFTOPPM} is unavailable; skipping PNG rendering.', file=sys.stderr)
        else:
            completed = subprocess.run(
                [str(PDFTOPPM), '-r', '96', '-png', str(target), str(outdir / source.stem)],
                capture_output=True, text=True, timeout=TIMEOUT,
            )
            rendered = [outdir / f'{source.stem}-{i:0{len(str(pages))}d}.png'
                        for i in range(1, pages + 1)]
            if completed.returncode or any(not p.is_file() or not p.stat().st_size for p in rendered):
                raise RuntimeError('PDF page rendering failed: ' + completed.stderr.strip())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='+', type=Path)
    parser.add_argument('--outdir', required=True, type=Path)
    parser.add_argument('--png', action='store_true')
    args = parser.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    failed = False
    for source in args.files:
        try:
            convert(source, args.outdir.resolve(), args.png)
        except Exception as exc:
            failed = True
            print(f'ERROR {source}: {exc}', file=sys.stderr, flush=True)
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
