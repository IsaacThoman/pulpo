# Word fidelity tooling

These dependency-light scripts support the opt-in test enabled with
`PULPO_DOCX_FIDELITY=1`. Run from the repository root; use isolated Python so local
modules and environment paths cannot override imports.

```sh
python3 -m venv /tmp/pulpo-docx-venv && /tmp/pulpo-docx-venv/bin/pip install python-docx lxml pypdf
PULPO_DOCX_FIDELITY=1 npm run test -w @pulpo/client-core
```

Use python-docx 1.2 or later for comments and hyperlink-aware run iteration. No
application code is imported. Optional LibreOffice and Poppler are local tools.

## Semantic comparison

```sh
/tmp/pulpo-docx-venv/bin/python -I packages/client-core/scripts/docx-fidelity/compare.py ORIGINAL.docx EXPORTED.docx
/tmp/pulpo-docx-venv/bin/python -I packages/client-core/scripts/docx-fidelity/compare.py ORIGINAL.docx EXPORTED.docx --json
```

Exit status is 0 for an equal readable model and 1 for differences or a read error.
JSON output is `{ "ok": true, "differences": [] }` when equal; each difference has a
`path`, `original`, and `exported` value (or `error` for an unreadable document).
Paths identify the paragraph/run, section, table row/cell, or other property.

The comparison reads body paragraphs in order (text, style, alignment, indents,
paragraph/line spacing), character formatting (including RGB/theme colors), tables
and nested tables (dimensions, cell texts and paragraphs, physical gridSpan/vMerge,
omitted grid cells), sections (page geometry, orientation, margins and all six
header/footer paragraph text lists), inline shape counts/sizes, exposed comments,
and the XML footnote count excluding separator notes. Adjacent runs with identical
formatting are merged before comparison; empty runs are ignored. Hyperlink runs
are included. Lengths are exact EMUs; enum values are integers. Unsupported
start/end paragraph alignment values fall back to their XML string.

This measures the model python-docx can read, rather than pixel identity. It does
not compare ZIP bytes, all raw XML, calculated field values, floating-object
layout, tracked changes, content-control contents, or unsupported drawing details.
Use the fixture XML and rendered PDFs for those checks.

## LibreOffice rendering

```sh
/tmp/pulpo-docx-venv/bin/python -I packages/client-core/scripts/docx-fidelity/libreoffice.py FILE.docx OTHER.docx --outdir /tmp/pulpo-docx-lo-out
/tmp/pulpo-docx-venv/bin/python -I packages/client-core/scripts/docx-fidelity/libreoffice.py FILE.docx --outdir /tmp/pulpo-docx-lo-out --png
```

The script uses `/Applications/LibreOffice.app/Contents/MacOS/soffice` headlessly
with `-env:UserInstallation=file:///tmp/pulpo-docx-lo-profile`. It gives each input
120 seconds, including retries when the private profile is busy. It never kills
other LibreOffice processes. Fresh temporary output directories prevent old PDFs
from hiding a conversion failure. Final PDFs are named after their input stems;
use separate output directories for inputs sharing a stem.

Every successful conversion prints its PDF page count, using pypdf when installed
or a `/Type /Page` token count otherwise. Missing/empty PDFs, invalid zero-page
output, timeouts, conversion failures, and PNG rendering failures produce nonzero
exit status, while processing continues for subsequent inputs.

`--png` renders **every** PDF page with `/opt/homebrew/bin/pdftoppm -r 96 -png`;
it does not use LibreOffice's first-page-only PNG conversion. If Poppler is
unavailable, the script warns and keeps the PDF. Output files stay outside the
fixture directory; do not commit raw PDF/PNG evidence.
